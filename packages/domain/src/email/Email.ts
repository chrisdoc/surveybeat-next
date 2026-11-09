import { Schema } from "effect";

/** A recipient or sender address. Only its shape is checked; the provider is the judge of deliverability. */
export const EmailAddress = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/)),
  Schema.brand("EmailAddress"),
);
export type EmailAddress = typeof EmailAddress.Type;

/** Identifies one transactional send, unique within its Organization. Retries reuse it. */
export const SendId = Schema.NonEmptyString.pipe(Schema.brand("SendId"));
export type SendId = typeof SendId.Type;

/** "You've been added to <Team> by <Lead>." Sent when a Lead adds a Person to a Team. */
export const AddedToTeam = Schema.TaggedStruct("AddedToTeam", {
  teamName: Schema.NonEmptyString,
  leadName: Schema.NonEmptyString,
  signInUrl: Schema.String.pipe(Schema.check(Schema.isStartingWith("https://"))),
});
export type AddedToTeam = typeof AddedToTeam.Type;

/** A rating question prompt and range labels for one-tap email rating links. */
export const EmailRatingQuestion = Schema.Struct({
  text: Schema.String,
  lowLabel: Schema.String,
  highLabel: Schema.String,
});
export type EmailRatingQuestion = typeof EmailRatingQuestion.Type;

/** One Invitation email with one-tap rating links (ADR 0005, 0007). */
export const InvitationEmail = Schema.TaggedStruct("InvitationEmail", {
  pulseName: Schema.NonEmptyString,
  anonymityStatement: Schema.NonEmptyString,
  token: Schema.NonEmptyString,
  baseUrl: Schema.String.pipe(Schema.check(Schema.isStartingWith("https://"))),
  ratingQuestion: Schema.NullOr(EmailRatingQuestion),
  actions: Schema.Array(Schema.String),
});
export type InvitationEmail = typeof InvitationEmail.Type;

/** A reminder email for an open round with one-click unsubscribe headers (RFC 8058). */
export const ReminderEmail = Schema.TaggedStruct("ReminderEmail", {
  pulseName: Schema.NonEmptyString,
  token: Schema.NonEmptyString,
  baseUrl: Schema.String.pipe(Schema.check(Schema.isStartingWith("https://"))),
  ratingQuestion: Schema.NullOr(EmailRatingQuestion),
  actions: Schema.Array(Schema.String),
  unsubscribeUrl: Schema.String.pipe(Schema.check(Schema.isStartingWith("https://"))),
});
export type ReminderEmail = typeof ReminderEmail.Type;

/** A results-ready notice email sent when a Round closes and results are shared. */
export const ResultsReadyEmail = Schema.TaggedStruct("ResultsReadyEmail", {
  pulseName: Schema.NonEmptyString,
  teamName: Schema.NonEmptyString,
  resultsUrl: Schema.String.pipe(Schema.check(Schema.isStartingWith("https://"))),
  responseRatePercent: Schema.Int,
});
export type ResultsReadyEmail = typeof ResultsReadyEmail.Type;

/**
 * What to say, without how it looks. A send stores this and the Queue consumer renders it,
 * so a template fix reaches mail that is still waiting to be sent.
 */
export const TransactionalEmail = Schema.Union([
  AddedToTeam,
  InvitationEmail,
  ReminderEmail,
  ResultsReadyEmail,
]);
export type TransactionalEmail = typeof TransactionalEmail.Type;

/** A rendered message: the HTML part and the plain-text part always travel together. */
export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

/** What an `EmailSender` delivers. The sender address is the adapter's configuration. */
export interface OutgoingEmail extends RenderedEmail {
  readonly to: EmailAddress;
}
