import { Option, Schema } from "effect";

/**
 * Why a send failed. `unknown`: the outcome was never learned (an expired lease or an ambiguous
 * provider error), so it may have been sent. `rejected`: the provider refused it. `abandoned`: the
 * queue gave up before any attempt was made. `bounced` and `complained` arrive after acceptance.
 */
export const FailureReason = Schema.Literals(["unknown", "rejected", "abandoned", "bounced", "complained"]);
export type FailureReason = typeof FailureReason.Type;

/** Waiting to be sent. `attempts` counts earlier attempts, each clearly rejected with `lastCode`. */
export const Pending = Schema.TaggedStruct("Pending", {
  attempts: Schema.Int,
  lastCode: Schema.NullOr(Schema.String),
});
export type Pending = typeof Pending.Type;

/** One delivery holds the lease until `leaseExpiresAt` (epoch ms) while it talks to the provider. */
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

/**
 * `pending → sending → sent | failed(reason)` (ADR 0006). The send is never repeated once a
 * delivery has claimed it and might have reached the provider: only a clear rejection returns it
 * to `pending`. A Lead's Resend creates a new send.
 */
export const SendState = Schema.Union([Pending, Sending, Sent, Failed]);
export type SendState = typeof SendState.Type;

export interface SendPolicy {
  /** How long one delivery may hold a send. Longer than the provider call's timeout. */
  readonly leaseMillis: number;
  /** Clear rejections are retried until this many attempts were made. */
  readonly maxAttempts: number;
}

export const defaultSendPolicy: SendPolicy = { leaseMillis: 2 * 60_000, maxAttempts: 4 };

export const pending: SendState = { _tag: "Pending", attempts: 0, lastCode: null };

/**
 * An admin's explicit Resend of a failed send (ADR 0006): the send is pending again, with no attempts, and
 * is delivered under the same id and content. Never automatic. Any other state is left alone.
 */
export const requeue = (state: SendState): Option.Option<SendState> =>
  state._tag === "Failed" ? Option.some(pending) : Option.none();

/** What a delivery that found the send in `state` must do. */
export type ClaimDecision =
  /** Persist `state` (the lease), then send. */
  | { readonly _tag: "Send"; readonly state: Sending }
  /** Another delivery holds the lease. Look again once it has expired. */
  | { readonly _tag: "Wait"; readonly until: number }
  /** Nothing to send. `changed` when `state` must be persisted (an expired lease became `failed: unknown`). */
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

/** What the provider said about one attempt. */
export type SendOutcome =
  | { readonly _tag: "Accepted"; readonly messageId: string }
  | { readonly _tag: "Rejected"; readonly code: string; readonly permanent: boolean }
  | { readonly _tag: "Unknown"; readonly code: string };

/**
 * Records the outcome of `attempt`. None when the attempt no longer holds the send (its lease
 * expired and the send was settled without it), so a late answer changes nothing.
 */
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

/**
 * The queue gave up on the send (its message was dead-lettered). A send that was never claimed,
 * or only clearly rejected, is known not to have been sent; one still `sending` may have been.
 */
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

/** What the provider reported after accepting a message, normalized from its event feed. */
export type DeliveryEventKind = "delivered" | "deferred" | "bounced" | "complained" | "rejected" | "failed";

const failureFor: { readonly [K in DeliveryEventKind]: FailureReason | null } = {
  delivered: null,
  deferred: null,
  bounced: "bounced",
  complained: "complained",
  // The provider accepted the message, then refused it (a policy check) or could not hand it on.
  rejected: "rejected",
  failed: "rejected",
};

/** A bounce, complaint, or later refusal fails a sent message. Other events leave the state alone. */
export const recordDeliveryEvent = (
  state: SendState,
  kind: DeliveryEventKind,
  code: string | null,
  now: number,
): Option.Option<SendState> => {
  const reason = failureFor[kind];
  return state._tag === "Sent" && reason !== null ? Option.some(failed(reason, code, now)) : Option.none();
};

/** The queue delay before retrying after `attempt` was clearly rejected: 30 s, doubling, at most 10 min. */
export const retryDelaySeconds = (attempt: number): number =>
  Math.min(30 * 2 ** Math.max(0, attempt - 1), 600);

const failed = (reason: FailureReason, code: string | null, now: number): Failed => ({
  _tag: "Failed",
  reason,
  code,
  failedAt: now,
});
