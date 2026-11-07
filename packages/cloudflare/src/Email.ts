import * as Cloudflare from "@alchemy.run/cloudflare";
import { OrganizationId, SendId } from "@surveybeat/domain";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ZONE, ZONE_ID } from "./Hostnames.ts";

/** Only production sends real email. Every other stage records messages instead (docs/infra.md). */
export const sendsRealEmail = (stage: string): boolean => stage === "production";

/** The sending subdomain. The apex keeps its own mail, SPF, and DMARC records untouched. */
export const SENDING_DOMAIN = `notify.${ZONE}`;
export const FROM = { email: `team@${SENDING_DOMAIN}`, name: "SurveyBeat" } as const;

/** The `send_email` binding. Bound to the Main Worker in production only. */
export const SendEmail = Cloudflare.Email.SendEmail("Email");

/** One message per send. The consumer looks the send up in its Organization's Durable Object. */
export const EmailQueue = Cloudflare.Queues.Queue("Email");
/** Messages the consumer gave up on. Their sends are failed, never left pending. */
export const EmailQueueDlq = Cloudflare.Queues.Queue("EmailDlq");
/** Cloudflare Email Sending events (bounces, complaints) for the sending subdomain. Production only. */
export const EmailEvents = Cloudflare.Queues.Queue("EmailEvents");

export const EmailSendRequested = Schema.Struct({ organizationId: OrganizationId, sendId: SendId });
export type EmailSendRequested = typeof EmailSendRequested.Type;

/**
 * Production only: the sending subdomain (Cloudflare creates its DKIM, SPF, DMARC, and bounce
 * records under `notify.`, never at the apex) and the event subscription that feeds bounces and
 * complaints into `EmailEvents`. Other stages provision neither.
 */
export const ProductionEmail = Effect.gen(function* () {
  const { stage } = yield* Stack;
  if (!sendsRealEmail(stage)) return undefined;
  const subdomain = yield* Cloudflare.Email.SendingSubdomain("Notify", {
    zoneId: ZONE_ID,
    name: SENDING_DOMAIN,
    // Cloudflare would otherwise keep each message, invitation links included, for about a week.
    previewEnabled: false,
  });
  const events = yield* EmailEvents;
  yield* Cloudflare.Queues.Subscription("EmailEventsSubscription", {
    source: { type: "email.sending", zoneId: ZONE_ID, domain: SENDING_DOMAIN },
    events: ["message.bounced", "message.complained", "message.rejected", "message.failed"],
    queueId: events.queueId,
  });
  return subdomain;
});
