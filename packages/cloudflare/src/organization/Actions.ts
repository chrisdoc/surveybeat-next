import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  ActionId,
  type ActionItem,
  type ActionList,
  type ActionViewed,
  authorizeRoundAction,
  type CreateAction,
  PersonId,
  TeamId,
  type UpdateAction,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import type { makeSqlActions } from "../SqlActions.ts";
import type { makeSqlDirectory } from "../SqlDirectory.ts";
import type { makeSqlRounds } from "../SqlRounds.ts";

export const organizationActions = ({
  actions,
  rounds,
  directory,
  sql,
  randomId,
}: {
  actions: ReturnType<typeof makeSqlActions>;
  rounds: ReturnType<typeof makeSqlRounds>;
  directory: ReturnType<typeof makeSqlDirectory>;
  sql: SqliteClient.SqliteClient;
  randomId: () => string;
}) => ({
  listActions: (actorId: PersonId, teamId: TeamId): Effect.Effect<ActionViewed<ActionList>, never, never> =>
    Effect.gen(function* () {
      const dirState = yield* directory.load;
      const auth = authorizeRoundAction(dirState, actorId, "team.viewActions", teamId);
      if (auth._tag === "Rejected") {
        const rejected: ActionViewed<ActionList> = {
          _tag: "Rejected",
          rejection: { _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden" },
        };
        return rejected;
      }
      const team = dirState.teams.find((t) => t.id === teamId);
      if (team === undefined) {
        const rejected: ActionViewed<ActionList> = {
          _tag: "Rejected",
          rejection: { _tag: "TeamNotFound" },
        };
        return rejected;
      }
      const all = yield* actions.getActionsForTeam(teamId);
      const viewed: ActionViewed<ActionList> = {
        _tag: "Viewed",
        value: {
          teamId,
          actions: all,
        },
      };
      return viewed;
    }).pipe(Effect.orDie),

  createAction: (
    actorId: PersonId,
    teamId: TeamId,
    payload: CreateAction,
    now: number,
  ): Effect.Effect<ActionViewed<ActionItem>, never, never> =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const dirState = yield* directory.load;
          const auth = authorizeRoundAction(dirState, actorId, "team.createAction", teamId);
          if (auth._tag === "Rejected") {
            const rejected: ActionViewed<ActionItem> = {
              _tag: "Rejected",
              rejection: {
                _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden",
              },
            };
            return rejected;
          }
          const team = dirState.teams.find((t) => t.id === teamId);
          if (team === undefined) {
            const rejected: ActionViewed<ActionItem> = {
              _tag: "Rejected",
              rejection: { _tag: "TeamNotFound" },
            };
            return rejected;
          }
          const isMember = dirState.memberships.some(
            (m) => m.teamId === teamId && m.personId === payload.ownerId && m.endedAt === null,
          );
          if (!isMember) {
            const rejected: ActionViewed<ActionItem> = {
              _tag: "Rejected",
              rejection: { _tag: "OwnerNotInTeam" },
            };
            return rejected;
          }
          const round = yield* rounds.getRound(payload.roundId);
          if (round === null || round.teamId !== teamId) {
            const rejected: ActionViewed<ActionItem> = {
              _tag: "Rejected",
              rejection: { _tag: "RoundNotFound" },
            };
            return rejected;
          }

          const actionId = ActionId.make(randomId());
          yield* actions.insertAction({
            id: actionId,
            teamId,
            roundId: payload.roundId,
            title: payload.title,
            ownerId: payload.ownerId,
            dueDate: payload.dueDate ?? null,
            dimension: payload.dimension ?? null,
            status: "committed",
            createdAt: now,
            updatedAt: now,
            doneAt: null,
          });

          const item = yield* actions.getActionItem(actionId);
          const viewed: ActionViewed<ActionItem> = {
            _tag: "Viewed",
            value: item!,
          };
          return viewed;
        }),
      )
      .pipe(Effect.orDie),

  updateAction: (
    actorId: PersonId,
    teamId: TeamId,
    actionId: ActionId,
    payload: UpdateAction,
    now: number,
  ): Effect.Effect<ActionViewed<ActionItem>, never, never> =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const dirState = yield* directory.load;
          const auth = authorizeRoundAction(dirState, actorId, "team.updateAction", teamId);
          if (auth._tag === "Rejected") {
            const rejected: ActionViewed<ActionItem> = {
              _tag: "Rejected",
              rejection: {
                _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden",
              },
            };
            return rejected;
          }
          const team = dirState.teams.find((t) => t.id === teamId);
          if (team === undefined) {
            const rejected: ActionViewed<ActionItem> = {
              _tag: "Rejected",
              rejection: { _tag: "TeamNotFound" },
            };
            return rejected;
          }
          const existing = yield* actions.getAction(actionId);
          if (existing === null || existing.teamId !== teamId) {
            const rejected: ActionViewed<ActionItem> = {
              _tag: "Rejected",
              rejection: { _tag: "ActionNotFound" },
            };
            return rejected;
          }

          if (payload.ownerId !== undefined) {
            const isMember = dirState.memberships.some(
              (m) => m.teamId === teamId && m.personId === payload.ownerId && m.endedAt === null,
            );
            if (!isMember) {
              const rejected: ActionViewed<ActionItem> = {
                _tag: "Rejected",
                rejection: { _tag: "OwnerNotInTeam" },
              };
              return rejected;
            }
          }

          let newDoneAt: number | null = existing.doneAt;
          if (payload.status === "done" && existing.status !== "done") {
            newDoneAt = now;
          } else if (payload.status !== undefined && payload.status !== "done") {
            newDoneAt = null;
          }

          yield* actions.updateAction(actionId, {
            title: payload.title ?? existing.title,
            ownerId: payload.ownerId ?? existing.ownerId,
            dueDate: payload.dueDate !== undefined ? payload.dueDate : existing.dueDate,
            dimension: payload.dimension !== undefined ? payload.dimension : existing.dimension,
            status: payload.status ?? existing.status,
            updatedAt: now,
            doneAt: newDoneAt,
          });

          const item = yield* actions.getActionItem(actionId);
          const viewed: ActionViewed<ActionItem> = {
            _tag: "Viewed",
            value: item!,
          };
          return viewed;
        }),
      )
      .pipe(Effect.orDie),
});
