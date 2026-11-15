import * as Cloudflare from "@alchemy.run/cloudflare";
import { OrganizationId, SendId } from "@surveybeat/domain";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ZONE, ZONE_ID } from "./Hostnames.ts";

export const sendsRealEmail = (stage: string): boolean => stage === "production";

export const SENDING_DOMAIN = `notify.${ZONE}`;
export const FROM = { email: `team@${SENDING_DOMAIN}`, name: "SurveyBeat" } as const;

export const SendEmail = Cloudflare.Email.SendEmail("SendEmail");

export const EmailQueue = Cloudflare.Queues.Queue("Email");
export const EmailQueueDlq = Cloudflare.Queues.Queue("EmailDlq");
export const EmailEvents = Cloudflare.Queues.Queue("EmailEvents");

export const EmailSendRequested = Schema.Struct({ organizationId: OrganizationId, sendId: SendId });
export type EmailSendRequested = typeof EmailSendRequested.Type;

export const ProductionEmail = Effect.gen(function* () {
  const { stage } = yield* Stack;
  if (!sendsRealEmail(stage)) return undefined;
  const subdomain = yield* Cloudflare.Email.SendingSubdomain("Notify", {
    zoneId: ZONE_ID,
    name: SENDING_DOMAIN,
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
