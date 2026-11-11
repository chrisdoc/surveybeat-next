import {
  EmailAddress,
  MembershipId,
  type RoundCommandResult,
  type RoundResult,
  TeamId,
  TimeZone,
} from "@surveybeat/domain";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Schema from "effect/Schema";
import type { Organizations } from "./EmailDelivery.ts";
import {
  type Cast,
  commandOutcome,
  jobsOfType,
  openedRound,
  statusOf,
  viewOf,
} from "./ReviewWindowTestRoutes.ts";

export const RESULT_RECOVERY_TEST_ROUTE = "/__test/result-recovery";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const AttemptsPayload = Schema.fromJsonString(Schema.Struct({ attempts: Schema.Int }));
/** The failed attempts a compute job has recorded in its payload (0 when none). */
const attemptsOf = (payload: string | null): number =>
  payload === null ? 0 : Schema.decodeSync(AttemptsPayload)(payload).attempts;

const minutesOf = (ms: number): number => ms / MINUTE_MS;

/** What a viewer sees of a Result: its status, whether it is delayed, and whether it says it could not be computed. */
const viewState = (view: RoundResult | null) => ({
  status: view?.status ?? null,
  delayed: view?.delayed ?? null,
  couldNotCompute: view?.couldNotCompute === true,
  couldNotComputeKey: view !== null && "couldNotCompute" in view,
});

/** "Accepted", or the rejection's tag with the Round status it names, if any. */
const rejectionOf = (result: RoundCommandResult) =>
  result._tag === "Accepted"
    ? { outcome: "Accepted", status: null }
    : {
        outcome: result.rejection._tag,
        status: "status" in result.rejection ? result.rejection.status : null,
      };

/** The Round's compute job the first one listed (the job the close created), with its payload. */
const firstComputeJob = (cast: Cast) =>
  Effect.gen(function* () {
    const listed = yield* jobsOfType(cast, "compute");
    const first = listed[0];
    if (first === undefined) return yield* Effect.die(new Error("no compute job"));
    const job = yield* cast.organization.getJob(first.id);
    if (job === null) return yield* Effect.die(new Error("compute job missing"));
    return job;
  });

/**
 * Closes the Round with every compute attempt failing, then runs the compute job at each of its due times until it
 * gives up. Returns the attempt times, in minutes after close: the first is the close itself.
 */
const closeAndGiveUp = (cast: Cast) =>
  Effect.gen(function* () {
    yield* cast.organization.injectComputeFailures(cast.roundId, 1000);
    yield* cast.organization.runScheduleJob(cast.closeJobId, cast.closeDue);
    const offsets: Array<number> = [0];
    let job = yield* firstComputeJob(cast);
    while (job.status === "pending") {
      if (offsets.length > 50) return yield* Effect.die(new Error("compute job never gave up"));
      offsets.push(minutesOf(job.dueAt - cast.closeDue));
      yield* cast.organization.runDueJobs(job.dueAt);
      job = yield* firstComputeJob(cast);
    }
    return offsets;
  });

/** The last attempt time of a give-up, as an epoch: when the Lead retries after it. */
const afterGiveUp = (cast: Cast, offsets: ReadonlyArray<number>) =>
  cast.closeDue + (offsets[offsets.length - 1] ?? 0) * MINUTE_MS + HOUR_MS;

/**
 * Test stages only (`isTestStage`): Result recovery (Issue #128) on a real Organization Durable Object and local
 * workerd. Each scenario uses its own Organization with a Lead, two members, an admin, N = 3, AI off, and a Review
 * window of 3 days. Compute failures are injected before any write, and time is driven by running jobs at their
 * due times.
 * - a: two failures, then success. The Round stays Closed with a retry due 5 minutes later; a doubled alarm before
 *   that time changes nothing; the retry after 5 minutes fails and is due 10 minutes later; the next succeeds, so
 *   the Round is Ready and its Review window ends 3 days after the successful compute.
 * - b: every attempt fails. The attempts follow the backoff schedule and stop within 24 hours of close. The Round stays
 *   Closed, the Lead sees it could not be computed, and a member sees only that it is delayed.
 * - c: after the give-up, members and admins are Forbidden to retry; the Lead retries twice at once. The first click
 *   computes the Result; the second changes nothing.
 * - d: a Round that gives up again. The Lead's retry fails once, so the Lead is told it is still being retried, and
 *   the next attempt succeeds.
 * - e: a retry of a Round that has nothing to retry. While the Round is Open, and after it is Cancelled, the Lead's
 *   retry is rejected with the Round's status. A Lead of another Team, naming that Team, gets RoundNotFound; this
 *   Round's own Lead naming a Team they have no role in is Forbidden. None of these creates a compute job.
 */
export const resultRecoveryTestRoutes = (organizations: Organizations) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const run = new URL(request.url, "http://localhost").searchParams.get("run") ?? "";
    const now = yield* Clock.currentTimeMillis;

    // a: two failures, then success.
    const retried = yield* openedRound(organizations, `recovery-${run}-a`, 3, now);
    yield* retried.organization.injectComputeFailures(retried.roundId, 2);
    yield* retried.organization.runScheduleJob(retried.closeJobId, retried.closeDue);
    const roundAtClose = yield* statusOf(retried);
    const computeAtClose = yield* firstComputeJob(retried);
    const computeDueAfterFirst = computeAtClose.dueAt;
    const leadAtClose = viewState(yield* viewOf(retried, retried.lead));
    const memberAtClose = viewState(yield* viewOf(retried, retried.member));

    // A doubled alarm, before the retry is due, changes nothing.
    yield* retried.organization.runScheduleJob(computeAtClose.id, retried.closeDue);
    yield* retried.organization.runScheduleJob(computeAtClose.id, retried.closeDue);
    yield* retried.organization.runDueJobs(retried.closeDue);
    const afterDoubled = yield* firstComputeJob(retried);
    const doubledAlarm = {
      status: afterDoubled.status,
      attempts: attemptsOf(afterDoubled.payload),
      dueUnchanged: afterDoubled.dueAt === computeDueAfterFirst,
    };

    // The retry 5 minutes after close fails again: the next is due 10 minutes later.
    yield* retried.organization.runScheduleJob(computeAtClose.id, computeDueAfterFirst);
    const secondRetry = yield* firstComputeJob(retried);
    const afterSecondFailure = {
      status: secondRetry.status,
      attempts: attemptsOf(secondRetry.payload),
      dueMinutesLater: minutesOf(secondRetry.dueAt - computeDueAfterFirst),
    };

    // The retry 10 minutes later succeeds: the Round is Ready, and its Review window ends 3 days after that compute.
    const computedAt = secondRetry.dueAt;
    yield* retried.organization.runScheduleJob(secondRetry.id, computedAt);
    const readyRound = yield* retried.organization.getRound(retried.roundId);
    const shareJobs = yield* jobsOfType(retried, "share");
    const reviewEndsAt = readyRound?.reviewEndsAt ?? null;
    const failThenSucceed = {
      roundAtClose,
      computeAtClose: {
        status: computeAtClose.status,
        attempts: attemptsOf(computeAtClose.payload),
        dueMinutesAfterClose: minutesOf(computeDueAfterFirst - retried.closeDue),
      },
      leadAtClose,
      memberAtClose,
      doubledAlarm,
      afterSecondFailure,
      roundAfterSuccess: yield* statusOf(retried),
      computeAfterSuccess: (yield* firstComputeJob(retried)).status,
      reviewEndsAtDays: reviewEndsAt === null ? null : (reviewEndsAt - computedAt) / DAY_MS,
      shareJobDueIsReviewEnd: shareJobs[0]?.due_at === reviewEndsAt,
      leadAfterSuccess: viewState(yield* viewOf(retried, retried.lead)),
    };

    // b: every attempt fails, until the job gives up within 24 hours of close.
    const given = yield* openedRound(organizations, `recovery-${run}-b`, 3, now);
    const giveUpOffsets = yield* closeAndGiveUp(given);
    const giveUpSummary = {
      attemptOffsetsMinutes: giveUpOffsets,
      withinWindow: giveUpOffsets.every((minutes) => minutes * MINUTE_MS <= DAY_MS),
      roundStatus: yield* statusOf(given),
      computeStatus: (yield* firstComputeJob(given)).status,
      leadView: viewState(yield* viewOf(given, given.lead)),
      memberView: viewState(yield* viewOf(given, given.member)),
    };

    // c: after the give-up, only the Lead retries, and a doubled click computes the Result once.
    const retryAt = afterGiveUp(given, giveUpOffsets);
    const memberRetry = commandOutcome(
      yield* given.organization.runRoundCommand(
        given.member,
        { _tag: "RetryResult", teamId: given.teamId, roundId: given.roundId },
        retryAt,
      ),
    );
    const adminRetry = commandOutcome(
      yield* given.organization.runRoundCommand(
        given.admin,
        { _tag: "RetryResult", teamId: given.teamId, roundId: given.roundId },
        retryAt,
      ),
    );
    yield* given.organization.injectComputeFailures(given.roundId, 0);
    const leadFirstRetry = commandOutcome(
      yield* given.organization.runRoundCommand(
        given.lead,
        { _tag: "RetryResult", teamId: given.teamId, roundId: given.roundId },
        retryAt,
      ),
    );
    const leadSecondRetry = commandOutcome(
      yield* given.organization.runRoundCommand(
        given.lead,
        { _tag: "RetryResult", teamId: given.teamId, roundId: given.roundId },
        retryAt,
      ),
    );
    const givenRound = yield* given.organization.getRound(given.roundId);
    const givenReviewEndsAt = givenRound?.reviewEndsAt ?? null;
    const retryJobs = yield* jobsOfType(given, "compute");
    const retrySummary = {
      memberRetry,
      adminRetry,
      leadFirstRetry,
      leadSecondRetry,
      roundStatus: yield* statusOf(given),
      reviewEndsAtDays: givenReviewEndsAt === null ? null : (givenReviewEndsAt - retryAt) / DAY_MS,
      computeJobStatuses: retryJobs.map((job) => job.status),
      leadView: viewState(yield* viewOf(given, given.lead)),
    };

    // d: a Round gives up, the Lead's retry fails once, and the next attempt succeeds.
    const again = yield* openedRound(organizations, `recovery-${run}-d`, 3, now);
    const againOffsets = yield* closeAndGiveUp(again);
    const againRetryAt = afterGiveUp(again, againOffsets);
    yield* again.organization.injectComputeFailures(again.roundId, 1);
    const firstRetry = commandOutcome(
      yield* again.organization.runRoundCommand(
        again.lead,
        { _tag: "RetryResult", teamId: again.teamId, roundId: again.roundId },
        againRetryAt,
      ),
    );
    const secondClick = commandOutcome(
      yield* again.organization.runRoundCommand(
        again.lead,
        { _tag: "RetryResult", teamId: again.teamId, roundId: again.roundId },
        againRetryAt,
      ),
    );
    const pendingRetry = (yield* jobsOfType(again, "compute")).find((job) => job.status === "pending");
    if (pendingRetry === undefined) return yield* Effect.die(new Error("no pending retry"));
    const pendingJob = yield* again.organization.getJob(pendingRetry.id);
    const failedRetrySummary = {
      firstRetry,
      secondRetry: secondClick,
      computeJobStatuses: (yield* jobsOfType(again, "compute")).map((job) => job.status),
      pendingAttempts: attemptsOf(pendingJob?.payload ?? null),
      pendingDueMinutesLater: minutesOf(pendingRetry.due_at - againRetryAt),
      leadWhileRetrying: viewState(yield* viewOf(again, again.lead)),
    };
    yield* again.organization.runDueJobs(pendingRetry.due_at);
    const failedRetryDone = {
      roundStatus: yield* statusOf(again),
      leadAfterSuccess: viewState(yield* viewOf(again, again.lead)),
    };

    // e: nothing to retry: an Open Round, another Team's Round, and a Cancelled Round.
    const idle = yield* openedRound(organizations, `recovery-${run}-e`, 3, now);
    const retryAs = (person: typeof idle.lead, teamId: TeamId) =>
      Effect.map(
        idle.organization.runRoundCommand(
          person,
          { _tag: "RetryResult", teamId, roundId: idle.roundId },
          now,
        ),
        rejectionOf,
      );
    const whileOpen = yield* retryAs(idle.lead, idle.teamId);
    // The member of this Team leads another Team.
    const otherTeamId = TeamId.make(`team-recovery-${run}-e-design`);
    yield* idle.organization.runDirectoryCommand(
      idle.admin,
      {
        _tag: "CreateTeam",
        teamId: otherTeamId,
        name: "Design",
        timeZone: TimeZone.make("Europe/Berlin"),
        lead: {
          email: EmailAddress.make(`member-recovery-${run}-e@example.com`),
          personId: idle.member,
          membershipId: MembershipId.make(`membership-design-lead-recovery-${run}-e`),
          signInUrl: "https://app.surveybeat.app/",
        },
      },
      now,
    );
    const otherTeamLead = yield* retryAs(idle.member, otherTeamId);
    const ownLeadNamingOtherTeam = yield* retryAs(idle.lead, otherTeamId);
    const cancelled = commandOutcome(
      yield* idle.organization.runRoundCommand(
        idle.admin,
        { _tag: "CancelRound", teamId: idle.teamId, roundId: idle.roundId },
        now,
      ),
    );
    const afterCancel = yield* retryAs(idle.lead, idle.teamId);
    const nothingToRetry = {
      whileOpen,
      otherTeamLead,
      ownLeadNamingOtherTeam,
      cancelled,
      afterCancel,
      roundStatus: yield* statusOf(idle),
      computeJobs: (yield* jobsOfType(idle, "compute")).length,
    };

    return yield* HttpServerResponse.json({
      failThenSucceed,
      giveUp: giveUpSummary,
      leadRetry: retrySummary,
      failedRetry: { ...failedRetrySummary, ...failedRetryDone },
      nothingToRetry,
    });
  });
