import { EmailAddress, MembershipId, PersonId, PulseId, TeamId, TimeZone } from "@surveybeat/domain";
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
 */
export const roundTestRoutes = (organizations: Organizations) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const run = new URL(request.url, "http://localhost").searchParams.get("run") ?? "";
    const organizationId = `rounds-${run}`;
    const organization = organizations.getByName(organizationId);
    const admin = PersonId.make(`admin-${run}`);
    const teamId = TeamId.make(`team-${run}`);
    const pulseId = PulseId.make(`pulse-${run}`);
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
          personId: PersonId.make(`lead-${run}`),
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

    // Run open job second time (idempotency check)
    yield* organization.runScheduleJob(openJob.id, openJob.due_at);
    const roundAfterSecond = yield* organization.getRound(roundSummary.id);
    const openJobAfterSecond = yield* organization.getJob(openJob.id);

    const openIdempotent =
      roundAfterFirst !== null &&
      roundAfterSecond !== null &&
      openJobAfterFirst !== null &&
      openJobAfterSecond !== null &&
      roundAfterFirst.status === "open" &&
      roundAfterSecond.status === "open" &&
      roundAfterFirst.updatedAt === roundAfterSecond.updatedAt &&
      openJobAfterFirst.status === "completed" &&
      openJobAfterSecond.status === "completed";

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

    return yield* HttpServerResponse.json({
      initialAlarm,
      earliestDue1,
      alarmPointsToEarliest1,
      notDuplicated,
      openIdempotent,
      closeIdempotent,
      alarmPointsToEarliest2,
    });
  });
