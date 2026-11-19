import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  AiClient,
  buildThemesInput,
  calculateReminders,
  calculateResultsReadyDeliveryTime,
  calculateRoundInstants,
  calculateRoundResult,
  delayedRoundResult,
  emailLocaleOf,
  enforceEffectiveNOnResult,
  hashToken,
  JobId,
  nextJobAttemptAt,
  nextRetryAt,
  PersonId,
  RoundId,
  runThemesAttempt,
  SendId,
  shouldRequestThemes,
} from "@surveybeat/domain";
import type {
  DirectoryState,
  FrozenRoundMember,
  InvitationTokenRef,
  PulseId,
  PulseState,
  QuestionVersionId,
  RoundRecord,
  makeSendStore,
  ScheduleJobRecord,
  StoredEmail,
  TeamId,
  TransactionalEmail,
} from "@surveybeat/domain";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { failureSummary } from "./JobFailure.ts";
import type { makeOpenRouterAiClient } from "../ai/OpenRouterAiClient.ts";
import type { makeSqlActions } from "../SqlActions.ts";
import type { makeSqlDirectory } from "../SqlDirectory.ts";
import type { makeSqlPulses } from "../SqlPulses.ts";
import type { makeSqlRounds } from "../SqlRounds.ts";
import type { makeScheduling } from "./Scheduling.ts";

const THEMES_LEASE_MS = 10 * 60_000;

const AttemptsPayload = Schema.Struct({ attempts: Schema.Int });

const parseAttempts = (payload: string | null): number => {
  if (payload === null) {
    return 0;
  }

  try {
    const p: unknown = JSON.parse(payload);
    const decoded = Schema.decodeUnknownOption(AttemptsPayload)(p);

    return Option.match(decoded, {
      onNone: () => 0,
      onSome: (val) => val.attempts,
    });
  } catch {
    return 0;
  }
};

export const reviewEndsAtOf = (pulseState: PulseState, pulseId: PulseId, now: number) => {
  const pulse = pulseState.pulses.find((p) => p.id === pulseId);

  return now + (pulse?.settings.reviewWindowDays ?? 0) * 86_400_000;
};

export const firstRatingQuestionOf = (
  questionVersionIds: readonly QuestionVersionId[],
  pulseState: PulseState,
) => {
  const firstVersionId = questionVersionIds[0];

  const firstVersion =
    firstVersionId !== undefined ? pulseState.versions.find((v) => v.id === firstVersionId) : undefined;

  return firstVersion && firstVersion.content.type._tag === "Rating"
    ? {
        text: firstVersion.content.text,
        lowLabel: firstVersion.content.type.lowLabel,
        highLabel: firstVersion.content.type.highLabel,
      }
    : null;
};

const InvitationJobPayload = Schema.Struct({
  personId: Schema.String,
  token: Schema.optionalKey(Schema.String),
});

const decodeInvitationJobPayload = Schema.decodeUnknownOption(InvitationJobPayload);

const ResultsReadyJobPayload = Schema.Struct({
  kind: Schema.Literal("resultsReady"),
  personId: Schema.String,
  roundId: Schema.String,
});

const decodeResultsReadyJobPayload = Schema.decodeUnknownOption(ResultsReadyJobPayload);

const parseJobPayload = (
  raw: string | null,
): { readonly personId: string; readonly token?: string } | null => {
  if (raw === null) {
    return null;
  }

  try {
    return Option.getOrNull(decodeInvitationJobPayload(JSON.parse(raw)));
  } catch {
    return null;
  }
};

const parseSendPayload = (
  raw: string | null,
):
  | { readonly kind: "resultsReady"; readonly personId: string; readonly roundId: string }
  | { readonly personId: string; readonly token?: string }
  | null => {
  if (raw === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const rr = Option.getOrNull(decodeResultsReadyJobPayload(parsed));

    if (rr !== null) {
      return rr;
    }

    return Option.getOrNull(decodeInvitationJobPayload(parsed));
  } catch {
    return null;
  }
};

const activePersonsWithRole = (dirState: DirectoryState, teamId: TeamId, role: "lead" | "member") =>
  dirState.memberships
    .filter((m) => m.teamId === teamId && m.endedAt === null && m.role === role)
    .map((m) => m.personId);

export const makeRoundJobs = ({
  sql,
  rounds,
  directory,
  pulses,
  actions,
  sends,
  scheduling,
  repairAlarm,
  randomId,
  tokenOf,
  appOrigin,
  ai,
}: {
  sql: SqliteClient.SqliteClient;
  rounds: ReturnType<typeof makeSqlRounds>;
  directory: ReturnType<typeof makeSqlDirectory>;
  pulses: ReturnType<typeof makeSqlPulses>;
  actions: ReturnType<typeof makeSqlActions>;
  sends: ReturnType<typeof makeSendStore>;
  scheduling: ReturnType<typeof makeScheduling>;
  repairAlarm: () => Effect.Effect<void>;
  randomId: () => string;
  tokenOf: (ref: InvitationTokenRef) => Effect.Effect<string>;
  appOrigin: string;
  ai: ReturnType<typeof makeOpenRouterAiClient>;
}) => {
  const both = Effect.all([directory.load, pulses.load]);
  const { activeMembersWithTimeZones, scheduleNextRound } = scheduling;
  const injectedComputeFailures = new Map<RoundId, number>();

  const executeOpenJob = (jobId: JobId, roundId: RoundId, now: number) =>
    Effect.gen(function* () {
      const job = yield* rounds.getJob(jobId);

      if (job === null || job.status !== "pending") {
        return;
      }

      if (job.dueAt > now) {
        return;
      }

      const round = yield* rounds.getRound(roundId);

      if (round === null || round.status !== "scheduled") {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const existingInvitations = yield* rounds.getInvitations(roundId);

      if (existingInvitations.length > 0) {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const [dirState, pulseState] = yield* both;
      const pulse = pulseState.pulses.find((p) => p.id === round.pulseId);
      const team = dirState.teams.find((t) => t.id === round.teamId);

      if (pulse === undefined || team === undefined) {
        yield* rounds.cancelRound(roundId, now);
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const { activeMembers, memberTimeZones } = yield* activeMembersWithTimeZones(
        dirState,
        round.teamId,
        team.timeZone,
      );

      const instants = calculateRoundInstants(
        round.plannedOpenDate,
        pulse.settings.cadence.time,
        memberTimeZones,
        team.timeZone,
        round.answerWindowDays,
      );

      const frozenMembers: readonly FrozenRoundMember[] = activeMembers.map((m, idx) => {
        const tz = memberTimeZones[idx] ?? team.timeZone;
        const sendAt = instants.sends.find((s) => s.timeZone === tz)?.sendAt ?? instants.openInstant;

        return {
          roundId,
          personId: m.personId,
          timeZone: tz,
          sendAt,
        };
      });

      yield* rounds.openRound(roundId, now, instants.closeInstant, pulse.questions, frozenMembers);

      const ratingQuestion = firstRatingQuestionOf(yield* rounds.getRoundQuestions(roundId), pulseState);

      const eligibleActions = yield* actions.getEligibleActionsForRound(
        round.teamId,
        round.pulseId,
        round.plannedOpenAt,
      );

      const emailActions = eligibleActions.slice(0, 3).map((a) => a.title);

      for (const m of frozenMembers) {
        const person = dirState.people.find((p) => p.id === m.personId);

        if (person === undefined || person.removedAt !== null) {
          continue;
        }

        const invitation = { roundId, personId: m.personId, generation: 0 };

        const tokenHash = yield* tokenOf(invitation).pipe(
          Effect.flatMap((token) => Effect.promise(() => hashToken(token))),
        );

        const sendId = SendId.make(randomId());

        yield* rounds.insertInvitations([
          {
            roundId,
            personId: m.personId,
            tokenHash,
            sendId,
            status: "pending",
            failedReason: null,
            resendCount: 0,
            createdAt: now,
            updatedAt: now,
          },
        ]);

        const invitationEmail: TransactionalEmail = {
          _tag: "InvitationEmail",
          locale: emailLocaleOf(dirState, person.id),
          pulseName: pulse.settings.name,
          minimumGroupSize: dirState.minimumGroupSize,
          invitation,
          baseUrl: appOrigin,
          ratingQuestion,
          actions: emailActions,
          aiProcessing: dirState.aiProcessing,
        };

        yield* m.sendAt <= now
          ? sends.create(sendId, person.email, invitationEmail)
          : rounds.insertJob({
              id: JobId.make(randomId()),
              roundId,
              type: "send",
              dueAt: m.sendAt,
              status: "pending",
              payload: JSON.stringify({ personId: m.personId }),
              createdAt: now,
              completedAt: null,
              failures: 0,
            });

        const reminderInstants = calculateReminders(
          m.sendAt,
          round.answerWindowDays,
          pulse.settings.reminders,
          instants.closeInstant,
        );

        for (const remindAt of reminderInstants) {
          yield* rounds.insertJob({
            id: JobId.make(randomId()),
            roundId,
            type: "remind",
            dueAt: remindAt,
            status: "pending",
            payload: JSON.stringify({ personId: m.personId }),
            createdAt: now,
            completedAt: null,
            failures: 0,
          });
        }
      }

      yield* rounds.insertJob({
        id: JobId.make(randomId()),
        roundId,
        type: "close",
        dueAt: instants.closeInstant,
        status: "pending",
        payload: null,
        createdAt: now,
        completedAt: null,
        failures: 0,
      });

      yield* rounds.markJobCompleted(jobId, now);

      yield* scheduleNextRound(round.pulseId, round.teamId, now);
    });

  const executeSendJob = (jobId: JobId, roundId: RoundId, now: number) =>
    Effect.gen(function* () {
      const job = yield* rounds.getJob(jobId);

      if (job === null || job.status !== "pending") {
        return;
      }

      const round = yield* rounds.getRound(roundId);

      if (round === null) {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const payload = parseSendPayload(job.payload);

      if (payload === null) {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      if ("kind" in payload) {
        if (round.status !== "ready" && round.status !== "shared") {
          yield* rounds.markJobCompleted(jobId, now);

          return;
        }

        const [dirState, pulseState] = yield* both;
        const pulse = pulseState.pulses.find((p) => p.id === round.pulseId);
        const team = dirState.teams.find((t) => t.id === round.teamId);
        const person = dirState.people.find((p) => p.id === payload.personId);

        if (pulse === undefined || person === undefined || person.removedAt !== null) {
          yield* rounds.markJobCompleted(jobId, now);

          return;
        }

        const storedResult = yield* rounds.getRoundResult(roundId);
        const responseRatePercent = Math.round((storedResult?.responseRate ?? 0) * 100);

        const resultsReadyEmail: TransactionalEmail = {
          _tag: "ResultsReadyEmail",
          locale: emailLocaleOf(dirState, person.id),
          pulseName: pulse.settings.name,
          teamName: team?.name ?? pulse.settings.name,
          resultsUrl: `${appOrigin}/teams/${round.teamId}/rounds/${roundId}`,
          responseRatePercent,
        };

        const sendId = SendId.make(randomId());
        yield* sends.create(sendId, person.email, resultsReadyEmail);
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      if (round.status !== "open") {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const { personId } = payload;
      const [dirState, pulseState] = yield* both;
      const pulse = pulseState.pulses.find((p) => p.id === round.pulseId);
      const person = dirState.people.find((p) => p.id === personId);

      if (pulse === undefined || person === undefined || person.removedAt !== null) {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const inv = yield* rounds.getInvitation(roundId, PersonId.make(personId));

      if (inv === null || inv.status === "revoked") {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const ratingQuestion = firstRatingQuestionOf(yield* rounds.getRoundQuestions(roundId), pulseState);

      const eligibleActions = yield* actions.getEligibleActionsForRound(
        round.teamId,
        round.pulseId,
        round.plannedOpenAt,
      );

      const common = {
        locale: emailLocaleOf(dirState, person.id),
        pulseName: pulse.settings.name,
        minimumGroupSize: dirState.minimumGroupSize,
        baseUrl: appOrigin,
        ratingQuestion,
        actions: eligibleActions.slice(0, 3).map((a) => a.title),
        aiProcessing: dirState.aiProcessing,
      };

      const invitationEmail: StoredEmail =
        payload.token === undefined
          ? {
              _tag: "InvitationEmail",
              ...common,
              invitation: { roundId, personId, generation: inv.resendCount },
            }
          : { _tag: "InvitationEmail", ...common, token: payload.token };

      yield* sends.create(inv.sendId, person.email, invitationEmail);
      yield* rounds.markJobCompleted(jobId, now);
    });

  const executeRemindJob = (jobId: JobId, roundId: RoundId, now: number) =>
    Effect.gen(function* () {
      const job = yield* rounds.getJob(jobId);

      if (job === null || job.status !== "pending") {
        return;
      }

      const round = yield* rounds.getRound(roundId);

      if (round === null || round.status !== "open") {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      if (now >= round.plannedCloseAt - 2 * 3_600_000) {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const payload = parseJobPayload(job.payload);

      if (payload === null) {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const { personId } = payload;
      const pid = PersonId.make(personId);

      const answered = yield* rounds.hasAnswered(roundId, pid);

      if (answered) {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const optedOut = yield* rounds.isOptedOut(round.pulseId, pid);

      if (optedOut) {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const [dirState, pulseState] = yield* both;
      const pulse = pulseState.pulses.find((p) => p.id === round.pulseId);
      const person = dirState.people.find((p) => p.id === personId);

      if (pulse === undefined || person === undefined || person.removedAt !== null) {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const isMember = dirState.memberships.some(
        (m) => m.teamId === round.teamId && m.personId === pid && m.endedAt === null,
      );

      if (!isMember) {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const inv = yield* rounds.getInvitation(roundId, pid);

      if (inv === null || inv.status === "revoked") {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const ratingQuestion = firstRatingQuestionOf(yield* rounds.getRoundQuestions(roundId), pulseState);

      const eligibleActions = yield* actions.getEligibleActionsForRound(
        round.teamId,
        round.pulseId,
        round.plannedOpenAt,
      );

      const common = {
        locale: emailLocaleOf(dirState, person.id),
        pulseName: pulse.settings.name,
        baseUrl: appOrigin,
        ratingQuestion,
        actions: eligibleActions.slice(0, 3).map((a) => a.title),
        aiProcessing: dirState.aiProcessing,
      };

      const reminderEmail: StoredEmail =
        payload.token === undefined
          ? {
              _tag: "ReminderEmail",
              ...common,
              invitation: { roundId, personId, generation: inv.resendCount },
            }
          : {
              _tag: "ReminderEmail",
              ...common,
              token: payload.token,
              unsubscribeUrl: `${appOrigin}/api/reminders/unsubscribe?t=${payload.token}`,
            };

      const sendId = SendId.make(randomId());
      yield* sends.create(sendId, person.email, reminderEmail);
      yield* rounds.markJobCompleted(jobId, now);
    });

  const executeCloseJob = (jobId: JobId, roundId: RoundId, now: number) =>
    Effect.gen(function* () {
      const job = yield* rounds.getJob(jobId);

      if (job === null || job.status !== "pending") {
        return;
      }

      const round = yield* rounds.getRound(roundId);

      if (round === null || round.status !== "open") {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const [dirState, pulseState] = yield* both;

      const effectiveN = Math.max(
        dirState.minimumGroupSize,
        round.effectiveMinimumGroupSize ?? dirState.minimumGroupSize,
      );

      const reviewEndsAt = reviewEndsAtOf(pulseState, round.pulseId, now);

      yield* rounds.closeRound(roundId, now, effectiveN, reviewEndsAt);
      yield* rounds.cancelJobsForRound(roundId, ["send", "remind"]);
      yield* rounds.markJobCompleted(jobId, now);

      const computeJobId = JobId.make(randomId());
      yield* rounds.insertJob({
        id: computeJobId,
        roundId,
        type: "compute",
        dueAt: now,
        status: "pending",
        payload: null,
        createdAt: now,
        completedAt: null,
        failures: 0,
      });

      yield* executeComputeJob(computeJobId, roundId, now);
    });

  const scheduleResultsReady = (round: RoundRecord, personIds: readonly PersonId[], now: number) =>
    Effect.gen(function* () {
      const dirState = yield* directory.load;
      const team = dirState.teams.find((t) => t.id === round.teamId);
      const teamTimeZone = team?.timeZone ?? "UTC";

      for (const personId of personIds) {
        const personTz = yield* rounds.getPersonTimeZone(personId);
        const effectiveTz = personTz ?? teamTimeZone;
        const deliveryTime = calculateResultsReadyDeliveryTime(now, effectiveTz);
        const resultsJobId = JobId.make(`results-ready-${round.id}-${personId}`);

        yield* rounds.insertJob({
          id: resultsJobId,
          roundId: round.id,
          type: "send",
          dueAt: deliveryTime,
          status: "pending",
          payload: JSON.stringify({
            kind: "resultsReady",
            personId,
            roundId: round.id,
          }),
          createdAt: now,
          completedAt: null,
          failures: 0,
        });

        if (deliveryTime <= now) {
          yield* executeSendJob(resultsJobId, round.id, now);
        }
      }
    });

  const shareResults = (roundId: RoundId, now: number) =>
    Effect.gen(function* () {
      const target = yield* rounds.getRound(roundId);

      if (target === null || target.status !== "ready") {
        return;
      }

      const dirState = yield* directory.load;
      const earlier = yield* rounds.getReadyRoundIdsForPulseBefore(target.pulseId, target.plannedOpenDate);

      for (const id of [...earlier, roundId]) {
        const round = yield* rounds.getRound(id);

        if (round === null) {
          continue;
        }

        const changed = yield* rounds.shareRound(id, now);

        if (!changed) {
          continue;
        }

        yield* rounds.cancelJobsForRound(id, ["share"]);
        yield* scheduleResultsReady(
          round,
          [
            ...activePersonsWithRole(dirState, round.teamId, "lead"),
            ...activePersonsWithRole(dirState, round.teamId, "member"),
          ],
          now,
        );
      }

      yield* repairAlarm();
    });

  const executeShareJob = (jobId: JobId, roundId: RoundId, now: number) =>
    Effect.gen(function* () {
      const job = yield* rounds.getJob(jobId);

      if (job === null || job.status !== "pending") {
        return;
      }

      yield* shareResults(roundId, now);
      yield* rounds.markJobCompleted(jobId, now);
    });

  const executeComputeJob = (jobId: JobId, roundId: RoundId, now: number) =>
    Effect.gen(function* () {
      const job = yield* rounds.getJob(jobId);

      if (job === null || job.status !== "pending") {
        return;
      }

      if (job.dueAt > now) {
        return;
      }

      const round = yield* rounds.getRound(roundId);

      if (
        round === null ||
        (round.status !== "closed" && round.status !== "ready" && round.status !== "shared")
      ) {
        yield* rounds.markJobCompleted(jobId, now);

        return;
      }

      const dirState = yield* directory.load;

      const effectiveN = Math.max(
        dirState.minimumGroupSize,
        round.effectiveMinimumGroupSize ?? dirState.minimumGroupSize,
      );

      const computeEffect = Effect.gen(function* () {
        const questions = yield* rounds.getRoundQuestionsDetailed(roundId);
        const submissions = yield* rounds.getSubmissionsForRound(roundId);
        const eligibleMembersCount = yield* rounds.getRoundMembersCount(roundId);

        const pastHistory = yield* rounds.getPastRoundsResultsForPulse(
          round.pulseId,
          12,
          round.plannedOpenDate,
        );

        const result = calculateRoundResult({
          roundId,
          pulseId: round.pulseId,
          teamId: round.teamId,
          status: round.status,
          plannedOpenDate: round.plannedOpenDate,
          anonymityMode: round.anonymityMode,
          closedAt: round.closedAt,
          effectiveMinimumGroupSize: effectiveN,
          eligibleMembersCount,
          questions,
          submissions,
          pastRoundsHistory: pastHistory,
        });

        const injected = injectedComputeFailures.get(roundId) ?? 0;

        if (injected > 0) {
          injectedComputeFailures.set(roundId, injected - 1);

          return yield* Effect.die(new Error("injected compute failure"));
        }

        yield* rounds.saveRoundResult(roundId, result, now);
        yield* rounds.markRoundReady(roundId, now);

        if (shouldRequestThemes(result, dirState.aiProcessing)) {
          const requested = yield* rounds.requestThemes(roundId, now);

          if (requested) {
            yield* rounds.insertJob({
              id: JobId.make(`themes-${roundId}`),
              roundId,
              type: "themes",
              dueAt: now,
              status: "pending",
              payload: null,
              createdAt: now,
              completedAt: null,
              failures: 0,
            });
          }
        }

        const readied = yield* rounds.getRound(roundId);
        const reviewEndsAt = readied?.reviewEndsAt ?? null;

        if (reviewEndsAt === null || reviewEndsAt <= now) {
          yield* shareResults(roundId, now);
        } else {
          yield* rounds.insertJob({
            id: JobId.make(`share-${roundId}`),
            roundId,
            type: "share",
            dueAt: reviewEndsAt,
            status: "pending",
            payload: null,
            createdAt: now,
            completedAt: null,
            failures: 0,
          });
          yield* scheduleResultsReady(round, activePersonsWithRole(dirState, round.teamId, "lead"), now);
        }

        yield* repairAlarm();
        yield* rounds.markJobCompleted(jobId, now);
      });

      yield* computeEffect.pipe(
        Effect.catchDefect((defect: unknown) =>
          Effect.gen(function* () {
            const current = yield* rounds.getRound(roundId);

            if (current === null || current.status !== "closed") {
              yield* Effect.logError(
                `[OPERATOR_ALERT] Results follow-up failed after compute for round ${roundId}: ${String(defect)}`,
              );
              yield* rounds.markJobCompleted(jobId, now);

              return;
            }

            const attempts = parseAttempts(job.payload) + 1;
            const dueAt = nextRetryAt(job.createdAt, attempts, now);

            if (dueAt !== null) {
              yield* rounds.updateJobPayload(jobId, JSON.stringify({ attempts }));
              yield* rounds.updateJobDueAtById(jobId, dueAt);
              yield* repairAlarm();

              return;
            }

            yield* Effect.logError(
              `[OPERATOR_ALERT] Results computation gave up for round ${roundId}: ${String(defect)}`,
            );
            const submissions = yield* rounds.getSubmissionsForRound(roundId);
            const eligibleMembersCount = yield* rounds.getRoundMembersCount(roundId);

            const delayedResult = delayedRoundResult({
              roundId,
              pulseId: round.pulseId,
              teamId: round.teamId,
              status: round.status,
              plannedOpenDate: round.plannedOpenDate,
              anonymityMode: round.anonymityMode,
              closedAt: round.closedAt,
              effectiveMinimumGroupSize: effectiveN,
              eligibleMembersCount,
              submissionsCount: submissions.length,
            });

            yield* rounds.saveRoundResult(roundId, delayedResult, now);
            yield* rounds.markJobCompleted(jobId, now);
          }),
        ),
      );
    });

  const executeThemesJob = (jobId: JobId, roundId: RoundId, now: number) =>
    Effect.gen(function* () {
      const prepared = yield* sql.withTransaction(
        Effect.gen(function* () {
          const job = yield* rounds.getJob(jobId);

          if (job === null || job.status !== "pending" || job.type !== "themes") {
            return null;
          }

          const themes = yield* rounds.getRoundThemes(roundId);

          if (themes === null || themes.status !== "pending") {
            yield* rounds.markJobCompleted(jobId, now);

            return null;
          }

          const dirState = yield* directory.load;

          if (!dirState.aiProcessing) {
            yield* rounds.giveUpThemes(roundId, now);
            yield* rounds.markJobCompleted(jobId, now);

            return null;
          }

          const round = yield* rounds.getRound(roundId);
          const stored = yield* rounds.getRoundResult(roundId);

          const effective =
            stored === null ? null : enforceEffectiveNOnResult(stored, dirState.minimumGroupSize);

          if (round === null || effective === null || !shouldRequestThemes(effective, true)) {
            yield* rounds.giveUpThemes(roundId, now);
            yield* rounds.markJobCompleted(jobId, now);

            return null;
          }

          yield* rounds.updateJobDueAtById(jobId, now + THEMES_LEASE_MS);
          const openActionTitles = yield* actions.getOpenActionTitlesForTeam(round.teamId);

          return {
            input: buildThemesInput(effective, openActionTitles, dirState.people),
            requestedAt: themes.requestedAt,
            attempts: themes.attempts,
          };
        }),
      );

      if (prepared === null) {
        return;
      }

      yield* repairAlarm();

      const decision = yield* runThemesAttempt({
        input: prepared.input,
        requestedAt: prepared.requestedAt,
        attempts: prepared.attempts,
        now,
      }).pipe(Effect.provideService(AiClient, ai));

      yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* rounds.getRoundThemes(roundId);

          if (current === null || current.status !== "pending") {
            yield* rounds.markJobCompleted(jobId, now);

            return;
          }

          switch (decision._tag) {
            case "Store": {
              yield* rounds.storeThemes(roundId, decision.themes, now);
              yield* rounds.markJobCompleted(jobId, now);

              return;
            }

            case "RetryAt": {
              yield* rounds.recordThemesAttemptFailed(roundId, decision.attempts);
              yield* rounds.updateJobDueAtById(jobId, decision.dueAt);

              return;
            }

            case "GiveUp": {
              yield* rounds.giveUpThemes(roundId, now);
              yield* rounds.markJobCompleted(jobId, now);
            }
          }
        }),
      );
      yield* repairAlarm();
    });

  const runJob = (job: ScheduleJobRecord, now: number) =>
    Effect.gen(function* () {
      if (job.type === "themes") {
        yield* executeThemesJob(job.id, job.roundId, now);

        return;
      }

      yield* sql.withTransaction(
        Effect.gen(function* () {
          if (job.type === "open") {
            yield* executeOpenJob(job.id, job.roundId, now);
          } else if (job.type === "close") {
            yield* executeCloseJob(job.id, job.roundId, now);
          } else if (job.type === "compute") {
            yield* executeComputeJob(job.id, job.roundId, now);
          } else if (job.type === "send") {
            yield* executeSendJob(job.id, job.roundId, now);
          } else if (job.type === "remind") {
            yield* executeRemindJob(job.id, job.roundId, now);
          } else if (job.type === "share") {
            yield* executeShareJob(job.id, job.roundId, now);
          }
        }),
      );
    });

  const recordJobFailure = (job: ScheduleJobRecord, cause: Cause.Cause<unknown>, now: number) =>
    Effect.gen(function* () {
      const failures = job.failures + 1;
      const dueAt = nextJobAttemptAt(failures, now);

      yield* Effect.logError(
        `[OPERATOR_ALERT] ROUND_JOB_FAILED job=${job.id} type=${job.type} round=${job.roundId} failures=${failures} next_attempt_at=${dueAt} cause=${failureSummary(cause)}`,
      );
      yield* rounds.recordJobFailure(job.id, failures, dueAt);
    });

  const runDueJob = (job: ScheduleJobRecord, now: number) =>
    runJob(job, now).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) => recordJobFailure(job, cause, now),
      ),
    );

  const runDueJobs = (nowMs?: number) =>
    Effect.gen(function* () {
      const now = nowMs ?? (yield* Clock.currentTimeMillis);

      while (true) {
        const dueJobs = yield* rounds.getDueJobs(now);

        if (dueJobs.length === 0) {
          break;
        }

        for (const job of dueJobs) {
          yield* runDueJob(job, now);
        }
      }

      yield* repairAlarm();
    }).pipe(Effect.orDie);

  const runScheduleJob = (jobId: string, nowMs?: number) =>
    Effect.gen(function* () {
      const peeked = yield* rounds.getJob(JobId.make(jobId));

      if (peeked !== null && peeked.type === "themes") {
        const now = nowMs ?? (yield* Clock.currentTimeMillis);
        yield* executeThemesJob(peeked.id, peeked.roundId, now);
        yield* repairAlarm();

        return;
      }

      yield* sql.withTransaction(
        Effect.gen(function* () {
          const job = yield* rounds.getJob(JobId.make(jobId));

          if (job === null || job.status !== "pending") {
            return;
          }

          const now = nowMs ?? (yield* Clock.currentTimeMillis);

          if (job.type === "open") {
            yield* executeOpenJob(job.id, job.roundId, now);
          } else if (job.type === "close") {
            yield* executeCloseJob(job.id, job.roundId, now);
          } else if (job.type === "compute") {
            yield* executeComputeJob(job.id, job.roundId, now);
          } else if (job.type === "send") {
            yield* executeSendJob(job.id, job.roundId, now);
          } else if (job.type === "remind") {
            yield* executeRemindJob(job.id, job.roundId, now);
          } else if (job.type === "share") {
            yield* executeShareJob(job.id, job.roundId, now);
          }

          yield* repairAlarm();
        }),
      );
    }).pipe(Effect.orDie);

  const injectComputeFailures = (roundId: string, count: number) =>
    Effect.sync(() => {
      injectedComputeFailures.set(RoundId.make(roundId), count);
    });

  return { runDueJobs, runScheduleJob, injectComputeFailures, executeComputeJob, shareResults };
};
