import { Schema } from "effect";
import { EmailAddress, SendId } from "./Email.ts";
import { FailureReason } from "./SendState.ts";
import type { SendState } from "./SendState.ts";

export const FailedEmailKind = Schema.Literals([
  "AddedToTeam",
  "InvitationEmail",
  "TestInvitationEmail",
  "ReminderEmail",
  "ResultsReadyEmail",
]);
export type FailedEmailKind = typeof FailedEmailKind.Type;

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

export const FailedEmails = Schema.Struct({ emails: Schema.Array(FailedEmail) });
export type FailedEmails = typeof FailedEmails.Type;

export const EmailSendProgress = Schema.TaggedUnion({
  Queued: { attempts: Schema.Int, lastCode: Schema.NullOr(Schema.String) },

  Sending: { attempt: Schema.Int },
  Sent: { sentAt: Schema.Int },
  Failed: { reason: FailureReason, code: Schema.NullOr(Schema.String), failedAt: Schema.Int },
});
export type EmailSendProgress = typeof EmailSendProgress.Type;

export const FailedEmailStatus = Schema.Struct({ sendId: SendId, state: EmailSendProgress });
export type FailedEmailStatus = typeof FailedEmailStatus.Type;

export const progressOf = (state: SendState): EmailSendProgress => {
  switch (state._tag) {
    case "Pending": {
      return { _tag: "Queued", attempts: state.attempts, lastCode: state.lastCode };
    }
    case "Sending": {
      return { _tag: "Sending", attempt: state.attempt };
    }
    case "Sent": {
      return { _tag: "Sent", sentAt: state.sentAt };
    }
    case "Failed": {
      return { _tag: "Failed", reason: state.reason, code: state.code, failedAt: state.failedAt };
    }
  }
};

export class FailedEmailNotFound extends Schema.TaggedError<
  FailedEmailNotFound,
  { readonly brand: unique symbol }
>()("FailedEmailNotFound", {}, { httpApiStatus: 404 }) {}

export class EmailNotResendable extends Schema.TaggedError<
  EmailNotResendable,
  { readonly brand: unique symbol }
>()("EmailNotResendable", {}, { httpApiStatus: 409 }) {}

export interface InvitationFacts {
  readonly roundId: string;
  readonly personId: string;

  readonly status: string;
  readonly resendCount: number;

  readonly sendId: string;
}

export interface ResendFacts {
  readonly kind: string | null;
  readonly reason: FailureReason;

  readonly generation: number | null;

  readonly invitation: InvitationFacts | null;

  readonly testSend: boolean;
}

export const isResendable = (sendId: SendId, facts: ResendFacts): boolean => {
  if (facts.reason === "complained") {
    return false;
  }
  switch (facts.kind) {
    case "AddedToTeam":
    case "ResultsReadyEmail": {
      return true;
    }
    case "InvitationEmail": {
      return currentInvitation(facts) && facts.invitation?.sendId === sendId;
    }
    case "ReminderEmail": {
      return currentInvitation(facts);
    }
    case "TestInvitationEmail": {
      return facts.testSend;
    }
    default: {
      return false;
    }
  }
};

const currentInvitation = (facts: ResendFacts): boolean =>
  facts.invitation !== null &&
  facts.invitation.status !== "revoked" &&
  facts.generation !== null &&
  facts.invitation.resendCount === facts.generation;
