import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  DEFAULT_MINIMUM_GROUP_SIZE,
  type DirectoryChange,
  type DirectoryState,
  EmailAddress,
  MembershipId,
  MembershipRole,
  PersonId,
  type SendStoreShape,
  TeamId,
  TimeZone,
  WorkosUserId,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const OrganizationRow = Schema.Struct({
  name: Schema.String,
  minimum_group_size: Schema.Int,
  ai_processing: Schema.Int,
});
const PersonRow = Schema.Struct({
  id: PersonId,
  email: EmailAddress,
  workos_user_id: Schema.NullOr(WorkosUserId),
  organization_admin: Schema.Int,
  removed_at: Schema.NullOr(Schema.Int),
});
const TeamRow = Schema.Struct({ id: TeamId, name: Schema.String, time_zone: TimeZone });
const MembershipRow = Schema.Struct({
  id: MembershipId,
  team_id: TeamId,
  person_id: PersonId,
  role: MembershipRole,
  started_at: Schema.Int,
  ended_at: Schema.NullOr(Schema.Int),
});

const rows = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.Array(schema));

/**
 * The directory tables of the Organization Durable Object (`migrations/0004_teams.sql`): the
 * whole state for `decide`, and the SQL for each change it returns. Run both inside one
 * transaction. A row that does not decode is a defect.
 */
export const makeSqlDirectory = (sql: SqliteClient.SqliteClient, sends: SendStoreShape) => {
  const load: Effect.Effect<DirectoryState> = Effect.gen(function* () {
    const [organization] =
      yield* sql`SELECT name, minimum_group_size, ai_processing FROM organization LIMIT 1`.pipe(
        Effect.flatMap(rows(OrganizationRow)),
      );
    const people =
      yield* sql`SELECT id, email, workos_user_id, organization_admin, removed_at FROM person`.pipe(
        Effect.flatMap(rows(PersonRow)),
      );
    const teams = yield* sql`SELECT id, name, time_zone FROM team`.pipe(Effect.flatMap(rows(TeamRow)));
    const memberships = yield* sql`
      SELECT id, team_id, person_id, role, started_at, ended_at FROM membership ORDER BY started_at, id`.pipe(
      Effect.flatMap(rows(MembershipRow)),
    );
    return {
      organizationName: organization?.name ?? "",
      minimumGroupSize: organization?.minimum_group_size ?? DEFAULT_MINIMUM_GROUP_SIZE,
      aiProcessing: organization?.ai_processing === 1,
      people: people.map((row) => ({
        id: row.id,
        email: row.email,
        workosUserId: row.workos_user_id,
        organizationAdmin: row.organization_admin === 1,
        removedAt: row.removed_at,
      })),
      teams: teams.map((row) => ({ id: row.id, name: row.name, timeZone: row.time_zone })),
      memberships: memberships.map((row) => ({
        id: row.id,
        teamId: row.team_id,
        personId: row.person_id,
        role: row.role,
        startedAt: row.started_at,
        endedAt: row.ended_at,
      })),
    } satisfies DirectoryState;
  }).pipe(Effect.orDie);

  const applyOne = (change: DirectoryChange): Effect.Effect<unknown, unknown> => {
    switch (change._tag) {
      case "PersonAdded": {
        const { person } = change;
        return sql`INSERT INTO person (id, email, workos_user_id, organization_admin, removed_at)
          VALUES (${person.id}, ${person.email}, ${person.workosUserId}, ${person.organizationAdmin ? 1 : 0},
                  ${person.removedAt})`;
      }
      case "PersonRestored":
        return sql`UPDATE person SET removed_at = NULL WHERE id = ${change.personId}`;
      case "PersonRemoved":
        return sql`UPDATE person SET removed_at = ${change.at} WHERE id = ${change.personId}`;
      case "AdminSet":
        return sql`UPDATE person SET organization_admin = ${change.organizationAdmin ? 1 : 0}
          WHERE id = ${change.personId}`;
      case "TeamAdded":
        return sql`INSERT INTO team (id, name, time_zone)
          VALUES (${change.team.id}, ${change.team.name}, ${change.team.timeZone})`;
      case "TeamUpdated":
        return sql`UPDATE team SET name = ${change.team.name}, time_zone = ${change.team.timeZone}
          WHERE id = ${change.team.id}`;
      case "MembershipStarted": {
        const { membership } = change;
        return sql`INSERT INTO membership (id, team_id, person_id, role, started_at, ended_at)
          VALUES (${membership.id}, ${membership.teamId}, ${membership.personId}, ${membership.role},
                  ${membership.startedAt}, ${membership.endedAt})`;
      }
      case "MembershipEnded":
        return sql`UPDATE membership SET ended_at = ${change.at} WHERE id = ${change.membershipId}`;
      case "SettingsUpdated":
        return sql`UPDATE organization SET minimum_group_size = ${change.minimumGroupSize},
          ai_processing = ${change.aiProcessing ? 1 : 0}`;
      case "EmailRequested":
        return sends.create(change.sendId, change.recipient, change.email);
    }
  };

  const apply = (changes: ReadonlyArray<DirectoryChange>): Effect.Effect<void> =>
    Effect.forEach(changes, applyOne, { discard: true }).pipe(Effect.orDie);

  return { load, apply };
};
