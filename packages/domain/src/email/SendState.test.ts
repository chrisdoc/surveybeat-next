import { describe, expect, it, prop } from "@effect/vitest";
import { createEffectActor } from "@xstate/effect";
import { sendAndAwait } from "@xstate/effect/test";
import { Effect, Option, Schema } from "effect";
import { isUnhandled, transition } from "xstate";
import {
  abandon,
  claim,
  pending,
  recordDeliveryEvent,
  requeue,
  retryDelaySeconds,
  sendMachine,
  SendState as SendStateSchema,
  settle,
} from "./SendState.ts";
import type { SendState } from "./SendState.ts";

const policy = { leaseMillis: 1000, maxAttempts: 3 };

const sending = (attempt: number, leaseExpiresAt = 2000): SendState => ({
  _tag: "Sending",
  attempt,
  leaseExpiresAt,
});

const sent: SendState = { _tag: "Sent", messageId: "m-1", sentAt: 1500 };

describe("claim", () => {
  it("takes a lease on a pending send", () => {
    expect(claim(pending, 1000, policy)).toEqual({ _tag: "Send", state: sending(1) });
  });

  it("counts the attempt after clear rejections", () => {
    const retrying: SendState = { _tag: "Pending", attempts: 2, lastCode: "E_RATE_LIMIT_EXCEEDED" };
    expect(claim(retrying, 1000, policy)).toEqual({ _tag: "Send", state: sending(3) });
  });

  it("waits while another delivery holds the lease", () => {
    expect(claim(sending(1), 1999, policy)).toEqual({ _tag: "Wait", until: 2000 });
  });

  it("fails an expired lease as unknown and never sends again", () => {
    expect(claim(sending(1), 2000, policy)).toEqual({
      _tag: "Finished",
      state: { _tag: "Failed", reason: "unknown", code: null, failedAt: 2000 },
      changed: true,
    });
  });

  it("leaves a finished send alone", () => {
    expect(claim(sent, 5000, policy)).toEqual({ _tag: "Finished", state: sent, changed: false });
    const failed: SendState = { _tag: "Failed", reason: "rejected", code: "E_X", failedAt: 1 };
    expect(claim(failed, 5000, policy)).toEqual({ _tag: "Finished", state: failed, changed: false });
  });
});

describe("settle", () => {
  it("records an accepted message as sent", () => {
    expect(settle(sending(1), 1, { _tag: "Accepted", messageId: "m-1" }, 1500, policy)).toEqual(
      Option.some(sent),
    );
  });

  it("returns a clearly rejected send to pending until the attempts run out", () => {
    const rejected = { _tag: "Rejected", code: "E_DELIVERY_FAILED", permanent: false } as const;
    expect(settle(sending(2), 2, rejected, 1500, policy)).toEqual(
      Option.some({ _tag: "Pending", attempts: 2, lastCode: "E_DELIVERY_FAILED" }),
    );
    expect(settle(sending(3), 3, rejected, 1500, policy)).toEqual(
      Option.some({ _tag: "Failed", reason: "rejected", code: "E_DELIVERY_FAILED", failedAt: 1500 }),
    );
  });

  it("fails a permanent rejection at once", () => {
    const suppressed = { _tag: "Rejected", code: "E_RECIPIENT_SUPPRESSED", permanent: true } as const;
    expect(settle(sending(1), 1, suppressed, 1500, policy)).toEqual(
      Option.some({ _tag: "Failed", reason: "rejected", code: "E_RECIPIENT_SUPPRESSED", failedAt: 1500 }),
    );
  });

  it("fails an unknown outcome without a retry", () => {
    expect(settle(sending(1), 1, { _tag: "Unknown", code: "E_TIMEOUT" }, 1500, policy)).toEqual(
      Option.some({ _tag: "Failed", reason: "unknown", code: "E_TIMEOUT", failedAt: 1500 }),
    );
  });

  it("ignores an attempt that no longer holds the send", () => {
    const accepted = { _tag: "Accepted", messageId: "m-1" } as const;
    expect(settle(sending(2), 1, accepted, 1500, policy)).toEqual(Option.none());
    const expired: SendState = { _tag: "Failed", reason: "unknown", code: null, failedAt: 2000 };
    expect(settle(expired, 1, accepted, 2500, policy)).toEqual(Option.none());
    expect(settle(sent, 1, accepted, 2500, policy)).toEqual(Option.none());
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

const Policy = Schema.Struct({ leaseMillis: Schema.Int, maxAttempts: Schema.Int });

const Outcome = Schema.Union([
  Schema.TaggedStruct("Accepted", { messageId: Schema.String }),
  Schema.TaggedStruct("Rejected", { code: Schema.String, permanent: Schema.Boolean }),
  Schema.TaggedStruct("Unknown", { code: Schema.String }),
]);

describe("send state properties", () => {
  prop(
    "claim sends, waits for a live lease, or finishes, and never sends a settled send again",
    { state: SendStateSchema, now: Schema.Int, policy: Policy },
    ({ state, now, policy }) => {
      const decision = claim(state, now, policy);

      switch (state._tag) {
        case "Pending": {
          return (
            decision._tag === "Send" &&
            decision.state.attempt === state.attempts + 1 &&
            decision.state.leaseExpiresAt === now + policy.leaseMillis
          );
        }

        case "Sending": {
          return now < state.leaseExpiresAt
            ? decision._tag === "Wait" && decision.until === state.leaseExpiresAt
            : decision._tag === "Finished" &&
                decision.changed &&
                decision.state._tag === "Failed" &&
                decision.state.reason === "unknown";
        }

        case "Sent": {
          return (
            decision._tag === "Finished" &&
            !decision.changed &&
            decision.state._tag === "Sent" &&
            decision.state.messageId === state.messageId
          );
        }

        case "Failed": {
          return (
            decision._tag === "Finished" &&
            !decision.changed &&
            decision.state._tag === "Failed" &&
            decision.state.failedAt === state.failedAt
          );
        }
      }
    },
  );

  prop(
    "settle records only the attempt that holds the send, and only a clear rejection returns it to pending",
    { state: SendStateSchema, attempt: Schema.Int, outcome: Outcome, now: Schema.Int, policy: Policy },
    ({ state, attempt, outcome, now, policy }) => {
      const settled = settle(state, attempt, outcome, now, policy);

      if (state._tag !== "Sending" || state.attempt !== attempt) {
        return Option.isNone(settled);
      }

      if (Option.isNone(settled)) {
        return false;
      }

      const next = settled.value;

      switch (outcome._tag) {
        case "Accepted": {
          return next._tag === "Sent" && next.messageId === outcome.messageId && next.sentAt === now;
        }

        case "Rejected": {
          return outcome.permanent || attempt >= policy.maxAttempts
            ? next._tag === "Failed" && next.reason === "rejected" && next.code === outcome.code
            : next._tag === "Pending" && next.attempts === attempt && next.lastCode === outcome.code;
        }

        case "Unknown": {
          return next._tag === "Failed" && next.reason === "unknown" && next.code === outcome.code;
        }
      }
    },
  );

  prop(
    "requeue moves a failed send back to pending and leaves every other state alone",
    { state: SendStateSchema },
    ({ state }) => {
      const requeued = requeue(state);

      if (state._tag === "Failed") {
        return (
          Option.isSome(requeued) &&
          requeued.value._tag === "Pending" &&
          requeued.value.attempts === 0 &&
          requeued.value.lastCode === null
        );
      }

      return Option.isNone(requeued);
    },
  );
});

const machineAt = (state: SendState) =>
  sendMachine.resolveState({
    value:
      state._tag === "Pending"
        ? "pending"
        : state._tag === "Sending"
          ? "sending"
          : state._tag === "Sent"
            ? "sent"
            : "failed",
    context: { state },
  });

const refuses = (state: SendState, event: Parameters<typeof transition<typeof sendMachine>>[2]): boolean => {
  const snapshot = machineAt(state);

  return isUnhandled(snapshot, transition(sendMachine, snapshot, event));
};

const live: SendState = sending(1, 2000);

const dead: SendState = { _tag: "Failed", reason: "abandoned", code: null, failedAt: 10 };

describe("send machine", () => {
  it.each([
    [pending, { type: "Settle", attempt: 1, outcome: { _tag: "Accepted", messageId: "m" }, now: 1, policy }],
    [pending, { type: "Delivery", kind: "bounced", code: null, now: 1 }],
    [pending, { type: "Requeue" }],
    [live, { type: "Requeue" }],
    [live, { type: "Delivery", kind: "bounced", code: null, now: 1 }],
    [live, { type: "Settle", attempt: 9, outcome: { _tag: "Accepted", messageId: "m" }, now: 1, policy }],
    [sent, { type: "Abandon", now: 1 }],
    [sent, { type: "Requeue" }],
    [sent, { type: "Settle", attempt: 1, outcome: { _tag: "Accepted", messageId: "m" }, now: 1, policy }],
    [dead, { type: "Claim", now: 1, policy }],
    [dead, { type: "Abandon", now: 1 }],
    [dead, { type: "Settle", attempt: 1, outcome: { _tag: "Accepted", messageId: "m" }, now: 1, policy }],
    [dead, { type: "Delivery", kind: "bounced", code: null, now: 1 }],
  ] as const)("refuses %#", (state, event) => {
    expect(refuses(state, event)).toBe(true);
  });

  it.effect("takes a send from Pending to Sent", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const actor = yield* createEffectActor(sendMachine);
        expect(actor.getSnapshot().value).toBe("pending");
        yield* sendAndAwait(actor, { type: "Claim", now: 1000, policy });
        expect(actor.getSnapshot().value).toBe("sending");
        yield* sendAndAwait(actor, {
          type: "Settle",
          attempt: 1,
          outcome: { _tag: "Accepted", messageId: "m-1" },
          now: 1500,
          policy,
        });
        expect(actor.getSnapshot().value).toBe("sent");
        expect(actor.getSnapshot().context.state).toEqual({ _tag: "Sent", messageId: "m-1", sentAt: 1500 });
      }),
    ),
  );

  it.effect("retries a clear rejection and gives up when the attempts run out", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const actor = yield* createEffectActor(sendMachine);
        const rejected = { _tag: "Rejected", code: "E_DELIVERY_FAILED", permanent: false } as const;
        yield* sendAndAwait(actor, { type: "Claim", now: 1000, policy });
        yield* sendAndAwait(actor, { type: "Settle", attempt: 1, outcome: rejected, now: 1100, policy });
        expect(actor.getSnapshot().value).toBe("pending");
        expect(actor.getSnapshot().context.state).toEqual({
          _tag: "Pending",
          attempts: 1,
          lastCode: "E_DELIVERY_FAILED",
        });
        yield* sendAndAwait(actor, { type: "Claim", now: 1200, policy });
        yield* sendAndAwait(actor, { type: "Settle", attempt: 2, outcome: rejected, now: 1250, policy });
        yield* sendAndAwait(actor, { type: "Claim", now: 1260, policy });
        yield* sendAndAwait(actor, { type: "Settle", attempt: 3, outcome: rejected, now: 1300, policy });
        expect(actor.getSnapshot().value).toBe("failed");
        expect(actor.getSnapshot().context.state).toEqual({
          _tag: "Failed",
          reason: "rejected",
          code: "E_DELIVERY_FAILED",
          failedAt: 1300,
        });
        yield* sendAndAwait(actor, { type: "Requeue" });
        expect(actor.getSnapshot().value).toBe("pending");
      }),
    ),
  );

  it.effect("fails an ambiguous result and records a bounce after delivery", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const actor = yield* createEffectActor(sendMachine);
        yield* sendAndAwait(actor, { type: "Claim", now: 1000, policy });
        yield* sendAndAwait(actor, {
          type: "Settle",
          attempt: 1,
          outcome: { _tag: "Unknown", code: "E_TIMEOUT" },
          now: 1100,
          policy,
        });
        expect(actor.getSnapshot().context.state).toEqual({
          _tag: "Failed",
          reason: "unknown",
          code: "E_TIMEOUT",
          failedAt: 1100,
        });

        const delivered = yield* createEffectActor(sendMachine, {
          snapshot: sendMachine.resolveState({ value: "sent", context: { state: sent } }),
        });

        yield* sendAndAwait(delivered, { type: "Delivery", kind: "bounced", code: "E_BOUNCE", now: 2000 });
        expect(delivered.getSnapshot().value).toBe("failed");
        expect(delivered.getSnapshot().context.state).toEqual({
          _tag: "Failed",
          reason: "bounced",
          code: "E_BOUNCE",
          failedAt: 2000,
        });
      }),
    ),
  );
});
