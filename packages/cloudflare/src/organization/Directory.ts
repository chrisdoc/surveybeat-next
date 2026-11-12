import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  type CommandResult,
  decide,
  DEFAULT_LOCALE,
  type DirectoryCommand,
  Locale,
  type makeSendStore,
  type FollowUp,
  PersonId,
  settingsView,
  TeamId,
  teamsView,
  teamView,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { makeSqlDirectory } from "../SqlDirectory.ts";
import type { makeSqlRounds } from "../SqlRounds.ts";

/** A stored language the schema's CHECK constraints admit; anything else is read as unset. */
const localeOrNull = (value: string | null): Locale | null => (Schema.is(Locale)(value) ? value : null);
const localeOr = (value: string | null, fallback: Locale): Locale =>
  Schema.is(Locale)(value) ? value : fallback;
export const organizationDirectory = ({
  sql,
  sends,
  rounds,
  directory,
}: {
  sql: SqliteClient.SqliteClient;
  sends: ReturnType<typeof makeSendStore>;
  rounds: ReturnType<typeof makeSqlRounds>;
  directory: ReturnType<typeof makeSqlDirectory>;
}) => {
  const deleteTestSendsForPerson = (personId: PersonId) =>
    sql`DELETE FROM test_send WHERE person_id = ${personId}`.pipe(Effect.asVoid, Effect.orDie);

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

    activePerson: (workosUserId: string) =>
      sql<{
        id: string;
        organization_admin: number;
        locale: string | null;
        detected_locale: string | null;
        default_locale: string | null;
      }>`
      SELECT person.id, person.organization_admin, person.locale, person.detected_locale,
             (SELECT default_locale FROM organization LIMIT 1) AS default_locale
        FROM person
       WHERE person.workos_user_id = ${workosUserId} AND person.removed_at IS NULL`.pipe(
        Effect.map((rows) => {
          const row = rows[0];
          if (row === undefined) return null;
          return {
            id: row.id,
            organizationAdmin: row.organization_admin === 1,
            // The schema's CHECKs keep these to the known languages; anything else is read as unset.
            locale: localeOrNull(row.locale),
            detectedLocale: localeOrNull(row.detected_locale),
            organizationLocale: localeOr(row.default_locale, DEFAULT_LOCALE),
          };
        }),
        Effect.orDie,
      ),

    runDirectoryCommand: (actorId: PersonId, command: DirectoryCommand, now: number) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const decision = decide(yield* directory.load, actorId, command, now);
            if (decision._tag === "Rejected") return decision satisfies CommandResult;
            yield* directory.apply(decision.changes);
            if (command._tag === "RemovePerson") {
              yield* rounds.revokeInvitationForPerson(command.personId, now);
              yield* rounds.deleteParticipationForPerson(command.personId);
              yield* deleteTestSendsForPerson(command.personId);
            }
            return {
              _tag: "Accepted",
              followUps: yield* pendingOnly(decision.followUps),
            } satisfies CommandResult;
          }),
        )
        .pipe(Effect.orDie),
    viewTeams: (actorId: PersonId) => directory.load.pipe(Effect.map((state) => teamsView(state, actorId))),
    viewTeam: (actorId: PersonId, teamId: TeamId) =>
      directory.load.pipe(Effect.map((state) => teamView(state, actorId, teamId))),
    viewSettings: (actorId: PersonId) =>
      directory.load.pipe(Effect.map((state) => settingsView(state, actorId))),

    get: (id: string) =>
      sql<{ id: string; name: string }>`SELECT id, name FROM organization WHERE id = ${id}`.pipe(
        Effect.map((rows) => rows[0] ?? null),
        Effect.orDie,
      ),
  };
};
