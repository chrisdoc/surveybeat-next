import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  decide,
  DEFAULT_LOCALE,
  localeOr,
  localeOrNull,
  settingsView,
  teamsView,
  teamView,
} from "@surveybeat/domain";
import type { PersonId, TeamId, CommandResult, DirectoryCommand } from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import type { makeSqlDirectory } from "../SqlDirectory.ts";
import type { makeSqlRounds } from "../SqlRounds.ts";

export const organizationDirectory = ({
  sql,
  rounds,
  directory,
}: {
  sql: SqliteClient.SqliteClient;
  rounds: ReturnType<typeof makeSqlRounds>;
  directory: ReturnType<typeof makeSqlDirectory>;
}) => {
  const deleteTestSendsForPerson = (personId: PersonId) =>
    sql`DELETE FROM test_send WHERE person_id = ${personId}`.pipe(Effect.asVoid, Effect.orDie);

  return {
    create: (id: string, name: string) =>
      sql
        .withTransaction(sql`INSERT INTO organization (id, name) VALUES (${id}, ${name})`)
        .pipe(Effect.as({ id, name }), Effect.orDie),

    createWithAdmin: (id: string, name: string, personId: string, email: string, authUserId: string) =>
      sql
        .withTransaction(
          Effect.all([
            sql`INSERT INTO organization (id, name) VALUES (${id}, ${name}) ON CONFLICT (id) DO NOTHING`,
            sql`INSERT INTO person (id, email, auth_user_id, organization_admin)
              VALUES (${personId}, ${email}, ${authUserId}, 1)
              ON CONFLICT (id) DO NOTHING`,
          ]),
        )
        .pipe(Effect.asVoid, Effect.orDie),

    linkPerson: (personId: string, authUserId: string, email: string) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const other = yield* sql<{ id: string }>`
            SELECT id FROM person WHERE auth_user_id = ${authUserId} AND id <> ${personId}`;
            if (other.length > 0) {
              return false;
            }
            yield* sql`
            UPDATE person SET auth_user_id = ${authUserId}
             WHERE id = ${personId} AND email = ${email} AND removed_at IS NULL AND auth_user_id IS NULL`;
            const linked = yield* sql<{ id: string }>`
            SELECT id FROM person
             WHERE id = ${personId} AND auth_user_id = ${authUserId} AND removed_at IS NULL`;
            return linked.length > 0;
          }),
        )
        .pipe(Effect.orDie),

    activePerson: (authUserId: string) =>
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
       WHERE person.auth_user_id = ${authUserId} AND person.removed_at IS NULL`.pipe(
        Effect.map((rows) => {
          const row = rows[0];
          if (row === undefined) {
            return null;
          }
          return {
            id: row.id,
            organizationAdmin: row.organization_admin === 1,
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
            if (decision._tag === "Rejected") {
              return decision satisfies CommandResult;
            }
            yield* directory.apply(decision.changes);
            if (command._tag === "RemovePerson") {
              yield* rounds.revokeInvitationForPerson(command.personId, now);
              yield* rounds.deleteParticipationForPerson(command.personId);
              yield* deleteTestSendsForPerson(command.personId);
            }
            return {
              _tag: "Accepted",
              followUps: decision.followUps,
            } satisfies CommandResult;
          }),
        )
        .pipe(Effect.orDie),
    viewTeams: (actorId: PersonId) =>
      Effect.gen(function* () {
        const view = teamsView(yield* directory.load, actorId);
        if (view._tag !== "Viewed") {
          return view;
        }
        const nextRoundDates = yield* rounds.nextRoundDates();
        return {
          _tag: "Viewed" as const,
          value: view.value.map((team) => ({
            ...team,
            nextRoundDate: nextRoundDates[team.id] ?? null,
          })),
        };
      }),
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
