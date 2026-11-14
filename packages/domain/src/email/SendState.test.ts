import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";
import {
  abandon,
  claim,
  pending,
  recordDeliveryEvent,
  requeue,
  retryDelaySeconds,
  type SendState,
  settle,
} from "./SendState.ts";

const policy = { leaseMillis: 1_000, maxAttempts: 3 };
const sending = (attempt: number, leaseExpiresAt = 2_000): SendState => ({
  _tag: "Sending",
  attempt,
  leaseExpiresAt,
});
const sent: SendState = { _tag: "Sent", messageId: "m-1", sentAt: 1_500 };

describe("claim", () => {
  it("takes a lease on a pending send", () => {
    expect(claim(pending, 1_000, policy)).toEqual({ _tag: "Send", state: sending(1) });
  });

  it("counts the attempt after clear rejections", () => {
    const retrying: SendState = { _tag: "Pending", attempts: 2, lastCode: "E_RATE_LIMIT_EXCEEDED" };
    expect(claim(retrying, 1_000, policy)).toEqual({ _tag: "Send", state: sending(3) });
  });

  it("waits while another delivery holds the lease", () => {
    expect(claim(sending(1), 1_999, policy)).toEqual({ _tag: "Wait", until: 2_000 });
  });

  it("fails an expired lease as unknown and never sends again", () => {
    expect(claim(sending(1), 2_000, policy)).toEqual({
      _tag: "Finished",
      state: { _tag: "Failed", reason: "unknown", code: null, failedAt: 2_000 },
      changed: true,
    });
  });

  it("leaves a finished send alone", () => {
    expect(claim(sent, 5_000, policy)).toEqual({ _tag: "Finished", state: sent, changed: false });
    const failed: SendState = { _tag: "Failed", reason: "rejected", code: "E_X", failedAt: 1 };
    expect(claim(failed, 5_000, policy)).toEqual({ _tag: "Finished", state: failed, changed: false });
  });
});

describe("settle", () => {
  it("records an accepted message as sent", () => {
    expect(settle(sending(1), 1, { _tag: "Accepted", messageId: "m-1" }, 1_500, policy)).toEqual(
      Option.some(sent),
    );
  });

  it("returns a clearly rejected send to pending until the attempts run out", () => {
    const rejected = { _tag: "Rejected", code: "E_DELIVERY_FAILED", permanent: false } as const;
    expect(settle(sending(2), 2, rejected, 1_500, policy)).toEqual(
      Option.some({ _tag: "Pending", attempts: 2, lastCode: "E_DELIVERY_FAILED" }),
    );
    expect(settle(sending(3), 3, rejected, 1_500, policy)).toEqual(
      Option.some({ _tag: "Failed", reason: "rejected", code: "E_DELIVERY_FAILED", failedAt: 1_500 }),
    );
  });

  it("fails a permanent rejection at once", () => {
    const suppressed = { _tag: "Rejected", code: "E_RECIPIENT_SUPPRESSED", permanent: true } as const;
    expect(settle(sending(1), 1, suppressed, 1_500, policy)).toEqual(
      Option.some({ _tag: "Failed", reason: "rejected", code: "E_RECIPIENT_SUPPRESSED", failedAt: 1_500 }),
    );
  });

  it("fails an unknown outcome without a retry", () => {
    expect(settle(sending(1), 1, { _tag: "Unknown", code: "E_TIMEOUT" }, 1_500, policy)).toEqual(
      Option.some({ _tag: "Failed", reason: "unknown", code: "E_TIMEOUT", failedAt: 1_500 }),
    );
  });

  it("ignores an attempt that no longer holds the send", () => {
    const accepted = { _tag: "Accepted", messageId: "m-1" } as const;
    expect(settle(sending(2), 1, accepted, 1_500, policy)).toEqual(Option.none());
    const expired: SendState = { _tag: "Failed", reason: "unknown", code: null, failedAt: 2_000 };
    expect(settle(expired, 1, accepted, 2_500, policy)).toEqual(Option.none());
    expect(settle(sent, 1, accepted, 2_500, policy)).toEqual(Option.none());
  });
});

describe("abandon", () => {
  it("fails a never-attempted send as abandoned", () => {
    expect(abandon(pending, 9)).toEqual(
      Option.some({ _tag: "Failed", reason: "abandoned", code: null, failedAt: 9 }),
    );
  });

  it("keeps the last rejection of a retried send", () => {
    expect(abandon({ _tag: "Pending", attempts: 1, lastCode: "E_RATE_LIMIT_EXCEEDED" }, 9)).toEqual(
      Option.some({ _tag: "Failed", reason: "rejected", code: "E_RATE_LIMIT_EXCEEDED", failedAt: 9 }),
    );
  });

  it("fails an in-flight send as unknown", () => {
    expect(abandon(sending(1), 9)).toEqual(
      Option.some({ _tag: "Failed", reason: "unknown", code: null, failedAt: 9 }),
    );
  });

  it("leaves a finished send alone", () => {
    expect(abandon(sent, 9)).toEqual(Option.none());
  });
});

describe("recordDeliveryEvent", () => {
  it.each(["bounced", "complained"] as const)("fails a sent message that %s", (kind) => {
    expect(recordDeliveryEvent(sent, kind, "5.1.1", 9)).toEqual(
      Option.some({ _tag: "Failed", reason: kind, code: "5.1.1", failedAt: 9 }),
    );
  });

  it.each(["rejected", "failed"] as const)("fails a sent message the provider later %s", (kind) => {
    expect(recordDeliveryEvent(sent, kind, null, 9)).toEqual(
      Option.some({ _tag: "Failed", reason: "rejected", code: null, failedAt: 9 }),
    );
  });

  it.each(["delivered", "deferred"] as const)("ignores %s", (kind) => {
    expect(recordDeliveryEvent(sent, kind, null, 9)).toEqual(Option.none());
  });

  it("ignores events for a send that is not sent", () => {
    expect(recordDeliveryEvent(pending, "bounced", null, 9)).toEqual(Option.none());
  });
});

describe("requeue", () => {
  it("sends a failed send again: pending, with no attempts and no last code", () => {
    const failed: SendState = { _tag: "Failed", reason: "rejected", code: "E_X", failedAt: 1 };
    expect(requeue(failed)).toEqual(Option.some({ _tag: "Pending", attempts: 0, lastCode: null }));
  });

  it.each([
    ["pending", pending],
    ["sending", sending(1)],
    ["sent", sent],
  ] as const)("leaves a %s send alone", (_name, state) => {
    expect(requeue(state)).toEqual(Option.none());
  });
});

describe("retryDelaySeconds", () => {
  it("doubles from 30 seconds up to 10 minutes", () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelaySeconds)).toEqual([30, 60, 120, 240, 480, 600]);
  });
});
