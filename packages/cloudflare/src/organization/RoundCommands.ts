import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  authorizeRoundAction,
  emailLocaleOf,
  hashToken,
  JobId,
  nextEightWeeksCadenceDates,
  type PersonId,
  roundCommandRejection,
  type RoundCommand,
  type RoundCommandResult,
  SendId,
  type makeSendStore,
  type TransactionalEmail,
  type InvitationTokenRef,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import type { makeSqlActions } from "../SqlActions.ts";
import type { makeSqlDirectory } from "../SqlDirectory.ts";
import type { makeSqlPulses } from "../SqlPulses.ts";
import type { makeSqlRounds } from "../SqlRounds.ts";
import { firstRatingQuestionOf, type makeRoundJobs, reviewEndsAtOf } from "./RoundJobs.ts";
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
  const both = Effect.all([directory.load, pulses.load]);
  const { scheduleNextRound } = scheduling;
  const { executeComputeJob, shareResults } = jobs;

  return {
    runRoundCommand: (actorId: PersonId, command: RoundCommand, now: number) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const [dirState, pulseState] = yield* both;
            const auth = authorizeRoundAction(dirState, actorId, "team.manageRounds", command.teamId);
            if (auth._tag === "Rejected") return auth satisfies RoundCommandResult;

            switch (command._tag) {
              case "SkipWeek": {
                const team = dirState.teams.find((t) => t.id === command.teamId);
                const pulse = pulseState.pulses.find((p) => p.id === command.pulseId);
                if (team === undefined) {
                  return {
                    _tag: "Rejected",
                    rejection: { _tag: "TeamNotFound" },
                  } satisfies RoundCommandResult;
                }
                if (pulse === undefined) {
                  return {
                    _tag: "Rejected",
                    rejection: { _tag: "PulseNotFound" },
                  } satisfies RoundCommandResult;
                }

                const validWeeks = nextEightWeeksCadenceDates(now, pulse.settings.cadence.day, team.timeZone);
                if (!validWeeks.includes(command.plannedOpenDate)) {
                  return {
                    _tag: "Rejected",
                    rejection: { _tag: "WeekOutOfRange" },
                  } satisfies RoundCommandResult;
                }

                yield* rounds.skipWeek(command.pulseId, command.plannedOpenDate, now);
                const scheduled = yield* rounds.findScheduledRound(command.pulseId);
                if (scheduled !== null && scheduled.plannedOpenDate === command.plannedOpenDate) {
                  yield* rounds.cancelRound(scheduled.id, now);
                  yield* rounds.cancelJobsForRound(scheduled.id);
                  yield* scheduleNextRound(command.pulseId, command.teamId, now);
                }
                yield* repairAlarm();
                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "UnskipWeek": {
                yield* rounds.unskipWeek(command.pulseId, command.plannedOpenDate);
                const scheduled = yield* rounds.findScheduledRound(command.pulseId);
                const open = yield* rounds.findOpenRound(command.pulseId);
                if (scheduled === null && open === null) {
                  yield* scheduleNextRound(command.pulseId, command.teamId, now);
                }
                yield* repairAlarm();
                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "PausePulse": {
                yield* rounds.pausePulse(command.pulseId, now);
                const scheduled = yield* rounds.findScheduledRound(command.pulseId);
                if (scheduled !== null) {
                  yield* rounds.cancelRound(scheduled.id, now);
                  yield* rounds.cancelJobsForRound(scheduled.id);
                }
                yield* repairAlarm();
                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "ResumePulse": {
                yield* rounds.resumePulse(command.pulseId);
                const scheduled = yield* rounds.findScheduledRound(command.pulseId);
                const open = yield* rounds.findOpenRound(command.pulseId);
                if (scheduled === null && open === null) {
                  yield* scheduleNextRound(command.pulseId, command.teamId, now);
                }
                yield* repairAlarm();
                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "CloseRoundEarly": {
                const round = yield* rounds.getRound(command.roundId);
                if (round === null || round.teamId !== command.teamId) {
                  return {
                    _tag: "Rejected",
                    rejection: { _tag: "RoundNotFound" },
                  } satisfies RoundCommandResult;
                }
                const rejection = roundCommandRejection(round.status, command);
                if (rejection !== null) {
                  return { _tag: "Rejected", rejection } satisfies RoundCommandResult;
                }

                const effectiveN = Math.max(
                  dirState.minimumGroupSize,
                  round.effectiveMinimumGroupSize ?? dirState.minimumGroupSize,
                );
                yield* rounds.closeRound(
                  round.id,
                  now,
                  effectiveN,
                  reviewEndsAtOf(pulseState, round.pulseId, now),
                );
                yield* rounds.cancelJobsForRound(round.id, ["send", "remind", "close"]);

                const computeJobId = JobId.make(randomId());
                yield* rounds.insertJob({
                  id: computeJobId,
                  roundId: round.id,
                  type: "compute",
                  dueAt: now,
                  status: "pending",
                  payload: null,
                  createdAt: now,
                  completedAt: null,
                });
                yield* executeComputeJob(computeJobId, round.id, now);
                yield* repairAlarm();
                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "ShareResults": {
                const round = yield* rounds.getRound(command.roundId);
                if (round === null || round.teamId !== command.teamId) {
                  return {
                    _tag: "Rejected",
                    rejection: { _tag: "RoundNotFound" },
                  } satisfies RoundCommandResult;
                }
                if (auth.actor.roles.get(command.teamId) !== "lead") {
                  return {
                    _tag: "Rejected",
                    rejection: { _tag: "Forbidden" },
                  } satisfies RoundCommandResult;
                }
                if (round.status === "shared") {
                  return { _tag: "Accepted" } satisfies RoundCommandResult;
                }
                const rejection = roundCommandRejection(round.status, command);
                if (rejection !== null) {
                  return { _tag: "Rejected", rejection } satisfies RoundCommandResult;
                }

                yield* shareResults(round.id, now);
                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "RetryResult": {
                const round = yield* rounds.getRound(command.roundId);
                if (round === null || round.teamId !== command.teamId) {
                  return {
                    _tag: "Rejected",
                    rejection: { _tag: "RoundNotFound" },
                  } satisfies RoundCommandResult;
                }
                if (auth.actor.roles.get(command.teamId) !== "lead") {
                  return {
                    _tag: "Rejected",
                    rejection: { _tag: "Forbidden" },
                  } satisfies RoundCommandResult;
                }
                if (round.status === "ready" || round.status === "shared") {
                  return { _tag: "Accepted" } satisfies RoundCommandResult;
                }
                const rejection = roundCommandRejection(round.status, command);
                if (rejection !== null) {
                  return { _tag: "Rejected", rejection } satisfies RoundCommandResult;
                }
                if (yield* rounds.hasPendingJob(round.id, "compute")) {
                  return { _tag: "Accepted" } satisfies RoundCommandResult;
                }

                yield* rounds.deleteRoundResult(round.id);
                const computeJobId = JobId.make(randomId());
                yield* rounds.insertJob({
                  id: computeJobId,
                  roundId: round.id,
                  type: "compute",
                  dueAt: now,
                  status: "pending",
                  payload: null,
                  createdAt: now,
                  completedAt: null,
                });
                yield* executeComputeJob(computeJobId, round.id, now);
                yield* repairAlarm();
                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "CancelRound": {
                const round = yield* rounds.getRound(command.roundId);
                if (round === null || round.teamId !== command.teamId) {
                  return {
                    _tag: "Rejected",
                    rejection: { _tag: "RoundNotFound" },
                  } satisfies RoundCommandResult;
                }
                const rejection = roundCommandRejection(round.status, command);
                if (rejection !== null) {
                  return { _tag: "Rejected", rejection } satisfies RoundCommandResult;
                }

                yield* rounds.cancelRound(round.id, now);
                yield* rounds.cancelJobsForRound(round.id);
                yield* rounds.revokeInvitationsForRound(round.id, now);
                yield* rounds.deleteSubmissionsAndParticipations(round.id);
                yield* repairAlarm();
                return { _tag: "Accepted" } satisfies RoundCommandResult;
              }

              case "ResendInvitation": {
                const round = yield* rounds.getRound(command.roundId);
                if (round === null || round.teamId !== command.teamId) {
                  return {
                    _tag: "Rejected",
                    rejection: { _tag: "RoundNotFound" },
                  } satisfies RoundCommandResult;
                }
                const rejection = roundCommandRejection(round.status, command);
                if (rejection !== null) {
                  return { _tag: "Rejected", rejection } satisfies RoundCommandResult;
                }

                const inv = yield* rounds.getInvitation(command.roundId, command.personId);
                if (inv === null) {
                  return {
                    _tag: "Rejected",
                    rejection: { _tag: "InvitationNotFound" },
                  } satisfies RoundCommandResult;
                }

                const [dirState, pulseState] = yield* both;
                const person = dirState.people.find((p) => p.id === command.personId);
                if (person === undefined || person.removedAt !== null) {
                  return {
                    _tag: "Rejected",
                    rejection: { _tag: "InvitationNotFound" },
                  } satisfies RoundCommandResult;
                }

                const pulse = pulseState.pulses.find((p) => p.id === round.pulseId);
                if (pulse === undefined) {
                  return {
                    _tag: "Rejected",
                    rejection: { _tag: "PulseNotFound" },
                  } satisfies RoundCommandResult;
                }

                const invitation = {
                  roundId: command.roundId,
                  personId: command.personId,
                  generation: inv.resendCount + 1,
                };
                const newTokenHash = yield* tokenOf(invitation).pipe(
                  Effect.flatMap((token) => Effect.promise(() => hashToken(token))),
                );
                const newSendId = SendId.make(randomId());
                yield* rounds.resendInvitation(
                  command.roundId,
                  command.personId,
                  newSendId,
                  newTokenHash,
                  now,
                );

                const ratingQuestion = firstRatingQuestionOf(pulse, pulseState);
                const eligibleActions = yield* actions.getEligibleActionsForRound(
                  round.teamId,
                  round.pulseId,
                  round.plannedOpenAt,
                );

                const invitationEmail: TransactionalEmail = {
                  _tag: "InvitationEmail",
                  locale: emailLocaleOf(dirState, person.id),
                  pulseName: pulse.settings.name,
                  minimumGroupSize: dirState.minimumGroupSize,
                  invitation,
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
