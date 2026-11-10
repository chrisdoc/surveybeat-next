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

const HttpsUrl = Schema.String.pipe(Schema.check(Schema.isStartingWith("https://")));

/**
 * Whether the Organization processes redacted comments with AI (ADR 0015), so the email says so. Optional
 * so that sends stored before the setting existed still decode; absent means off.
 */
const AiProcessing = Schema.optionalKey(Schema.Boolean);

/** "You've been added to <Team> by <Lead>." Sent when a Lead adds a Person to a Team. */
export const AddedToTeam = Schema.TaggedStruct("AddedToTeam", {
  teamName: Schema.NonEmptyString,
  leadName: Schema.NonEmptyString,
  signInUrl: HttpsUrl,
});
export type AddedToTeam = typeof AddedToTeam.Type;

/** A rating question prompt and range labels for one-tap email rating links. */
export const EmailRatingQuestion = Schema.Struct({
  text: Schema.String,
  lowLabel: Schema.String,
  highLabel: Schema.String,
});
export type EmailRatingQuestion = typeof EmailRatingQuestion.Type;

/** The Team's minimum group size N, which the Invitation states to the member (SPEC 5.2, ADR 0004). */
const MinimumGroupSize = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)));

/**
 * Which Invitation an email's links belong to. A stored email holds this instead of the token: the
 * token is derived from it when the email is rendered, so no raw token is ever persisted (issue 42).
 * `generation` is the Invitation's `resend_count`.
 */
export const InvitationRef = Schema.Struct({
  roundId: Schema.NonEmptyString,
  personId: Schema.NonEmptyString,
  generation: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type InvitationRef = typeof InvitationRef.Type;

/** One Invitation email with one-tap rating links (ADR 0005, 0007). As stored: no token. */
export const InvitationEmail = Schema.TaggedStruct("InvitationEmail", {
  pulseName: Schema.NonEmptyString,
  minimumGroupSize: MinimumGroupSize,
  invitation: InvitationRef,
  baseUrl: HttpsUrl,
  ratingQuestion: Schema.NullOr(EmailRatingQuestion),
  actions: Schema.Array(Schema.String),
  aiProcessing: AiProcessing,
});
export type InvitationEmail = typeof InvitationEmail.Type;

/** A reminder email for an open round with one-click unsubscribe headers (RFC 8058). As stored: no token. */
export const ReminderEmail = Schema.TaggedStruct("ReminderEmail", {
  pulseName: Schema.NonEmptyString,
  invitation: InvitationRef,
  baseUrl: HttpsUrl,
  ratingQuestion: Schema.NullOr(EmailRatingQuestion),
  actions: Schema.Array(Schema.String),
  aiProcessing: AiProcessing,
});
export type ReminderEmail = typeof ReminderEmail.Type;

/**
 * An Invitation email with its token, as the template renders it. This is never what a new send
 * stores. It is also the shape of `email_send.content` rows written before tokens were derived,
 * which carry `token` and, instead of `minimumGroupSize`, the statement text `anonymityStatement`
 * (rendered verbatim when `minimumGroupSize` is absent). Drop the legacy fields once those rows are gone.
 */
export const InvitationEmailWithToken = Schema.TaggedStruct("InvitationEmail", {
  pulseName: Schema.NonEmptyString,
  minimumGroupSize: Schema.optionalKey(MinimumGroupSize),
  anonymityStatement: Schema.optionalKey(Schema.NonEmptyString),
  token: Schema.NonEmptyString,
  baseUrl: HttpsUrl,
  ratingQuestion: Schema.NullOr(EmailRatingQuestion),
  actions: Schema.Array(Schema.String),
  aiProcessing: AiProcessing,
});
export type InvitationEmailWithToken = typeof InvitationEmailWithToken.Type;

/**
 * A reminder email with its token, as the template renders it; never stored by a new send. Legacy
 * rows carry `unsubscribeUrl` (built from the old random token); otherwise the template builds it.
 */
export const ReminderEmailWithToken = Schema.TaggedStruct("ReminderEmail", {
  pulseName: Schema.NonEmptyString,
  token: Schema.NonEmptyString,
  baseUrl: HttpsUrl,
  ratingQuestion: Schema.NullOr(EmailRatingQuestion),
  actions: Schema.Array(Schema.String),
  unsubscribeUrl: Schema.optionalKey(HttpsUrl),
  aiProcessing: AiProcessing,
});
export type ReminderEmailWithToken = typeof ReminderEmailWithToken.Type;

/** A results-ready notice email sent when a Round closes and results are shared. */
export const ResultsReadyEmail = Schema.TaggedStruct("ResultsReadyEmail", {
  pulseName: Schema.NonEmptyString,
  teamName: Schema.NonEmptyString,
  resultsUrl: HttpsUrl,
  responseRatePercent: Schema.Int,
});
export type ResultsReadyEmail = typeof ResultsReadyEmail.Type;

/**
 * What to say, without how it looks. A send stores this and the Queue consumer renders it,
 * so a template fix reaches mail that is still waiting to be sent. It holds no token.
 */
export const TransactionalEmail = Schema.Union([
  AddedToTeam,
  InvitationEmail,
  ReminderEmail,
  ResultsReadyEmail,
]);
export type TransactionalEmail = typeof TransactionalEmail.Type;

/** What a send row can hold: `TransactionalEmail`, plus legacy rows that still carry a token (decode only). */
export const StoredEmail = Schema.Union([
  AddedToTeam,
  InvitationEmail,
  ReminderEmail,
  ResultsReadyEmail,
  InvitationEmailWithToken,
  ReminderEmailWithToken,
]);
export type StoredEmail = typeof StoredEmail.Type;

/** What a template renders: every link is complete, so Invitations and reminders carry their token. */
export type RenderableEmail =
  | AddedToTeam
  | InvitationEmailWithToken
  | ReminderEmailWithToken
  | ResultsReadyEmail;

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
