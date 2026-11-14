import { Option, Schema } from "effect";

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

export const requeue = (state: SendState): Option.Option<SendState> =>
  state._tag === "Failed" ? Option.some(pending) : Option.none();

export type ClaimDecision =
  | { readonly _tag: "Send"; readonly state: Sending }
  | { readonly _tag: "Wait"; readonly until: number }
  | { readonly _tag: "Finished"; readonly state: Sent | Failed; readonly changed: boolean };

export const claim = (state: SendState, now: number, policy: SendPolicy): ClaimDecision => {
  switch (state._tag) {
    case "Pending":
      return {
        _tag: "Send",
        state: { _tag: "Sending", attempt: state.attempts + 1, leaseExpiresAt: now + policy.leaseMillis },
      };
    case "Sending":
      return now < state.leaseExpiresAt
        ? { _tag: "Wait", until: state.leaseExpiresAt }
        : { _tag: "Finished", state: failed("unknown", null, now), changed: true };
    case "Sent":
    case "Failed":
      return { _tag: "Finished", state, changed: false };
  }
};

export type SendOutcome =
  | { readonly _tag: "Accepted"; readonly messageId: string }
  | { readonly _tag: "Rejected"; readonly code: string; readonly permanent: boolean }
  | { readonly _tag: "Unknown"; readonly code: string };

export const settle = (
  state: SendState,
  attempt: number,
  outcome: SendOutcome,
  now: number,
  policy: SendPolicy,
): Option.Option<SendState> => {
  if (state._tag !== "Sending" || state.attempt !== attempt) return Option.none();
  switch (outcome._tag) {
    case "Accepted":
      return Option.some({ _tag: "Sent", messageId: outcome.messageId, sentAt: now });
    case "Rejected":
      return Option.some(
        outcome.permanent || attempt >= policy.maxAttempts
          ? failed("rejected", outcome.code, now)
          : { _tag: "Pending", attempts: attempt, lastCode: outcome.code },
      );
    case "Unknown":
      return Option.some(failed("unknown", outcome.code, now));
  }
};

export const abandon = (state: SendState, now: number): Option.Option<SendState> => {
  switch (state._tag) {
    case "Pending":
      return Option.some(
        state.lastCode === null ? failed("abandoned", null, now) : failed("rejected", state.lastCode, now),
      );
    case "Sending":
      return Option.some(failed("unknown", null, now));
    case "Sent":
    case "Failed":
      return Option.none();
  }
};

export type DeliveryEventKind = "delivered" | "deferred" | "bounced" | "complained" | "rejected" | "failed";

const failureFor: { readonly [K in DeliveryEventKind]: FailureReason | null } = {
  delivered: null,
  deferred: null,
  bounced: "bounced",
  complained: "complained",

  rejected: "rejected",
  failed: "rejected",
};

export const recordDeliveryEvent = (
  state: SendState,
  kind: DeliveryEventKind,
  code: string | null,
  now: number,
): Option.Option<SendState> => {
  const reason = failureFor[kind];
  return state._tag === "Sent" && reason !== null ? Option.some(failed(reason, code, now)) : Option.none();
};

export const retryDelaySeconds = (attempt: number): number =>
  Math.min(30 * 2 ** Math.max(0, attempt - 1), 600);

const failed = (reason: FailureReason, code: string | null, now: number): Failed => ({
  _tag: "Failed",
  reason,
  code,
  failedAt: now,
});
