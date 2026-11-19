import { authorizeRoundAction, findPulse, invitationSummaryOf, teamSummaryOf } from "@surveybeat/domain";
import type {
  PersonId,
  RoundId,
  TeamId,
  PulseId,
  RoundDetail,
  RoundList,
  RoundSummary,
  RoundViewed,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import type { makeSqlDirectory } from "../SqlDirectory.ts";
import type { makeSqlPulses } from "../SqlPulses.ts";
import type { makeSqlRounds } from "../SqlRounds.ts";

export const organizationRoundViews = ({
  rounds,
  directory,
  pulses,
}: {
  rounds: ReturnType<typeof makeSqlRounds>;
  directory: ReturnType<typeof makeSqlDirectory>;
  pulses: ReturnType<typeof makeSqlPulses>;
}) => ({
  viewRounds: (actorId: PersonId, teamId: TeamId, pulseId: PulseId): Effect.Effect<RoundViewed<RoundList>> =>
    Effect.gen(function* () {
      const dirState = yield* directory.load;
      const auth = authorizeRoundAction(dirState, actorId, "team.viewRounds", teamId);
      if (auth._tag === "Rejected") {
        const rejected: RoundViewed<RoundList> = auth;
        return rejected;
      }
      if (findPulse(yield* pulses.load, teamId, pulseId) === undefined) {
        const rejected: RoundViewed<RoundList> = { _tag: "Rejected", rejection: { _tag: "PulseNotFound" } };
        return rejected;
      }
      const all = yield* rounds.getRoundsForPulse(pulseId);
      const invitedByRound = yield* rounds.getInvitedPersonIdsForPulse(pulseId);
      const paused = yield* rounds.isPulsePaused(pulseId);
      const viewed: RoundViewed<RoundList> = {
        _tag: "Viewed",
        value: {
          pulseId,
          paused,
          rounds: all.map((r): RoundSummary => ({
            id: r.id,
            pulseId: r.pulseId,
            teamId: r.teamId,
            status: r.status,
            plannedOpenDate: r.plannedOpenDate,
            plannedOpenAt: r.plannedOpenAt,
            openedAt: r.openedAt,
            plannedCloseAt: r.plannedCloseAt,
            closedAt: r.closedAt,
            pulseName: r.pulseName,
            invitations: invitationSummaryOf({
              round: r,
              invitedPersonIds: invitedByRound.get(r.id) ?? new Set<PersonId>(),
              memberships: dirState.memberships,
            }),
          })),
        },
      };
      return viewed;
    }).pipe(Effect.orDie),

  viewRound: (actorId: PersonId, teamId: TeamId, roundId: RoundId): Effect.Effect<RoundViewed<RoundDetail>> =>
    Effect.gen(function* () {
      const dirState = yield* directory.load;
      const auth = authorizeRoundAction(dirState, actorId, "team.viewRounds", teamId);
      if (auth._tag === "Rejected") {
        const rejected: RoundViewed<RoundDetail> = auth;
        return rejected;
      }
      const team = dirState.teams.find((t) => t.id === teamId);
      if (team === undefined) {
        const rejected: RoundViewed<RoundDetail> = {
          _tag: "Rejected",
          rejection: { _tag: "TeamNotFound" },
        };
        return rejected;
      }
      const r = yield* rounds.getRound(roundId);
      if (r === null || r.teamId !== teamId) {
        const rejected: RoundViewed<RoundDetail> = {
          _tag: "Rejected",
          rejection: { _tag: "RoundNotFound" },
        };
        return rejected;
      }
      const questions = yield* rounds.getRoundQuestions(roundId);
      const failedInvitations = yield* rounds.getFailedInvitations(roundId);
      const viewed: RoundViewed<RoundDetail> = {
        _tag: "Viewed",
        value: {
          id: r.id,
          pulseId: r.pulseId,
          team: teamSummaryOf(team, auth.actor),
          status: r.status,
          plannedOpenDate: r.plannedOpenDate,
          plannedOpenAt: r.plannedOpenAt,
          openedAt: r.openedAt,
          plannedCloseAt: r.plannedCloseAt,
          closedAt: r.closedAt,
          effectiveMinimumGroupSize: r.effectiveMinimumGroupSize,
          pulseName: r.pulseName,
          answerWindowDays: r.answerWindowDays,
          reminders: r.reminders,
          anonymityMode: r.anonymityMode,
          distribution: r.distribution,
          questions,
          failedInvitations,
          createdAt: r.createdAt,
        },
      };
      return viewed;
    }).pipe(Effect.orDie),
});
