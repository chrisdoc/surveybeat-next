import type * as Cloudflare from "@alchemy.run/cloudflare";
import {
  EmailAddress,
  MembershipId,
  OrganizationId,
  PersonId,
  PulseId,
  QuestionVersionId,
  SendId,
  TeamId,
  type TestSendResult,
  testInvitationLifetimeMs,
  TimeZone,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { EmailSendRequested } from "./Email.ts";
import type { Organizations } from "./EmailDelivery.ts";

export const TEST_INVITATION_TEST_ROUTE = "/__test/test-invitations";

const outcome = (result: TestSendResult) => (result._tag === "Accepted" ? "Accepted" : result.rejection._tag);

/**
 * Test stages only (`isTestStage`): runs "send me a test" against a real Organization Durable Object and
 * the real email queue, so `Organization.test.ts` checks what ADR 0021 promises on local workerd. An
 * admin sends six tests in one hour (the sixth is refused), a send an hour later is accepted, a plain
 * member is refused, and the first test's token is indexed in D1 as a test and never as an Invitation.
 */
export const testInvitationTestRoutes = (
  organizations: Organizations,
  queue: Cloudflare.Queues.WriteQueueClient,
  db: Cloudflare.D1.QueryDatabaseClient,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const run = new URL(request.url, "http://localhost").searchParams.get("run") ?? "";
    const organizationId = `test-invitations-${run}`;
    const organization = organizations.getByName(organizationId);
    const admin = PersonId.make(`admin-${run}`);
    const member = PersonId.make(`member-${run}`);
    const teamId = TeamId.make(`team-${run}`);
    const pulseId = PulseId.make(`pulse-${run}`);
    const now = 1_700_000_000_000;
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
          personId: PersonId.make(`grace-${run}`),
          membershipId: MembershipId.make(`membership-lead-${run}`),
          signInUrl,
        },
      },
      now,
    );
    yield* organization.runDirectoryCommand(
      admin,
      {
        _tag: "AddMember",
        teamId,
        role: "member",
        member: {
          email: EmailAddress.make("ada@example.com"),
          personId: member,
          membershipId: MembershipId.make(`membership-member-${run}`),
          signInUrl,
        },
      },
      now,
    );
    yield* organization.runPulseCommand(admin, { _tag: "CreatePulse", teamId, pulseId }, now);

    const send = (actor: PersonId, at: number) => organization.sendTestInvitation(actor, teamId, pulseId, at);
    const burst = yield* Effect.forEach(Array.from({ length: 6 }), () => send(admin, now));
    const afterAnHour = yield* send(admin, now + 3_600_001);
    const byMember = yield* send(member, now);

    const first = burst.find((result) => result._tag === "Accepted");
    const sendId = SendId.make(first?._tag === "Accepted" ? first.sendId : "none");
    const record = yield* organization.getTestSendBySendId(sendId);
    const invitation = yield* organization.getInvitationBySendId(sendId);

    // The first test goes through the real queue: the consumer renders it and indexes its token.
    yield* queue.send(
      yield* Schema.encodeEffect(EmailSendRequested)({
        organizationId: OrganizationId.make(organizationId),
        sendId,
      }),
    );
    const tokenHash = record?.tokenHash ?? "";
    const indexed = yield* db
      .prepare("SELECT organization_id, pulse_id, expires_at FROM test_invitation_index WHERE token_hash = ?")
      .bind(tokenHash)
      .all()
      .pipe(
        Effect.map((result) => result.results),
        Effect.repeat({
          until: (rows) => rows.length > 0,
          schedule: Schedule.spaced("250 millis"),
          times: 80,
        }),
      );
    const asInvitation = yield* db
      .prepare("SELECT token_hash FROM invitation_index WHERE token_hash = ?")
      .bind(tokenHash)
      .all();

    // The answer page's context for the test's Pulse, and what the Lead would see of an answer (ADR 0021).
    const expiresAt = now + testInvitationLifetimeMs;
    const testContext = yield* organization.getTestSubmissionContext(pulseId, expiresAt);
    const view = yield* organization.viewPulse(admin, teamId, pulseId);
    const preview = yield* organization.previewTestAnswers([
      {
        questionVersionId: QuestionVersionId.make("qv-preview"),
        value: 4,
        comment: "Grace, the review was clear",
      },
    ]);
    const noComment = yield* organization.previewTestAnswers([
      { questionVersionId: QuestionVersionId.make("qv-preview"), value: 4, comment: null },
    ]);

    const state = yield* organization.getEmailSend(sendId);
    const messageId = state?.state._tag === "Sent" ? state.state.messageId : "";
    const captured = yield* db
      .prepare("SELECT recipient, subject FROM captured_email WHERE message_id = ?")
      .bind(messageId)
      .all();

    return yield* HttpServerResponse.json({
      burst: burst.map(outcome),
      afterAnHour: outcome(afterAnHour),
      member: outcome(byMember),
      sentAt: now,
      record,
      invitation,
      indexed,
      asInvitation: asInvitation.results,
      captured: captured.results,
      expiresAt,
      testContext,
      view,
      preview,
      noComment,
    });
  }).pipe(Effect.orDie);
