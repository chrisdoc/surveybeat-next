import type * as Cloudflare from "@alchemy.run/cloudflare";
import { EmailAddress, hashToken, MembershipId, PersonId, PulseId, TeamId, TimeZone } from "@surveybeat/domain";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { Organizations } from "./EmailDelivery.ts";

export const ROUNDS_TEST_ROUTE = "/__test/rounds";

/**
 * Test stages only (`isTestStage`): exercises the Round lifecycle engine against a real
 * Organization Durable Object on local workerd. Verifies:
 * 1. The alarm always points at the earliest due job.
 * 2. Next Round is never duplicated.
 * 3. Every job run twice changes nothing the second time (idempotency).
 * 4. Exactly one Invitation is created per member on open, and none duplicated on second open.
 * 5. Failed invitations appear in Lead's view and resend resets status to pending with new send.
 */
export const roundTestRoutes = (
  organizations: Organizations,
  database: Cloudflare.D1.QueryDatabaseClient,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const run = new URL(request.url, "http://localhost").searchParams.get("run") ?? "";
    const organizationId = `rounds-${run}`;
    const organization = organizations.getByName(organizationId);
    const admin = PersonId.make(`admin-${run}`);
    const teamId = TeamId.make(`team-${run}`);
    const pulseId = PulseId.make(`pulse-${run}`);
    const leadPersonId = PersonId.make(`lead-${run}`);
    const now = yield* Clock.currentTimeMillis;

    yield* organization.createWithAdmin(organizationId, "Acme", admin, "admin@example.com", `user_${run}`);

    yield* organization.runDirectoryCommand(
      admin,
      {
        _tag: "CreateTeam",
        teamId,
        name: "Engineering",
        timeZone: TimeZone.make("Europe/Berlin"),
        lead: {
          email: EmailAddress.make("lead@example.com"),
          personId: leadPersonId,
          membershipId: MembershipId.make(`membership-${run}`),
          signInUrl: "https://app.surveybeat.app/",
        },
      },
      now,
    );

    yield* organization.runPulseCommand(
      admin,
      {
        _tag: "CreatePulse",
        pulseId,
        teamId,
      },
      now,
    );

    // 1. Alarm points at the earliest due job
    const initialAlarm = yield* organization.getAlarm();
    const earliestDue1 = yield* organization.getEarliestPendingJobDueAt();
    const alarmPointsToEarliest1 =
      initialAlarm !== null && earliestDue1 !== null && initialAlarm === earliestDue1;

    // 2. Next Round is never duplicated
    const countBefore = yield* organization.getRoundsCount(pulseId);
    yield* organization.scheduleNextRound(pulseId, teamId, now);
    const countAfter = yield* organization.getRoundsCount(pulseId);
    const notDuplicated = countBefore === 1 && countAfter === 1;

    // 3. Every job run twice changes nothing the second time
    const roundsList = yield* organization.viewRounds(admin, teamId, pulseId);
    const roundSummary = roundsList._tag === "Viewed" ? roundsList.value.rounds[0] : undefined;
    if (roundSummary === undefined) {
      return yield* HttpServerResponse.json({ error: "no_round" });
    }

    const jobsBefore = yield* organization.getJobsForRound(roundSummary.id);
    const openJob = jobsBefore.find((j) => j.type === "open");
    if (openJob === undefined) {
      return yield* HttpServerResponse.json({ error: "no_open_job" });
    }

    // Run open job first time
    yield* organization.runScheduleJob(openJob.id, openJob.due_at);
    const roundAfterFirst = yield* organization.getRound(roundSummary.id);
    const openJobAfterFirst = yield* organization.getJob(openJob.id);
    const invsAfterFirst = yield* organization.getInvitations(roundSummary.id);

    // Run open job second time (idempotency check)
    yield* organization.runScheduleJob(openJob.id, openJob.due_at);
    const roundAfterSecond = yield* organization.getRound(roundSummary.id);
    const openJobAfterSecond = yield* organization.getJob(openJob.id);
    const invsAfterSecond = yield* organization.getInvitations(roundSummary.id);

    const openIdempotent =
      roundAfterFirst !== null &&
      roundAfterSecond !== null &&
      openJobAfterFirst !== null &&
      openJobAfterSecond !== null &&
      roundAfterFirst.status === "open" &&
      roundAfterSecond.status === "open" &&
      roundAfterFirst.updatedAt === roundAfterSecond.updatedAt &&
      openJobAfterFirst.status === "completed" &&
      openJobAfterSecond.status === "completed" &&
      invsAfterFirst.length === 1 &&
      invsAfterSecond.length === 1 &&
      invsAfterFirst[0]?.tokenHash === invsAfterSecond[0]?.tokenHash;

    // Index the invitation into D1 invitation_index so HTTP routes (/delivery, /api/reminders/unsubscribe) find it
    if (invsAfterFirst[0] !== undefined) {
      yield* database
        .prepare(
          "INSERT INTO invitation_index (token_hash, organization_id, round_id, person_id, pulse_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (token_hash) DO NOTHING",
        )
        .bind(invsAfterFirst[0].tokenHash, organizationId, roundSummary.id, leadPersonId, pulseId)
        .run();
    }

    // Test failed invitation and Resend button
    yield* organization.failInvitation(roundSummary.id, leadPersonId, "mailbox full");
    const viewFailed = yield* organization.viewRound(admin, teamId, roundSummary.id);
    const failedList = viewFailed._tag === "Viewed" ? viewFailed.value.failedInvitations : [];
    const hasFailedInv =
      failedList.length === 1 &&
      failedList[0]?.reason === "mailbox full" &&
      failedList[0]?.personId === leadPersonId;

    yield* organization.runRoundCommand(
      admin,
      {
        _tag: "ResendInvitation",
        teamId,
        roundId: roundSummary.id,
        personId: leadPersonId,
      },
      now,
    );

    const viewResent = yield* organization.viewRound(admin, teamId, roundSummary.id);
    const failedListAfterResend = viewResent._tag === "Viewed" ? viewResent.value.failedInvitations : [];
    const resendSuccess = failedListAfterResend.length === 0;

    const invsAfterResend = yield* organization.getInvitations(roundSummary.id);
    const resentInv = invsAfterResend[0];
    const resendCountIncremented = resentInv !== undefined && resentInv.resendCount === 1;

    // Index the new token into D1 invitation_index as well
    if (resentInv !== undefined) {
      yield* database
        .prepare(
          "INSERT INTO invitation_index (token_hash, organization_id, round_id, person_id, pulse_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (token_hash) DO NOTHING",
        )
        .bind(resentInv.tokenHash, organizationId, roundSummary.id, leadPersonId, pulseId)
        .run();
    }

    // Run close job first time
    const jobsDuringOpen = yield* organization.getJobsForRound(roundSummary.id);
    const closeJob = jobsDuringOpen.find((j) => j.type === "close");
    if (closeJob === undefined) {
      return yield* HttpServerResponse.json({ error: "no_close_job" });
    }

    yield* organization.runScheduleJob(closeJob.id, closeJob.due_at);
    const roundAfterClose1 = yield* organization.getRound(roundSummary.id);
    const closeJobAfterFirst = yield* organization.getJob(closeJob.id);

    // Run close job second time
    yield* organization.runScheduleJob(closeJob.id, closeJob.due_at);
    const roundAfterClose2 = yield* organization.getRound(roundSummary.id);
    const closeJobAfterSecond = yield* organization.getJob(closeJob.id);

    const closeIdempotent =
      roundAfterClose1 !== null &&
      roundAfterClose2 !== null &&
      closeJobAfterFirst !== null &&
      closeJobAfterSecond !== null &&
      roundAfterClose1.status === "shared" &&
      roundAfterClose2.status === "shared" &&
      roundAfterClose1.updatedAt === roundAfterClose2.updatedAt &&
      closeJobAfterFirst.status === "completed" &&
      closeJobAfterSecond.status === "completed";

    // 4. Verify alarm again points at earliest due job (the next round's open job)
    const alarmAfter = yield* organization.getAlarm();
    const earliestDue2 = yield* organization.getEarliestPendingJobDueAt();
    const alarmPointsToEarliest2 =
      alarmAfter !== null && earliestDue2 !== null && alarmAfter === earliestDue2;

    // Known test token for HTTP endpoint verification
    const testToken = `test-token-${run}`;
    const testTokenHash = yield* Effect.promise(() => hashToken(testToken));
    yield* database
      .prepare(
        "INSERT INTO invitation_index (token_hash, organization_id, round_id, person_id, pulse_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (token_hash) DO NOTHING",
      )
      .bind(testTokenHash, organizationId, roundSummary.id, leadPersonId, pulseId)
      .run();

    return yield* HttpServerResponse.json({
      initialAlarm,
      earliestDue1,
      alarmPointsToEarliest1,
      notDuplicated,
      openIdempotent,
      hasFailedInv,
      resendSuccess,
      resendCountIncremented,
      closeIdempotent,
      alarmPointsToEarliest2,
      testToken,
      organizationId,
      leadPersonId,
      pulseId,
    });
  });
