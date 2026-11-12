import { Schema } from "effect";
import { EmailAddress, SendId } from "./Email.ts";
import { FailureReason, type SendState } from "./SendState.ts";

/** The kinds of transactional email a send can be, as the admin's failed-emails list names them. */
export const FailedEmailKind = Schema.Literals([
  "AddedToTeam",
  "InvitationEmail",
  "TestInvitationEmail",
  "ReminderEmail",
  "ResultsReadyEmail",
]);
export type FailedEmailKind = typeof FailedEmailKind.Type;

/**
 * One send that failed, as Organization admins see it: what it was, who it was for, why it failed, when, and
 * whether an admin may Resend it now. Never its body or token.
 */
export const FailedEmail = Schema.Struct({
  sendId: SendId,
  kind: FailedEmailKind,
  recipient: EmailAddress,
  reason: FailureReason,
  code: Schema.NullOr(Schema.String),
  failedAt: Schema.Int,
  resendable: Schema.Boolean,
});
export type FailedEmail = typeof FailedEmail.Type;

/** The most recent failed sends of the Organization, newest first. */
export const FailedEmails = Schema.Struct({ emails: Schema.Array(FailedEmail) });
export type FailedEmails = typeof FailedEmails.Type;

/**
 * Where a send stands in the email queue, as an admin sees it (ADR 0006). Carries no messageId, body, token,
 * or recipient. Same shape as a test send's state in the Pulse editor.
 */
export const EmailSendProgress = Schema.TaggedUnion({
  /** Waiting to be sent; `attempts` earlier tries were clearly rejected with `lastCode`. */
  Queued: { attempts: Schema.Int, lastCode: Schema.NullOr(Schema.String) },
  /** A delivery is talking to the provider now. */
  Sending: { attempt: Schema.Int },
  Sent: { sentAt: Schema.Int },
  Failed: { reason: FailureReason, code: Schema.NullOr(Schema.String), failedAt: Schema.Int },
});
export type EmailSendProgress = typeof EmailSendProgress.Type;

/** One send's id and where it stands. */
export const FailedEmailStatus = Schema.Struct({ sendId: SendId, state: EmailSendProgress });
export type FailedEmailStatus = typeof FailedEmailStatus.Type;

/** A send's state as an admin sees it. */
export const progressOf = (state: SendState): EmailSendProgress => {
  switch (state._tag) {
    case "Pending":
      return { _tag: "Queued", attempts: state.attempts, lastCode: state.lastCode };
    case "Sending":
      return { _tag: "Sending", attempt: state.attempt };
    case "Sent":
      return { _tag: "Sent", sentAt: state.sentAt };
    case "Failed":
      return { _tag: "Failed", reason: state.reason, code: state.code, failedAt: state.failedAt };
  }
};

/** No send of this Organization has that id, or it is not a failed send where a failed send is required. */
export class FailedEmailNotFound extends Schema.TaggedError<
  FailedEmailNotFound,
  { readonly brand: unique symbol }
>()("FailedEmailNotFound", {}, { httpApiStatus: 404 }) {}

/** The send failed, but may not be sent again: the Invitation it links to is gone or was re-sent, or it was complained about. */
export class EmailNotResendable extends Schema.TaggedError<
  EmailNotResendable,
  { readonly brand: unique symbol }
>()("EmailNotResendable", {}, { httpApiStatus: 409 }) {}

/** The Invitation row a send's email names (its round and person), as the Durable Object reads it. */
export interface InvitationFacts {
  readonly roundId: string;
  readonly personId: string;
  /** `pending`, `sending`, `sent`, `failed`, or `revoked`. */
  readonly status: string;
  readonly resendCount: number;
  /** The send the Invitation is currently on. */
  readonly sendId: string;
}

/**
 * What decides whether a failed send may be resent (`isResendable`). The Durable Object reads these from its
 * rows and from the stored email's own fields, never the stored content whole: a legacy row may hold a token.
 */
export interface ResendFacts {
  /** The stored email's kind (its `_tag`), or null when the content has none. */
  readonly kind: string | null;
  readonly reason: FailureReason;
  /** The Invitation generation the stored email was made for; null when it names no Invitation (legacy rows). */
  readonly generation: number | null;
  /** The Invitation row the stored email names, or null when there is none. */
  readonly invitation: InvitationFacts | null;
  /** Whether a test send row exists for the send. */
  readonly testSend: boolean;
}

/**
 * Whether an admin may Resend a failed send now. A link is never sent dead, and a revoked Invitation's token is
 * never indexed again. A complained-about send is never resent. Only an admin's explicit Resend resends (ADR 0006).
 */
export const isResendable = (sendId: SendId, facts: ResendFacts): boolean => {
  if (facts.reason === "complained") return false;
  switch (facts.kind) {
    case "AddedToTeam":
    case "ResultsReadyEmail":
      return true;
    case "InvitationEmail":
      return currentInvitation(facts) && facts.invitation?.sendId === sendId;
    case "ReminderEmail":
      return currentInvitation(facts);
    case "TestInvitationEmail":
      return facts.testSend;
    default:
      return false;
  }
};

/** The Invitation the email names still exists, is not revoked, and has not been re-sent since (same generation). */
const currentInvitation = (facts: ResendFacts): boolean =>
  facts.invitation !== null &&
  facts.invitation.status !== "revoked" &&
  facts.generation !== null &&
  facts.invitation.resendCount === facts.generation;
