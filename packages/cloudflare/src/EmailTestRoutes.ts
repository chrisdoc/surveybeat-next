import type * as Cloudflare from "@alchemy.run/cloudflare";
import { EmailAddress, OrganizationId, PersonId, SendId } from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { Organizations } from "./EmailDelivery.ts";

export const isTestStage = (stage: string): boolean => stage.startsWith("test_");

export const TEST_ROUTES = "/__test/email";

export const emailTestRoutes = (organizations: Organizations, db: Cloudflare.D1.QueryDatabaseClient) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const params = new URL(request.url, "http://localhost").searchParams;
    const recipient = params.get("recipient");
    if (recipient !== null) {
      const captured = yield* db
        .prepare("SELECT text FROM captured_email WHERE recipient = ? ORDER BY captured_at DESC LIMIT 1")
        .bind(recipient)
        .all<{ text: string }>();
      return yield* HttpServerResponse.json({ text: captured.results[0]?.text ?? null });
    }
    const organizationId = OrganizationId.make(params.get("organization") ?? "");
    const sendId = SendId.make(params.get("send") ?? "");
    if (request.method === "POST") {
      const organization = organizations.getByName(organizationId);
      yield* organization.createWithAdmin(
        organizationId,
        "Acme",
        PersonId.make("admin-email-test"),
        "admin@example.com",
        "user_email_test",
      );
      const state = yield* organization.createEmailSend(sendId, EmailAddress.make("ada@example.com"), {
        _tag: "AddedToTeam",
        locale: "en",
        teamName: "Platform",
        leadName: "Grace Hopper",
        signInUrl: "https://app.surveybeat.app/",
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
