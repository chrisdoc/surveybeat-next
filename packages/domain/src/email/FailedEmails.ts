import { Schema } from "effect";
import { EmailAddress, SendId } from "./Email.ts";
import { FailureReason } from "./SendState.ts";

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
 * One send that failed, as Organization admins see it: what it was, who it was for, why it failed, and
 * when. Never its body or token.
 */
export const FailedEmail = Schema.Struct({
  sendId: SendId,
  kind: FailedEmailKind,
  recipient: EmailAddress,
  reason: FailureReason,
  code: Schema.NullOr(Schema.String),
  failedAt: Schema.Int,
});
export type FailedEmail = typeof FailedEmail.Type;

/** The most recent failed sends of the Organization, newest first. */
export const FailedEmails = Schema.Struct({ emails: Schema.Array(FailedEmail) });
export type FailedEmails = typeof FailedEmails.Type;
