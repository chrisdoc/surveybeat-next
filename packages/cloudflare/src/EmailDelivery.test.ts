import { describe, expect, it } from "@effect/vitest";
import { EmailAddress, OrganizationId, SendId } from "@surveybeat/domain";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { handleDeadLetter, parseDeliveryEvent, queueEmail } from "./EmailDelivery.ts";

// Shapes from https://developers.cloudflare.com/email-service/reference/event-subscriptions/
const event = (type: string, payload: Record<string, unknown>) => ({
  type,
  source: { type: "email.sending", zoneId: "z", domain: "notify.surveybeat.app" },
  payload: {
    eventId: "e-1",
    messageId: "m-1",
    sender: "team@notify.surveybeat.app",
    recipient: "a@b.co",
    ...payload,
  },
  metadata: {
    accountId: "a",
    eventSubscriptionId: "s",
    eventSchemaVersion: 1,
    eventTimestamp: "2026-06-01T02:48:57.132Z",
  },
});

describe("parseDeliveryEvent", () => {
  it("reads a hard bounce with its enhanced status code", () => {
    const bounced = event("cf.email.sending.message.bounced", {
      delivery: { status: "bounced", smtpStatusCode: "550", smtpEnhancedStatusCode: "5.1.1" },
      bounce: { type: "hard", classification: "permanent_failure", reason: "User unknown" },
    });
    expect(parseDeliveryEvent(bounced)).toEqual(
      Option.some({ messageId: "m-1", kind: "bounced", code: "5.1.1" }),
    );
  });

  it("reads a complaint", () => {
    const complained = event("cf.email.sending.message.complained", {
      delivery: { status: "complained" },
      complaint: { type: "abuse" },
    });
    expect(parseDeliveryEvent(complained)).toEqual(
      Option.some({ messageId: "m-1", kind: "complained", code: "abuse" }),
    );
  });

  it("reads a rejection by its reason", () => {
    const rejected = event("cf.email.sending.message.rejected", {
      delivery: { status: "rejected" },
      rejection: { reason: "suppressed", party: "recipient" },
    });
    expect(parseDeliveryEvent(rejected)).toEqual(
      Option.some({ messageId: "m-1", kind: "rejected", code: "suppressed" }),
    );
  });

  it("accepts the short event name", () => {
    expect(parseDeliveryEvent(event("message.delivered", {}))).toEqual(
      Option.some({ messageId: "m-1", kind: "delivered", code: null }),
    );
  });

  it("ignores anything else", () => {
    expect(parseDeliveryEvent(event("cf.email.sending.message.opened", {}))).toEqual(Option.none());
    expect(parseDeliveryEvent({ type: "cf.email.sending.message.bounced" })).toEqual(Option.none());
    expect(parseDeliveryEvent("not json")).toEqual(Option.none());
  });
});

describe("handleDeadLetter", () => {
  it.effect("abandons the send and acks, so a give-up never leaves it pending", () => {
    const abandoned: Array<readonly [string, string]> = [];
    let acked = 0;
    let retried = 0;
    const organizations = {
      getByName: (organizationId: string) => ({
        abandonEmailSend: (sendId: string) => {
          abandoned.push([organizationId, sendId]);
          return Effect.succeed({ _tag: "Failed" });
        },
      }),
    };
    const message = {
      body: { organizationId: "org-1", sendId: "send-1" },
      ack: () => {
        acked++;
      },
      retry: () => {
        retried++;
      },
    };

    return Effect.gen(function* () {
      yield* handleDeadLetter(organizations as never, message as never);
      expect(abandoned).toEqual([["org-1", "send-1"]]);
      expect(acked).toBe(1);
      expect(retried).toBe(0);
    });
  });

  it.effect("acks a malformed message without touching an Organization", () => {
    let called = 0;
    let acked = 0;
    const organizations = {
      getByName: () => {
        called++;
        return { abandonEmailSend: () => Effect.succeed(null) };
      },
    };
    const message = {
      body: "not a send request",
      ack: () => {
        acked++;
      },
      retry: () => {},
    };

    return Effect.gen(function* () {
      yield* handleDeadLetter(organizations as never, message as never);
      expect(called).toBe(0);
      expect(acked).toBe(1);
    });
  });
});

describe("queueEmail", () => {
  it.effect("creates the send and enqueues it once, and enqueues nothing for a settled send", () => {
    const created: Array<string> = [];
    const sent: Array<unknown> = [];
    let settle = false;
    const organizations = {
      getByName: () => ({
        createEmailSend: (sendId: string) => {
          created.push(sendId);
          return Effect.succeed(settle ? { _tag: "Sent" } : { _tag: "Pending" });
        },
      }),
    };
    const queue = {
      send: (body: unknown) => {
        sent.push(body);
        return Effect.void;
      },
    };
    const request = {
      organizationId: OrganizationId.make("org-1"),
      sendId: SendId.make("send-1"),
      recipient: EmailAddress.make("a@b.co"),
      email: { subject: "Hi", html: "<p>Hi</p>", text: "Hi" } as never,
    };

    return Effect.gen(function* () {
      const runtime = Effect.provideService(RuntimeContext, {} as never);
      yield* queueEmail(organizations as never, queue as never, request).pipe(runtime);
      settle = true;
      yield* queueEmail(organizations as never, queue as never, request).pipe(runtime);
      expect(created).toEqual(["send-1", "send-1"]);
      expect(sent).toHaveLength(1);
    });
  });
});
