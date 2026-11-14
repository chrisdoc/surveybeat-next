import { Option, Schema } from "effect";
import { isUnhandled, setup, transition, types } from "xstate";

export const FailureReason = Schema.Literals(["unknown", "rejected", "abandoned", "bounced", "complained"]);
export type FailureReason = typeof FailureReason.Type;

export const Pending = Schema.TaggedStruct("Pending", {
  attempts: Schema.Int,
  lastCode: Schema.NullOr(Schema.String),
});
export type Pending = typeof Pending.Type;

export const Sending = Schema.TaggedStruct("Sending", {
  attempt: Schema.Int,
  leaseExpiresAt: Schema.Int,
});
export type Sending = typeof Sending.Type;

export const Sent = Schema.TaggedStruct("Sent", {
  messageId: Schema.String,
  sentAt: Schema.Int,
});
export type Sent = typeof Sent.Type;

export const Failed = Schema.TaggedStruct("Failed", {
  reason: FailureReason,
  code: Schema.NullOr(Schema.String),
  failedAt: Schema.Int,
});
export type Failed = typeof Failed.Type;

export const SendState = Schema.Union([Pending, Sending, Sent, Failed]);
export type SendState = typeof SendState.Type;

export interface SendPolicy {
  readonly leaseMillis: number;

  readonly maxAttempts: number;
}

export const defaultSendPolicy: SendPolicy = { leaseMillis: 2 * 60_000, maxAttempts: 4 };

export const pending: SendState = { _tag: "Pending", attempts: 0, lastCode: null };

export type ClaimDecision =
  | { readonly _tag: "Send"; readonly state: Sending }
  | { readonly _tag: "Wait"; readonly until: number }
  | { readonly _tag: "Finished"; readonly state: Sent | Failed; readonly changed: boolean };

export type SendOutcome =
  | { readonly _tag: "Accepted"; readonly messageId: string }
  | { readonly _tag: "Rejected"; readonly code: string; readonly permanent: boolean }
  | { readonly _tag: "Unknown"; readonly code: string };

export type DeliveryEventKind = "delivered" | "deferred" | "bounced" | "complained" | "rejected" | "failed";

const failedState = (reason: FailureReason, code: string | null, now: number): Failed => ({
  _tag: "Failed",
  reason,
  code,
  failedAt: now,
});

export const sendMachine = setup({
  schemas: {
    context: types<{ state: SendState }>(),
    events: {
      Claim: types<{ now: number; policy: SendPolicy }>(),
      Settle: types<{ attempt: number; outcome: SendOutcome; now: number; policy: SendPolicy }>(),
      Requeue: types<Record<string, never>>(),
      Abandon: types<{ now: number }>(),
      Delivery: types<{ kind: DeliveryEventKind; code: string | null; now: number }>(),
    },
  },
}).createMachine({
  id: "Send",
  context: { state: pending },
  initial: "pending",
  states: {
    pending: {
      on: {
        Claim: ({ context, event }) => ({
          target: "sending",
          context: {
            state: {
              _tag: "Sending",
              attempt: (context.state._tag === "Pending" ? context.state.attempts : 0) + 1,
              leaseExpiresAt: event.now + event.policy.leaseMillis,
            },
          },
        }),
        Abandon: ({ context, event }) => ({
          target: "failed",
          context: {
            state:
              context.state._tag === "Pending" && context.state.lastCode !== null
                ? failedState("rejected", context.state.lastCode, event.now)
                : failedState("abandoned", null, event.now),
          },
        }),
      },
    },
    sending: {
      on: {
        Claim: ({ context, event }) => {
          if (context.state._tag === "Sending" && event.now < context.state.leaseExpiresAt) {
            return { target: "sending" };
          }
          return { target: "failed", context: { state: failedState("unknown", null, event.now) } };
        },
        Settle: ({ context, event }) => {
          if (context.state._tag !== "Sending" || context.state.attempt !== event.attempt) return;
          switch (event.outcome._tag) {
            case "Accepted":
              return {
                target: "sent",
                context: { state: { _tag: "Sent", messageId: event.outcome.messageId, sentAt: event.now } },
              };
            case "Rejected":
              return event.outcome.permanent || event.attempt >= event.policy.maxAttempts
                ? {
                    target: "failed",
                    context: { state: failedState("rejected", event.outcome.code, event.now) },
                  }
                : {
                    target: "pending",
                    context: {
                      state: { _tag: "Pending", attempts: event.attempt, lastCode: event.outcome.code },
                    },
                  };
            case "Unknown":
              return {
                target: "failed",
                context: { state: failedState("unknown", event.outcome.code, event.now) },
              };
          }
        },
        Abandon: ({ event }) => ({
          target: "failed",
          context: { state: failedState("unknown", null, event.now) },
        }),
      },
    },
    sent: {
      on: {
        Delivery: ({ event }) => {
          if (event.kind === "delivered" || event.kind === "deferred") return;
          return {
            target: "failed",
            context: {
              state: failedState(
                event.kind === "bounced"
                  ? "bounced"
                  : event.kind === "complained"
                    ? "complained"
                    : "rejected",
                event.code,
                event.now,
              ),
            },
          };
        },
      },
    },
    failed: {
      on: {
        Requeue: { target: "pending", context: { state: pending } },
      },
    },
  },
});

const snapshotFor = (state: SendState) =>
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

const step = (state: SendState, event: Parameters<typeof transition<typeof sendMachine>>[2]) => {
  const snapshot = snapshotFor(state);
  const [next, effects] = transition(sendMachine, snapshot, event);
  return { next, refused: isUnhandled(snapshot, [next, effects]), snapshot };
};

export const requeue = (state: SendState): Option.Option<SendState> => {
  const { next, refused } = step(state, { type: "Requeue" });
  return refused ? Option.none() : Option.some(next.context.state);
};

export const claim = (state: SendState, now: number, policy: SendPolicy): ClaimDecision => {
  const { next } = step(state, { type: "Claim", now, policy });
  const settled = next.context.state;
  switch (settled._tag) {
    case "Sending":
      return state._tag === "Pending"
        ? { _tag: "Send", state: settled }
        : { _tag: "Wait", until: settled.leaseExpiresAt };
    case "Failed":
      return { _tag: "Finished", state: settled, changed: state._tag !== "Failed" };
    case "Sent":
      return { _tag: "Finished", state: settled, changed: false };
    case "Pending":
      throw new Error("Send.claim leaves no state Pending");
  }
};

export const settle = (
  state: SendState,
  attempt: number,
  outcome: SendOutcome,
  now: number,
  policy: SendPolicy,
): Option.Option<SendState> => {
  const { next, refused } = step(state, { type: "Settle", attempt, outcome, now, policy });
  return refused ? Option.none() : Option.some(next.context.state);
};

export const abandon = (state: SendState, now: number): Option.Option<SendState> => {
  const { next, refused } = step(state, { type: "Abandon", now });
  return refused ? Option.none() : Option.some(next.context.state);
};

export const recordDeliveryEvent = (
  state: SendState,
  kind: DeliveryEventKind,
  code: string | null,
  now: number,
): Option.Option<SendState> => {
  const { next, refused } = step(state, { type: "Delivery", kind, code, now });
  return refused ? Option.none() : Option.some(next.context.state);
};

export const retryDelaySeconds = (attempt: number): number =>
  Math.min(30 * 2 ** Math.max(0, attempt - 1), 600);
