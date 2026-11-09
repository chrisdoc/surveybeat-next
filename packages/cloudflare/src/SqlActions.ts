import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  ActionId,
  type ActionItem,
  type ActionRecord,
  ActionStatus,
  Dimension,
  EmailAddress,
  PersonId,
  type PulseId,
  RoundId,
  selectActionsForRound,
  TeamId,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const ActionRow = Schema.Struct({
  id: ActionId,
  team_id: TeamId,
  round_id: RoundId,
  title: Schema.NonEmptyString,
  owner_id: PersonId,
  due_date: Schema.NullOr(Schema.String),
  dimension: Schema.NullOr(Dimension),
  status: ActionStatus,
  created_at: Schema.Int,
  updated_at: Schema.Int,
  done_at: Schema.NullOr(Schema.Int),
});

const ActionItemRow = Schema.Struct({
  id: ActionId,
  team_id: TeamId,
  round_id: RoundId,
  title: Schema.String,
  owner_id: PersonId,
  owner_email: EmailAddress,
  due_date: Schema.NullOr(Schema.String),
  dimension: Schema.NullOr(Dimension),
  status: ActionStatus,
  created_at: Schema.Int,
  updated_at: Schema.Int,
  done_at: Schema.NullOr(Schema.Int),
});

const decodeAction = (row: typeof ActionRow.Type): ActionRecord => ({
  id: row.id,
  teamId: row.team_id,
  roundId: row.round_id,
  title: row.title,
  ownerId: row.owner_id,
  dueDate: row.due_date,
  dimension: row.dimension,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  doneAt: row.done_at,
});

const decodeActionItem = (row: typeof ActionItemRow.Type): ActionItem => ({
  id: row.id,
  teamId: row.team_id,
  roundId: row.round_id,
  title: row.title,
  ownerId: row.owner_id,
  ownerEmail: row.owner_email,
  dueDate: row.due_date,
  dimension: row.dimension,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  doneAt: row.done_at,
});

const PreviousRoundRow = Schema.Struct({
  opened_at: Schema.NullOr(Schema.Int),
  planned_open_at: Schema.Int,
});

export const makeSqlActions = (sql: SqliteClient.SqliteClient) => {
  const getAction = (actionId: ActionId): Effect.Effect<ActionRecord | null> =>
    sql`SELECT id, team_id, round_id, title, owner_id, due_date, dimension, status, created_at, updated_at, done_at
        FROM action
        WHERE id = ${actionId}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ActionRow))),
      Effect.map((rows) => (rows[0] ? decodeAction(rows[0]) : null)),
      Effect.orDie,
    );

  const getActionItem = (actionId: ActionId): Effect.Effect<ActionItem | null> =>
    sql`SELECT a.id, a.team_id, a.round_id, a.title, a.owner_id, p.email AS owner_email,
               a.due_date, a.dimension, a.status, a.created_at, a.updated_at, a.done_at
        FROM action a
        JOIN person p ON p.id = a.owner_id
        WHERE a.id = ${actionId}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ActionItemRow))),
      Effect.map((rows) => (rows[0] ? decodeActionItem(rows[0]) : null)),
      Effect.orDie,
    );

  const getActionsForTeam = (teamId: TeamId, roundId?: RoundId): Effect.Effect<ReadonlyArray<ActionItem>> =>
    (roundId !== undefined
      ? sql`SELECT a.id, a.team_id, a.round_id, a.title, a.owner_id, p.email AS owner_email,
                   a.due_date, a.dimension, a.status, a.created_at, a.updated_at, a.done_at
            FROM action a
            JOIN person p ON p.id = a.owner_id
            WHERE a.team_id = ${teamId} AND a.round_id = ${roundId}
            ORDER BY a.created_at ASC`
      : sql`SELECT a.id, a.team_id, a.round_id, a.title, a.owner_id, p.email AS owner_email,
                   a.due_date, a.dimension, a.status, a.created_at, a.updated_at, a.done_at
            FROM action a
            JOIN person p ON p.id = a.owner_id
            WHERE a.team_id = ${teamId}
            ORDER BY a.created_at ASC`
    ).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ActionItemRow))),
      Effect.map((rows) => rows.map(decodeActionItem)),
      Effect.orDie,
    );

  const insertAction = (record: ActionRecord): Effect.Effect<void> =>
    sql`INSERT INTO action (id, team_id, round_id, title, owner_id, due_date, dimension, status, created_at, updated_at, done_at)
        VALUES (${record.id}, ${record.teamId}, ${record.roundId}, ${record.title}, ${record.ownerId},
                ${record.dueDate}, ${record.dimension}, ${record.status}, ${record.createdAt}, ${record.updatedAt}, ${record.doneAt})`.pipe(
      Effect.asVoid,
      Effect.orDie,
    );

  const updateAction = (
    actionId: ActionId,
    updates: {
      readonly title: string;
      readonly ownerId: PersonId;
      readonly dueDate: string | null;
      readonly dimension: Dimension | null;
      readonly status: ActionStatus;
      readonly updatedAt: number;
      readonly doneAt: number | null;
    },
  ): Effect.Effect<void> =>
    sql`UPDATE action
        SET title = ${updates.title},
            owner_id = ${updates.ownerId},
            due_date = ${updates.dueDate},
            dimension = ${updates.dimension},
            status = ${updates.status},
            updated_at = ${updates.updatedAt},
            done_at = ${updates.doneAt}
        WHERE id = ${actionId}`.pipe(Effect.asVoid, Effect.orDie);

  const getEligibleActionsForRound = (
    teamId: TeamId,
    pulseId: PulseId,
    plannedOpenAt: number,
  ): Effect.Effect<ReadonlyArray<ActionRecord>> =>
    Effect.gen(function* () {
      const prevRows = yield* sql`
        SELECT opened_at, planned_open_at
        FROM round
        WHERE pulse_id = ${pulseId}
          AND planned_open_at < ${plannedOpenAt}
        ORDER BY planned_open_at DESC
        LIMIT 1`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(PreviousRoundRow))),
        Effect.orDie,
      );

      const previousRound = prevRows[0]
        ? { openedAt: prevRows[0].opened_at, plannedOpenAt: prevRows[0].planned_open_at }
        : null;

      const actionRows = yield* sql`
        SELECT id, team_id, round_id, title, owner_id, due_date, dimension, status, created_at, updated_at, done_at
        FROM action
        WHERE team_id = ${teamId}
        ORDER BY created_at ASC`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ActionRow))),
        Effect.map((rows) => rows.map(decodeAction)),
        Effect.orDie,
      );

      return selectActionsForRound(actionRows, previousRound);
    });

  return {
    getAction,
    getActionItem,
    getActionsForTeam,
    insertAction,
    updateAction,
    getEligibleActionsForRound,
  };
};

export type SqlActions = ReturnType<typeof makeSqlActions>;
