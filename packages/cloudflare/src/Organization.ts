import * as Cloudflare from "@alchemy.run/cloudflare";
import { SqliteClient } from "@effect/sql-sqlite-do";
import {
  type CommandResult,
  decide,
  defaultSendPolicy,
  type DeliveryEventKind,
  type DirectoryCommand,
  type EmailAddress,
  type FollowUp,
  makeSendStore,
  type PersonId,
  type SendId,
  type SendOutcome,
  settingsView,
  type TeamId,
  teamsView,
  teamView,
  type TransactionalEmail,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { makeSqlDirectory } from "./SqlDirectory.ts";
import { makeSqlSendRepository } from "./SqlSendRepository.ts";

/**
 * Relative to the directory Alchemy runs in, which is the repository root (`pnpm infra:deploy`, `pnpm test`).
 * It must be a literal: the same expression runs again inside the bundle, where `import.meta.url` differs.
 */
const migrationsDirectory = "packages/cloudflare/migrations";

/**
 * The Organization Durable Object (ADR 0006): one object per Organization, SQLite storage.
 * Methods return plain data (no `Option`), because they cross the RPC boundary.
 * The Main Worker maps it to the domain schemas.
 */
export default class Organization extends Cloudflare.DurableObject<Organization>()(
  "Organization",
  Effect.gen(function* () {
    // Outer phase: capture the SQL files into the bundle.
    const migrations = yield* Cloudflare.SqlMigrations(migrationsDirectory);

    // Inner phase: runs once per object activation, before any method is exposed.
    return Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState;

      // Pass `storage` (not just `db`) so `withTransaction` uses `storage.transaction()`.
      const scope = yield* Scope.make();
      const sql = yield* SqliteClient.make({ storage: state.raw.storage }).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.provide(Reactivity.layer),
      );

      yield* migrations.apply().pipe(Effect.orDie);

      // Transactional email: the domain's SendStore on this object's `email_send` table.
      const sends = makeSendStore(makeSqlSendRepository(sql), defaultSendPolicy);
      // People, Teams, and Memberships: the domain decides, this object loads and applies.
      const directory = makeSqlDirectory(sql, sends);

      /** Only sends still waiting go back to the queue; one already sent or failed stays as it is. */
      const pendingOnly = (followUps: ReadonlyArray<FollowUp>) =>
        Effect.filter(followUps, (step) =>
          step._tag === "QueueEmail"
            ? sends
                .get(step.sendId)
                .pipe(Effect.map((record) => record._tag === "Some" && record.value.state._tag === "Pending"))
            : Effect.succeed(true),
        );

      return {
        create: (id: string, name: string) =>
          sql
            .withTransaction(sql`INSERT INTO organization (id, name) VALUES (${id}, ${name})`)
            .pipe(Effect.as({ id, name }), Effect.orDie),

        /** Idempotent: the Organization and its creator as its first Person (an Organization admin in WorkOS). */
        createWithAdmin: (id: string, name: string, personId: string, email: string, workosUserId: string) =>
          sql
            .withTransaction(
              Effect.all([
                sql`INSERT INTO organization (id, name) VALUES (${id}, ${name}) ON CONFLICT (id) DO NOTHING`,
                sql`INSERT INTO person (id, email, workos_user_id, organization_admin)
                    VALUES (${personId}, ${email}, ${workosUserId}, 1)
                    ON CONFLICT (id) DO NOTHING`,
              ]),
            )
            .pipe(Effect.asVoid, Effect.orDie),

        /**
         * Links a Person to a WorkOS user: only an active Person with exactly this (normalised)
         * email, not linked to someone else, and only if the user has no other Person here.
         */
        linkPerson: (personId: string, workosUserId: string, email: string) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const other = yield* sql<{ id: string }>`
                  SELECT id FROM person WHERE workos_user_id = ${workosUserId} AND id <> ${personId}`;
                if (other.length > 0) return false;
                yield* sql`
                  UPDATE person SET workos_user_id = ${workosUserId}
                   WHERE id = ${personId} AND email = ${email} AND removed_at IS NULL AND workos_user_id IS NULL`;
                const linked = yield* sql<{ id: string }>`
                  SELECT id FROM person
                   WHERE id = ${personId} AND workos_user_id = ${workosUserId} AND removed_at IS NULL`;
                return linked.length > 0;
              }),
            )
            .pipe(Effect.orDie),

        /** The per-request check: the user's Person here, unless removed, and whether they are an admin. */
        activePerson: (workosUserId: string) =>
          sql<{ id: string; organization_admin: number }>`
            SELECT id, organization_admin FROM person
             WHERE workos_user_id = ${workosUserId} AND removed_at IS NULL`.pipe(
            Effect.map((rows) => {
              const row = rows[0];
              return row === undefined
                ? null
                : { id: row.id, organizationAdmin: row.organization_admin === 1 };
            }),
            Effect.orDie,
          ),

        /**
         * One directory command by `actorId`: authorized from this object's data and applied in the
         * same transaction, so nothing can change in between.
         */
        runDirectoryCommand: (actorId: PersonId, command: DirectoryCommand, now: number) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const decision = decide(yield* directory.load, actorId, command, now);
                if (decision._tag === "Rejected") return decision satisfies CommandResult;
                yield* directory.apply(decision.changes);
                return {
                  _tag: "Accepted",
                  followUps: yield* pendingOnly(decision.followUps),
                } satisfies CommandResult;
              }),
            )
            .pipe(Effect.orDie),
        viewTeams: (actorId: PersonId) =>
          directory.load.pipe(Effect.map((state) => teamsView(state, actorId))),
        viewTeam: (actorId: PersonId, teamId: TeamId) =>
          directory.load.pipe(Effect.map((state) => teamView(state, actorId, teamId))),
        viewSettings: (actorId: PersonId) =>
          directory.load.pipe(Effect.map((state) => settingsView(state, actorId))),

        get: (id: string) =>
          sql<{ id: string; name: string }>`SELECT id, name FROM organization WHERE id = ${id}`.pipe(
            Effect.map((rows) => rows[0] ?? null),
            Effect.orDie,
          ),

        createEmailSend: (id: SendId, recipient: EmailAddress, email: TransactionalEmail) =>
          sends.create(id, recipient, email),
        getEmailSend: (id: SendId) => sends.get(id).pipe(Effect.map(Option.getOrNull)),
        claimEmailSend: (id: SendId, now: number) => sends.claim(id, now),
        settleEmailSend: (id: SendId, attempt: number, outcome: SendOutcome, now: number) =>
          sends.settle(id, attempt, outcome, now).pipe(Effect.map(Option.getOrNull)),
        abandonEmailSend: (id: SendId, now: number) =>
          sends.abandon(id, now).pipe(Effect.map(Option.getOrNull)),
        recordEmailDeliveryEvent: (id: SendId, kind: DeliveryEventKind, code: string | null, now: number) =>
          sends.recordDeliveryEvent(id, kind, code, now).pipe(Effect.map(Option.getOrNull)),
      };
    });
  }),
) {}
