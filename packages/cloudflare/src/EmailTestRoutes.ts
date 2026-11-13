import type * as Cloudflare from "@alchemy.run/cloudflare";
import { EmailAddress, OrganizationId, SendId } from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { type Organizations, queueEmail } from "./EmailDelivery.ts";

/** Stages that `@alchemy.run/test` creates (`test_$USER…`). No other stage gets these routes. */
export const isTestStage = (stage: string): boolean => stage.startsWith("test_");

export const TEST_ROUTES = "/__test/email";

/**
 * Test-only routes for the email adapter test on local workerd (ADR 0008): `POST` queues an
 * "added to team" email to `ada@example.com`; `GET` reads the send back with what was captured.
 */
export const emailTestRoutes = (
  organizations: Organizations,
  queue: Cloudflare.Queues.WriteQueueClient,
  db: Cloudflare.D1.QueryDatabaseClient,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const params = new URL(request.url, "http://localhost").searchParams;
    const organizationId = OrganizationId.make(params.get("organization") ?? "");
    const sendId = SendId.make(params.get("send") ?? "");
    if (request.method === "POST") {
      const state = yield* queueEmail(organizations, queue, {
        organizationId,
        sendId,
        recipient: EmailAddress.make("ada@example.com"),
        email: {
          _tag: "AddedToTeam",
          locale: "en",
          teamName: "Platform",
          leadName: "Grace Hopper",
          signInUrl: "https://app.surveybeat.app/",
        },
      });
      return yield* HttpServerResponse.json({ state });
    }
    const record = yield* organizations.getByName(organizationId).getEmailSend(sendId);
    const messageId = record?.state._tag === "Sent" ? record.state.messageId : "";
    const captured = yield* db
      .prepare("SELECT recipient, subject, text FROM captured_email WHERE message_id = ?")
      .bind(messageId)
      .all();
    const indexed = yield* db
      .prepare("SELECT organization_id, send_id FROM email_message WHERE message_id = ?")
      .bind(messageId)
      .all();
    return yield* HttpServerResponse.json({
      state: record?.state ?? null,
      captured: captured.results,
      indexed: indexed.results,
    });
  }).pipe(Effect.orDie);
