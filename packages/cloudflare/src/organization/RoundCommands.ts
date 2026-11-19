import type { SqliteClient } from "@effect/sql-sqlite-do";
import { decideRoundCommand, emailLocaleOf, hashToken, JobId, SendId } from "@surveybeat/domain";
import type {
  PersonId,
  RoundCommand,
  RoundCommandResult,
  makeSendStore,
  TransactionalEmail,
  InvitationTokenRef,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import type { makeSqlActions } from "../SqlActions.ts";
import type { makeSqlDirectory } from "../SqlDirectory.ts";
import type { makeSqlPulses } from "../SqlPulses.ts";
import type { makeSqlRounds } from "../SqlRounds.ts";
import { firstRatingQuestionOf, reviewEndsAtOf } from "./RoundJobs.ts";
import type { makeRoundJobs } from "./RoundJobs.ts";
import type { makeScheduling } from "./Scheduling.ts";

export const organizationRoundCommands = ({
  sql,
  rounds,
  directory,
  pulses,
  actions,
  sends,
  scheduling,
  jobs,
  repairAlarm,
  randomId,
  tokenOf,
  appOrigin,
}: {
  sql: SqliteClient.SqliteClient;
  rounds: ReturnType<typeof makeSqlRounds>;
  directory: ReturnType<typeof makeSqlDirectory>;
  pulses: ReturnType<typeof makeSqlPulses>;
  actions: ReturnType<typeof makeSqlActions>;
  sends: ReturnType<typeof makeSendStore>;
  scheduling: ReturnType<typeof makeScheduling>;
  jobs: ReturnType<typeof makeRoundJobs>;
  repairAlarm: () => Effect.Effect<void>;
  randomId: () => string;
  tokenOf: (ref: InvitationTokenRef) => Effect.Effect<string>;
  appOrigin: string;
}) => {
  const { scheduleNextRound } = scheduling;
  const { executeComputeJob, shareResults } = jobs;

  return {
    runRoundCommand: (actorId: PersonId, command: RoundCommand, now: number) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const dirState = yield* directory.load;
            const pulseState = yield* pulses.load;
            const round = "roundId" in command ? yield* rounds.getRound(command.roundId) : null;

            const invitation =
              command._tag === "ResendInvitation"
                ? yield* rounds.getInvitation(command.roundId, command.personId)
                : null;

            const computePending =
              command._tag === "RetryResult" && round !== null
                ? yield* rounds.hasPendingJob(round.id, "compute")
                : false;

            const decision = decideRoundCommand({
              directory: dirState,
              pulses: pulseState,
              actorId,
              command,
              now,
              round,
              invitation,
              computePending,
            });

            if (decision._tag === "Rejected") {
              return { _tag: "Rejected", rejection: decision.rejection } satisfies RoundCommandResult;
            }

            if (decision._tag === "Unchanged") {
              return { _tag: "Accepted" } satisfies RoundCommandResult;
            }

            const plan = decision.plan;

            switch (plan._tag) {
              case "SkipWeek": {
                yield* rounds.skipWeek(plan.pulseId, plan.plannedOpenDate, now);
                const scheduled = yield* rounds.findScheduledRound(plan.pulseId);

                if (scheduled !== null && scheduled.plannedOpenDate === plan.plannedOpenDate) {
                  yield* rounds.cancelRound(scheduled.id, now);
                  yield* rounds.cancelJobsForRound(scheduled.id);
                  yield* scheduleNextRound(plan.pulseId, plan.teamId, now);
                }

                yield* repairAlarm();

                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "UnskipWeek": {
                yield* rounds.unskipWeek(plan.pulseId, plan.plannedOpenDate);
                const scheduled = yield* rounds.findScheduledRound(plan.pulseId);
                const open = yield* rounds.findOpenRound(plan.pulseId);

                if (scheduled === null && open === null) {
                  yield* scheduleNextRound(plan.pulseId, plan.teamId, now);
                }

                yield* repairAlarm();

                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "PausePulse": {
                yield* rounds.pausePulse(plan.pulseId, now);
                const scheduled = yield* rounds.findScheduledRound(plan.pulseId);

                if (scheduled !== null) {
                  yield* rounds.cancelRound(scheduled.id, now);
                  yield* rounds.cancelJobsForRound(scheduled.id);
                }

                yield* repairAlarm();

                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "ResumePulse": {
                yield* rounds.resumePulse(plan.pulseId);
                const scheduled = yield* rounds.findScheduledRound(plan.pulseId);
                const open = yield* rounds.findOpenRound(plan.pulseId);

                if (scheduled === null && open === null) {
                  yield* scheduleNextRound(plan.pulseId, plan.teamId, now);
                }

                yield* repairAlarm();

                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "CloseRoundEarly": {
                yield* rounds.closeRound(
                  plan.roundId,
                  now,
                  plan.effectiveN,
                  reviewEndsAtOf(pulseState, plan.pulseId, now),
                );
                yield* rounds.cancelJobsForRound(plan.roundId, ["send", "remind", "close"]);

                const computeJobId = JobId.make(randomId());
                yield* rounds.insertJob({
                  id: computeJobId,
                  roundId: plan.roundId,
                  type: "compute",
                  dueAt: now,
                  status: "pending",
                  payload: null,
                  createdAt: now,
                  completedAt: null,
                });
                yield* executeComputeJob(computeJobId, plan.roundId, now);
                yield* repairAlarm();

                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "ShareResults": {
                yield* shareResults(plan.roundId, now);

                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "RetryResult": {
                yield* rounds.deleteRoundResult(plan.roundId);
                const computeJobId = JobId.make(randomId());
                yield* rounds.insertJob({
                  id: computeJobId,
                  roundId: plan.roundId,
                  type: "compute",
                  dueAt: now,
                  status: "pending",
                  payload: null,
                  createdAt: now,
                  completedAt: null,
                });
                yield* executeComputeJob(computeJobId, plan.roundId, now);
                yield* repairAlarm();

                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "CancelRound": {
                yield* rounds.cancelRound(plan.roundId, now);
                yield* rounds.cancelJobsForRound(plan.roundId);
                yield* rounds.revokeInvitationsForRound(plan.roundId, now);
                yield* rounds.deleteSubmissionsAndParticipations(plan.roundId);
                yield* repairAlarm();

                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "ResendInvitation": {
                const { round: target, person, pulse, generation } = plan;
                const invitationRef = { roundId: target.id, personId: person.id, generation };

                const newTokenHash = yield* tokenOf(invitationRef).pipe(
                  Effect.flatMap((token) => Effect.promise(() => hashToken(token))),
                );

                const newSendId = SendId.make(randomId());
                yield* rounds.resendInvitation(target.id, person.id, newSendId, newTokenHash, now);

                const ratingQuestion = firstRatingQuestionOf(
                  yield* rounds.getRoundQuestions(target.id),
                  pulseState,
                );

                const eligibleActions = yield* actions.getEligibleActionsForRound(
                  target.teamId,
                  target.pulseId,
                  target.plannedOpenAt,
                );

                const invitationEmail: TransactionalEmail = {
                  _tag: "InvitationEmail",
                  locale: emailLocaleOf(dirState, person.id),
                  pulseName: pulse.settings.name,
                  minimumGroupSize: dirState.minimumGroupSize,
                  invitation: invitationRef,
                  baseUrl: appOrigin,
                  ratingQuestion,
                  actions: eligibleActions.slice(0, 3).map((a) => a.title),
                  aiProcessing: dirState.aiProcessing,
                };

                yield* sends.create(newSendId, person.email, invitationEmail);

                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }
            }
          }),
        )
        .pipe(Effect.orDie),
  };
};
