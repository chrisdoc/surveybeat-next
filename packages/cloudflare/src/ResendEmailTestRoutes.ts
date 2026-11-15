import type * as Cloudflare from "@alchemy.run/cloudflare";
import {
  EmailAddress,
  MembershipId,
  OrganizationId,
  PersonId,
  PulseId,
  type ResendResult,
  SendId,
  TeamId,
  TimeZone,
} from "@surveybeat/domain";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { EmailSendRequested } from "./Email.ts";
import type { Organizations } from "./EmailDelivery.ts";

export const RESEND_EMAIL_TEST_ROUTE = "/__test/resend-email";

const enqueue = (queue: Cloudflare.Queues.WriteQueueClient, organizationId: string, result: ResendResult) =>
  result._tag === "Accepted" && result.queue
    ? Effect.flatMap(
        Schema.encodeEffect(EmailSendRequested)({
          organizationId: OrganizationId.make(organizationId),
          sendId: result.status.sendId,
        }),
        (message) => queue.send(message),
      )
    : Effect.void;

export const resendEmailTestRoutes = (
  organizations: Organizations,
  queue: Cloudflare.Queues.WriteQueueClient,
  db: Cloudflare.D1.QueryDatabaseClient,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const run = new URL(request.url, "http://localhost").searchParams.get("run") ?? "";
    const organizationId = `resend-email-${run}`;
    const organization = organizations.getByName(organizationId);
    const admin = PersonId.make(`admin-${run}`);
    const lead = PersonId.make(`lead-${run}`);
    const member = PersonId.make(`member-${run}`);
    const leaver = PersonId.make(`leaver-${run}`);
    const teamId = TeamId.make(`team-${run}`);
    const pulseId = PulseId.make(`pulse-${run}`);
    const now = yield* Clock.currentTimeMillis;
    const signInUrl = "https://app.surveybeat.app/";

    yield* organization.createWithAdmin(organizationId, "Acme", admin, "admin@example.com", `user_${run}`);
    yield* organization.runDirectoryCommand(
      admin,
      {
        _tag: "CreateTeam",
        teamId,
        name: "Platform",
        timeZone: TimeZone.make("Europe/Berlin"),
        lead: {
          email: EmailAddress.make("grace@example.com"),
          personId: lead,
          membershipId: MembershipId.make(`membership-lead-${run}`),
          signInUrl,
        },
      },
      now,
    );
    for (const [personId, email] of [
      [member, "ada@example.com"],
      [leaver, "bob@example.com"],
    ] as const) {
      yield* organization.runDirectoryCommand(
        admin,
        {
          _tag: "AddMember",
          teamId,
          role: "member",
          member: {
            email: EmailAddress.make(email),
            personId,
            membershipId: MembershipId.make(`membership-${personId}`),
            signInUrl,
          },
        },
        now,
      );
    }

    yield* organization.runPulseCommand(admin, { _tag: "CreatePulse", teamId, pulseId }, now);
    yield* organization.scheduleNextRound(pulseId, teamId, now);
    const roundsView = yield* organization.viewRounds(admin, teamId, pulseId);
    const roundId =
      roundsView._tag === "Viewed" && roundsView.value.rounds[0] !== undefined
        ? roundsView.value.rounds[0].id
        : null;
    if (roundId === null) return yield* HttpServerResponse.json({ error: "no_round" });
    const openJob = (yield* organization.getJobsForRound(roundId)).find((job) => job.type === "open");
    if (openJob === undefined) return yield* HttpServerResponse.json({ error: "no_open_job" });
    yield* organization.runScheduleJob(openJob.id, openJob.due_at);
    const invitations = yield* organization.getInvitations(roundId);
    const sendOf = (personId: PersonId) => {
      const found = invitations.find((each) => each.personId === personId);
      if (found === undefined) throw new Error(`no Invitation for ${personId}`);
      return found.sendId;
    };

    const adaSend = sendOf(member);
    yield* organization.abandonEmailSend(adaSend, now);
    yield* organization.failInvitation(roundId, member, "mailbox full", now);
    const leaverSend = sendOf(leaver);
    yield* organization.abandonEmailSend(leaverSend, now);
    yield* organization.runDirectoryCommand(admin, { _tag: "RemovePerson", personId: leaver }, now);
    const leadSend = sendOf(lead);
    yield* organization.abandonEmailSend(leadSend, now);
    yield* organization.failInvitation(roundId, lead, "mailbox full", now);
    const reSent = yield* organization.runRoundCommand(
      admin,
      { _tag: "ResendInvitation", teamId, roundId, personId: lead },
      now,
    );

    const failedBefore = yield* organization.listFailedEmails(admin);
    const revokedResend = yield* organization.resendFailedEmail(admin, leaverSend, now);
    const staleResend = yield* organization.resendFailedEmail(admin, leadSend, now);

    const recipient = `resent-${run}@example.com`;
    const added = SendId.make(`added-${run}`);
    yield* organization.createEmailSend(added, EmailAddress.make(recipient), {
      _tag: "AddedToTeam",
      locale: "en",
      teamName: "Platform",
      leadName: "Grace",
      signInUrl,
    });
    yield* organization.abandonEmailSend(added, now);
    const leadResend = yield* organization.resendFailedEmail(lead, added, now);
    const memberResend = yield* organization.resendFailedEmail(member, added, now);
    const stillFailed = yield* organization.getEmailSend(added);

    const otherId = `resend-email-other-${run}`;
    const other = organizations.getByName(otherId);
    const otherAdmin = PersonId.make(`other-admin-${run}`);
    yield* other.createWithAdmin(otherId, "Globex", otherAdmin, "boss@example.com", `user_other_${run}`);
    const otherResend = yield* other.resendFailedEmail(otherAdmin, added, now);

    const first = yield* organization.resendFailedEmail(admin, added, now);
    yield* enqueue(queue, organizationId, first);
    const second = yield* organization.resendFailedEmail(admin, added, now);
    yield* enqueue(queue, organizationId, second);

    const adaResend = yield* organization.resendFailedEmail(admin, adaSend, now);
    yield* enqueue(queue, organizationId, adaResend);
    const leadRoundView = yield* organization.viewRound(admin, teamId, roundId);
    const failedInvitationsAfter =
      leadRoundView._tag === "Viewed"
        ? leadRoundView.value.failedInvitations.map((each) => each.personId)
        : [];

    const sent = yield* organization.getEmailSend(added).pipe(
      Effect.repeat({
        until: (record) => record?.state._tag === "Sent",
        schedule: Schedule.spaced("250 millis"),
        times: 80,
      }),
    );
    const captured = yield* db
      .prepare("SELECT recipient, subject FROM captured_email WHERE recipient = ?")
      .bind(recipient)
      .all();
    const listedAfter = yield* organization.listFailedEmails(admin);
    const statusAfter = yield* organization.viewEmailStatus(admin, added);

    return yield* HttpServerResponse.json({
      reSent: reSent._tag,
      failedBefore,
      revokedResend,
      staleResend,
      leadResend,
      memberResend,
      stillFailed: stillFailed?.state ?? null,
      otherResend,
      first,
      second,
      adaResend,
      failedInvitationsAfter,
      sent: sent?.state ?? null,
      captured: captured.results,
      listedAfter,
      statusAfter,
    });
  }).pipe(Effect.orDie);
