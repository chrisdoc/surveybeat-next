import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import { parseDeliveryEvent } from "./EmailDelivery.ts";

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
