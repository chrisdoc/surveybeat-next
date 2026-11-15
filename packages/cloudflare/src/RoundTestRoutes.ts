import type * as Cloudflare from "@alchemy.run/cloudflare";
import { EmailTemplatesLive } from "@surveybeat/emails";
import {
  deriveInvitationToken,
  EmailTemplates,
  EmailAddress,
  hashToken,
  importInvitationTokenKey,
  MembershipId,
  PersonId,
  PulseId,
  SendId,
  TeamId,
  TimeZone,
} from "@surveybeat/domain";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { InvitationTokensLive, type Organizations } from "./EmailDelivery.ts";
import { setReviewWindowDays } from "./ReviewWindowTestRoutes.ts";

export const ROUNDS_TEST_ROUTE = "/__test/rounds";

export const roundTestRoutes = (organizations: Organizations, database: Cloudflare.D1.QueryDatabaseClient) =>
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
    yield* setReviewWindowDays(organization, admin, teamId, pulseId, 0, now);

    const initialAlarm = yield* organization.getAlarm();
    const earliestDue1 = yield* organization.getEarliestPendingJobDueAt();
    const alarmPointsToEarliest1 =
      initialAlarm !== null && earliestDue1 !== null && initialAlarm === earliestDue1;

    const countBefore = yield* organization.getRoundsCount(pulseId);
    yield* organization.scheduleNextRound(pulseId, teamId, now);
    const countAfter = yield* organization.getRoundsCount(pulseId);
    const notDuplicated = countBefore === 1 && countAfter === 1;

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

    yield* organization.runScheduleJob(openJob.id, openJob.due_at);
    const roundAfterFirst = yield* organization.getRound(roundSummary.id);
    const openJobAfterFirst = yield* organization.getJob(openJob.id);
    const invsAfterFirst = yield* organization.getInvitations(roundSummary.id);

    const tokenKey = yield* Config.Redacted("INVITATION_TOKEN_KEY").pipe(
      Effect.flatMap((secret) => Effect.promise(() => importInvitationTokenKey(Redacted.value(secret)))),
    );
    const tokenFor = (generation: number) =>
      Effect.promise(() =>
        deriveInvitationToken(tokenKey, { roundId: roundSummary.id, personId: leadPersonId, generation }),
      );
    const persistedText = (sendId: SendId) =>
      Effect.gen(function* () {
        const jobs = yield* organization.getJobsForRound(roundSummary.id);
        const send = yield* organization.getEmailSend(sendId);
        return JSON.stringify({ jobs, send });
      });
    const firstInvitation = invsAfterFirst[0];
    const firstSendId = firstInvitation?.sendId ?? SendId.make("");
    const token0 = yield* tokenFor(0);
    const storedSend = yield* organization.getEmailSend(firstSendId);
    const renderedText =
      storedSend === null
        ? ""
        : yield* EmailTemplates.pipe(
            Effect.flatMap((templates) => templates.render(storedSend.email)),
            Effect.map((rendered) => rendered.text),
            Effect.provide(EmailTemplatesLive.pipe(Layer.provide(InvitationTokensLive))),
          );
    const persistedAfterOpen = yield* persistedText(firstSendId);
    const tokenDerivedMatchesHash =
      firstInvitation !== undefined &&
      (yield* Effect.promise(() => hashToken(token0))) === firstInvitation.tokenHash;
    const tokenNotPersistedAfterOpen =
      !persistedAfterOpen.includes(token0) && persistedAfterOpen.includes(firstSendId);

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

    if (invsAfterFirst[0] !== undefined) {
      yield* database
        .prepare(
          "INSERT INTO invitation_index (token_hash, organization_id, round_id, person_id, pulse_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (token_hash) DO NOTHING",
        )
        .bind(invsAfterFirst[0].tokenHash, organizationId, roundSummary.id, leadPersonId, pulseId)
        .run();
    }

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
    const token1 = yield* tokenFor(1);
    const persistedAfterResend = yield* persistedText(resentInv?.sendId ?? SendId.make(""));
    const resendTokenDerivedMatchesHash =
      resentInv !== undefined && (yield* Effect.promise(() => hashToken(token1))) === resentInv.tokenHash;
    const tokenNotPersistedAfterResend =
      token1 !== token0 && !persistedAfterResend.includes(token1) && !persistedAfterResend.includes(token0);

    if (resentInv !== undefined) {
      yield* database
        .prepare(
          "INSERT INTO invitation_index (token_hash, organization_id, round_id, person_id, pulse_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (token_hash) DO NOTHING",
        )
        .bind(resentInv.tokenHash, organizationId, roundSummary.id, leadPersonId, pulseId)
        .run();
    }

    const jobsDuringOpen = yield* organization.getJobsForRound(roundSummary.id);
    const closeJob = jobsDuringOpen.find((j) => j.type === "close");
    if (closeJob === undefined) {
      return yield* HttpServerResponse.json({ error: "no_close_job" });
    }

    yield* organization.runScheduleJob(closeJob.id, closeJob.due_at);
    const roundAfterClose1 = yield* organization.getRound(roundSummary.id);
    const closeJobAfterFirst = yield* organization.getJob(closeJob.id);

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

    const alarmAfter = yield* organization.getAlarm();
    const earliestDue2 = yield* organization.getEarliestPendingJobDueAt();
    const alarmPointsToEarliest2 =
      alarmAfter !== null && earliestDue2 !== null && alarmAfter === earliestDue2;

    const testToken = `test-token-${run}`;
    const testTokenHash = yield* Effect.promise(() => hashToken(testToken));
    yield* database
      .prepare(
        "INSERT INTO invitation_index (token_hash, organization_id, round_id, person_id, pulse_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (token_hash) DO NOTHING",
      )
      .bind(testTokenHash, organizationId, roundSummary.id, leadPersonId, pulseId)
      .run();

    const resultAfterClose = yield* organization.getRoundResult(roundSummary.id);
    const hasComputedResult = resultAfterClose !== null;

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
      hasComputedResult,
      alarmPointsToEarliest2,
      testToken,
      tokenDerivedMatchesHash,
      tokenNotPersistedAfterOpen,
      resendTokenDerivedMatchesHash,
      tokenNotPersistedAfterResend,
      renderedText,
      token0,
      organizationId,
      leadPersonId,
      pulseId,
    });
  });
