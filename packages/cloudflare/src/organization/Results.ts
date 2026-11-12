import {
  authorizeRoundAction,
  buildMemberHistory,
  buildTeamOverview,
  calculateRoundResult,
  delayedRoundResult,
  type MemberHistory,
  PersonId,
  RoundId,
  type RoundResult,
  type RoundViewed,
  TeamId,
  type TeamOverview,
  viewRoundResult,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import type { makeSqlActions } from "../SqlActions.ts";
import type { makeSqlDirectory } from "../SqlDirectory.ts";
import type { makeSqlRounds } from "../SqlRounds.ts";

export const organizationResults = ({
  rounds,
  directory,
  actions,
}: {
  rounds: ReturnType<typeof makeSqlRounds>;
  directory: ReturnType<typeof makeSqlDirectory>;
  actions: ReturnType<typeof makeSqlActions>;
}) => ({
  viewResults: (
    actorId: PersonId,
    teamId: TeamId,
    roundId: RoundId,
  ): Effect.Effect<RoundViewed<RoundResult>, never, never> =>
    Effect.gen(function* () {
      const dirState = yield* directory.load;
      const auth = authorizeRoundAction(dirState, actorId, "team.viewResults", teamId);
      if (auth._tag === "Rejected") {
        const rejected: RoundViewed<RoundResult> = auth;
        return rejected;
      }

      const team = dirState.teams.find((t) => t.id === teamId);
      if (team === undefined) {
        const rejected: RoundViewed<RoundResult> = {
          _tag: "Rejected",
          rejection: { _tag: "TeamNotFound" },
        };
        return rejected;
      }

      const r = yield* rounds.getRound(roundId);
      if (r === null || r.teamId !== teamId) {
        const rejected: RoundViewed<RoundResult> = {
          _tag: "Rejected",
          rejection: { _tag: "RoundNotFound" },
        };
        return rejected;
      }

      const effectiveN = Math.max(
        dirState.minimumGroupSize,
        r.effectiveMinimumGroupSize ?? dirState.minimumGroupSize,
      );

      if (r.status === "scheduled" || r.status === "open") {
        const submissions = yield* rounds.getSubmissionsForRound(roundId);
        const eligibleMembersCount = yield* rounds.getRoundMembersCount(roundId);
        const questions = yield* rounds.getRoundQuestionsDetailed(roundId);

        const openResult = calculateRoundResult({
          roundId,
          pulseId: r.pulseId,
          teamId: r.teamId,
          status: r.status,
          plannedOpenDate: r.plannedOpenDate,
          anonymityMode: r.anonymityMode,
          closedAt: r.closedAt,
          effectiveMinimumGroupSize: effectiveN,
          eligibleMembersCount,
          questions,
          submissions,
          pastRoundsHistory: [],
        });

        return { _tag: "Viewed", value: openResult } satisfies RoundViewed<RoundResult>;
      }

      const storedResult = yield* rounds.getRoundResult(roundId);
      const resultPending = storedResult === null && (yield* rounds.hasPendingJob(roundId, "compute"));
      const result: RoundResult =
        storedResult ??
        delayedRoundResult({
          roundId,
          pulseId: r.pulseId,
          teamId: r.teamId,
          status: r.status,
          plannedOpenDate: r.plannedOpenDate,
          anonymityMode: r.anonymityMode,
          closedAt: r.closedAt,
          effectiveMinimumGroupSize: effectiveN,
          eligibleMembersCount: yield* rounds.getRoundMembersCount(roundId),
          submissionsCount: (yield* rounds.getSubmissionsForRound(roundId)).length,
        });

      const isLead = auth.actor.roles.get(teamId) === "lead";
      const themes = yield* rounds.getRoundThemes(roundId);
      const resultToShow = viewRoundResult({
        stored: result,
        organizationN: dirState.minimumGroupSize,
        isLead,
        themes,
        round: { status: r.status, reviewEndsAt: r.reviewEndsAt },
        resultPending,
      });

      const viewed: RoundViewed<RoundResult> = {
        _tag: "Viewed",
        value: resultToShow,
      };
      return viewed;
    }).pipe(Effect.orDie),

  viewTeamOverview: (
    actorId: PersonId,
    teamId: TeamId,
  ): Effect.Effect<RoundViewed<TeamOverview>, never, never> =>
    Effect.gen(function* () {
      const dirState = yield* directory.load;
      const auth = authorizeRoundAction(dirState, actorId, "team.viewResults", teamId);
      if (auth._tag === "Rejected") {
        const rejected: RoundViewed<TeamOverview> = auth;
        return rejected;
      }

      const team = dirState.teams.find((t) => t.id === teamId);
      if (team === undefined) {
        const rejected: RoundViewed<TeamOverview> = {
          _tag: "Rejected",
          rejection: { _tag: "TeamNotFound" },
        };
        return rejected;
      }

      const results = yield* rounds.getSharedRoundResultsForTeam(teamId);
      const teamActions = yield* actions.getActionsForTeam(teamId);
      const viewed: RoundViewed<TeamOverview> = {
        _tag: "Viewed",
        value: buildTeamOverview({
          teamId,
          results,
          minimumGroupSize: dirState.minimumGroupSize,
          actions: teamActions,
        }),
      };
      return viewed;
    }).pipe(Effect.orDie),

  viewMemberHistory: (actorId: PersonId): Effect.Effect<MemberHistory, never, never> =>
    Effect.gen(function* () {
      const dirState = yield* directory.load;
      const participated = yield* rounds.getParticipatedRounds(actorId);
      const inputs = yield* Effect.forEach(participated, (row) =>
        Effect.map(rounds.getRoundQuestionsDetailed(row.roundId), (questions) => ({
          ...row,
          questions,
          canViewResults:
            authorizeRoundAction(dirState, actorId, "team.viewResults", row.teamId)._tag !== "Rejected",
        })),
      );
      return buildMemberHistory({ rounds: inputs, minimumGroupSize: dirState.minimumGroupSize });
    }).pipe(Effect.orDie),
});
