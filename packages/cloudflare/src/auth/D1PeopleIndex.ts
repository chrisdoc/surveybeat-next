import type * as Cloudflare from "@alchemy.run/cloudflare";
import {
  EmailAddress,
  normaliseEmail,
  type ClaimStatus,
  OrganizationId,
  PeopleIndex,
  type PersonCandidate,
  PersonId,
  WorkosOrganizationId,
} from "@surveybeat/domain";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const CandidateRow = Schema.Struct({
  organization_id: OrganizationId,
  name: Schema.String,
  person_id: PersonId,
  linked: Schema.Finite,
});

const ClaimRow = Schema.Struct({
  organization_id: OrganizationId,
  name: Schema.String,
  admin_person_id: PersonId,
  completed_at: Schema.NullOr(Schema.Finite),
});

const decodeRows = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.Array(schema));

const toCandidate = (row: typeof CandidateRow.Type): PersonCandidate => ({
  organization: { id: row.organization_id, name: row.name },
  personId: row.person_id,
  linked: row.linked === 1,
});

const toClaim = (row: typeof ClaimRow.Type): ClaimStatus => ({
  organization: { id: row.organization_id, name: row.name },
  adminPersonId: row.admin_person_id,
  completed: row.completed_at !== null,
});

/**
 * `PeopleIndex` on the stage's D1 database (`d1-migrations/0003_people_index.sql`, `0004_…`). D1 has one
 * primary and read replication is off, so a write (a revoked session) is seen by the next read.
 * Built inside a handler, like the other D1 adapters.
 */
export const d1PeopleIndex = (db: Cloudflare.D1.QueryDatabaseClient) =>
  Effect.gen(function* () {
    const runtime = yield* Effect.context<RuntimeContext>();
    const run = <A, E>(effect: Effect.Effect<A, E, RuntimeContext>): Effect.Effect<A> =>
      effect.pipe(Effect.provideContext(runtime), Effect.orDie);

    const all = (sql: string, ...binds: ReadonlyArray<unknown>) =>
      db
        .prepare(sql)
        .bind(...binds)
        .all<unknown>()
        .pipe(Effect.map((result) => result.results));
    const write = (sql: string, ...binds: ReadonlyArray<unknown>) =>
      run(
        db
          .prepare(sql)
          .bind(...binds)
          .run(),
      ).pipe(Effect.asVoid);

    const claimOf = (userId: string) =>
      run(
        all(
          `SELECT organization_id, name, admin_person_id, completed_at
             FROM organization_claim WHERE workos_user_id = ?`,
          userId,
        ).pipe(Effect.flatMap(decodeRows(ClaimRow))),
      ).pipe(Effect.map((rows) => Option.map(Option.fromNullishOr(rows[0]), toClaim)));

    return PeopleIndex.of({
      linkedPersons: (userId) =>
        run(
          all(
            `SELECT p.organization_id, o.name, p.person_id, 1 AS linked
               FROM person_index p JOIN organization_index o ON o.organization_id = p.organization_id
              WHERE p.workos_user_id = ?
              ORDER BY p.organization_id`,
            userId,
          ).pipe(Effect.flatMap(decodeRows(CandidateRow))),
        ).pipe(Effect.map((rows) => rows.map(toCandidate))),

      unlinkedPersons: (email) =>
        run(
          all(
            `SELECT p.organization_id, o.name, p.person_id, 0 AS linked
               FROM person_index p JOIN organization_index o ON o.organization_id = p.organization_id
              WHERE p.email = ? AND p.workos_user_id IS NULL
              ORDER BY p.organization_id`,
            normaliseEmail(email),
          ).pipe(Effect.flatMap(decodeRows(CandidateRow))),
        ).pipe(Effect.map((rows) => rows.map(toCandidate))),

      putOrganization: (organization, workosOrganizationId) =>
        write(
          `INSERT INTO organization_index (organization_id, name, workos_organization_id) VALUES (?, ?, ?)
           ON CONFLICT (organization_id) DO UPDATE SET
             name = excluded.name,
             workos_organization_id = coalesce(excluded.workos_organization_id, workos_organization_id)`,
          organization.id,
          organization.name,
          Option.getOrNull(workosOrganizationId),
        ),

      organizationByWorkos: (workosOrganizationId) =>
        run(
          all(
            "SELECT organization_id, name FROM organization_index WHERE workos_organization_id = ?",
            workosOrganizationId,
          ).pipe(
            Effect.flatMap(
              decodeRows(Schema.Struct({ organization_id: OrganizationId, name: Schema.String })),
            ),
          ),
        ).pipe(
          Effect.map((rows) =>
            Option.map(Option.fromNullishOr(rows[0]), (row) => ({ id: row.organization_id, name: row.name })),
          ),
        ),

      workosOrganizationOf: (organizationId) =>
        run(
          all(
            "SELECT workos_organization_id FROM organization_index WHERE organization_id = ?",
            organizationId,
          ).pipe(
            Effect.flatMap(
              decodeRows(Schema.Struct({ workos_organization_id: Schema.NullOr(WorkosOrganizationId) })),
            ),
          ),
        ).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]?.workos_organization_id))),

      putPerson: (person) =>
        write(
          `INSERT INTO person_index (organization_id, person_id, email, workos_user_id) VALUES (?, ?, ?, ?)
           ON CONFLICT (organization_id, person_id) DO UPDATE SET
             workos_user_id = coalesce(workos_user_id, excluded.workos_user_id)`,
          person.organizationId,
          person.personId,
          EmailAddress.make(normaliseEmail(person.email)),
          Option.getOrNull(person.userId),
        ),

      removePerson: (organizationId, personId) =>
        write(
          "DELETE FROM person_index WHERE organization_id = ? AND person_id = ?",
          organizationId,
          personId,
        ),

      linkPerson: (organizationId, personId, userId) =>
        write(
          `UPDATE person_index SET workos_user_id = ?
            WHERE organization_id = ? AND person_id = ? AND workos_user_id IS NULL`,
          userId,
          organizationId,
          personId,
        ),

      claimOrganization: (userId, proposed) =>
        write(
          `INSERT INTO organization_claim (workos_user_id, organization_id, name, admin_person_id)
           VALUES (?, ?, ?, ?) ON CONFLICT (workos_user_id) DO NOTHING`,
          userId,
          proposed.organization.id,
          proposed.organization.name,
          proposed.adminPersonId,
        ).pipe(
          Effect.andThen(claimOf(userId)),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.die("organization_claim row vanished after insert"),
              onSome: Effect.succeed,
            }),
          ),
        ),

      claimOf,

      completeClaim: (userId, now) =>
        write(
          "UPDATE organization_claim SET completed_at = ? WHERE workos_user_id = ? AND completed_at IS NULL",
          now,
          userId,
        ),

      revokeSession: (sessionId, now) =>
        write(
          "INSERT INTO revoked_session (session_id, revoked_at) VALUES (?, ?) ON CONFLICT (session_id) DO NOTHING",
          sessionId,
          now,
        ),

      isSessionRevoked: (sessionId) =>
        run(all("SELECT 1 AS revoked FROM revoked_session WHERE session_id = ?", sessionId)).pipe(
          Effect.map((rows) => rows.length > 0),
        ),
    });
  });
