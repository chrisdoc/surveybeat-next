import type * as Cloudflare from "@alchemy.run/cloudflare";
import type { SqliteClient } from "@effect/sql-sqlite-do";
import { calculateRoundResult, JobId, PersonId, Policy, PulseId, RoundId, TeamId } from "@surveybeat/domain";
import type { makeSendStore, TestSendResult } from "@surveybeat/domain";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type { makeSqlDirectory } from "../SqlDirectory.ts";
import type { makeSqlRounds } from "../SqlRounds.ts";
import type { makeRoundJobs } from "./RoundJobs.ts";
import type { makeScheduling } from "./Scheduling.ts";

export const organizationTestSupport = <E>({
  sql,
  sends,
  rounds,
  directory,
  state,
  scheduling,
  jobs,
  queueTestSend,
}: {
  sql: SqliteClient.SqliteClient;
  sends: ReturnType<typeof makeSendStore>;
  rounds: ReturnType<typeof makeSqlRounds>;
  directory: ReturnType<typeof makeSqlDirectory>;
  state: Cloudflare.DurableObjectState["Service"];
  scheduling: ReturnType<typeof makeScheduling>;
  jobs: ReturnType<typeof makeRoundJobs>;
  queueTestSend: (
    actorId: PersonId,
    teamId: TeamId,
    pulseId: PulseId,
    now: number,
    perHour: boolean,
  ) => Effect.Effect<TestSendResult, E>;
}) => ({
  createFailedTestSend: (actorId: PersonId, teamId: TeamId, pulseId: PulseId, now: number) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const result = yield* queueTestSend(actorId, teamId, pulseId, now, false);

          if (result._tag === "Rejected") {
            return yield* Effect.die(`test send refused: ${result.rejection._tag}`);
          }

          yield* sends.claim(result.sendId, now + 1);
          yield* sends.settle(
            result.sendId,
            1,
            { _tag: "Rejected", code: "E_SENDER_NOT_VERIFIED", permanent: true },
            now + 2,
          );

          return result.sendId;
        }),
      )
      .pipe(Effect.orDie),

  recomputeResult: (roundId: string) =>
    Effect.gen(function* () {
      const rid = RoundId.make(roundId);
      const r = yield* rounds.getRound(rid);

      if (r === null) {
        return false;
      }

      const dirState = yield* directory.load;

      const effectiveN = Math.max(
        dirState.minimumGroupSize,
        r.effectiveMinimumGroupSize ?? dirState.minimumGroupSize,
      );

      const now = yield* Clock.currentTimeMillis;
      const questions = yield* rounds.getRoundQuestionsDetailed(rid);
      const submissions = yield* rounds.getSubmissionsForRound(rid);
      const eligibleMembersCount = yield* rounds.getRoundMembersCount(rid);

      const pastHistory = yield* rounds.getPastRoundsResultsForPulse(
        r.pulseId,
        Policy.trendRounds,
        r.plannedOpenDate,
      );

      const result = calculateRoundResult({
        roundId: rid,
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
        pastRoundsHistory: pastHistory,
      });

      yield* rounds.saveRoundResult(rid, result, now);

      return true;
    }).pipe(Effect.orDie),
  injectComputeFailures: (roundId: string, count: number) => jobs.injectComputeFailures(roundId, count),
  runDueJobs: (now?: number) => jobs.runDueJobs(now),
  runScheduleJob: (jobId: string, nowMs?: number) => jobs.runScheduleJob(jobId, nowMs),
  getAlarm: () => Effect.promise(() => state.raw.storage.getAlarm()).pipe(Effect.orDie),
  scheduleNextRound: (pulseId: string, teamId: string, now: number) =>
    scheduling.scheduleNextRound(PulseId.make(pulseId), TeamId.make(teamId), now),
  getEarliestPendingJobDueAt: () => rounds.getEarliestPendingJobDueAt(),
  scheduledRoundFor: (pulseId: string) => rounds.findScheduledRound(PulseId.make(pulseId)),
  getRoundsCount: (pulseId: string) =>
    sql<{ count: number }>`SELECT count(*) as count FROM round WHERE pulse_id = ${pulseId}`.pipe(
      Effect.map((rows) => rows[0]?.count ?? 0),
      Effect.orDie,
    ),
  getJob: (jobId: string) => rounds.getJob(JobId.make(jobId)),
  getJobsForRound: (roundId: string) =>
    sql<{
      id: string;
      type: string;
      status: string;
      due_at: number;
    }>`SELECT id, type, status, due_at FROM schedule_job WHERE round_id = ${roundId} ORDER BY due_at ASC`.pipe(
      Effect.orDie,
    ),
  getInvitations: (roundId: string) => rounds.getInvitations(RoundId.make(roundId)),
  getInvitationByTokenHash: (tokenHash: string) => rounds.getInvitationByTokenHash(tokenHash),
  isOptedOut: (pulseId: string, personId: string) =>
    rounds.isOptedOut(PulseId.make(pulseId), PersonId.make(personId)),
  getPersonTimeZone: (personId: string) => rounds.getPersonTimeZone(PersonId.make(personId)),
  recordParticipation: (roundId: string, personId: string) =>
    rounds.recordParticipation(RoundId.make(roundId), PersonId.make(personId)),
  hasAnswered: (roundId: string, personId: string) =>
    rounds.hasAnswered(RoundId.make(roundId), PersonId.make(personId)),
});
