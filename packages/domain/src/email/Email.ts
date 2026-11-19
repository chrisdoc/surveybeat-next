import { Effect, Schema } from "effect";
import { DEFAULT_LOCALE, Locale } from "../people/Locale.ts";

export const EmailAddress = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/)),
  Schema.brand("EmailAddress"),
);

export type EmailAddress = typeof EmailAddress.Type;

export const SendId = Schema.NonEmptyString.pipe(Schema.brand("SendId"));

export type SendId = typeof SendId.Type;

const HttpsUrl = Schema.String.pipe(Schema.check(Schema.isStartingWith("https://")));

const AiProcessing = Schema.optionalKey(Schema.Boolean);

const EmailLocale = Locale.pipe(
  Schema.catchDecoding(() => Effect.succeedSome(DEFAULT_LOCALE)),
  Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_LOCALE)),
);

export const AddedToTeam = Schema.TaggedStruct("AddedToTeam", {
  locale: EmailLocale,
  teamName: Schema.NonEmptyString,
  leadName: Schema.NonEmptyString,
  signInUrl: HttpsUrl,
});

export type AddedToTeam = typeof AddedToTeam.Type;

export const EmailRatingQuestion = Schema.Struct({
  text: Schema.String,
  lowLabel: Schema.String,
  highLabel: Schema.String,
});

export type EmailRatingQuestion = typeof EmailRatingQuestion.Type;

const MinimumGroupSize = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)));

export const InvitationRef = Schema.Struct({
  roundId: Schema.NonEmptyString,
  personId: Schema.NonEmptyString,
  generation: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});

export type InvitationRef = typeof InvitationRef.Type;

export const TestInvitationRef = Schema.Struct({
  pulseId: Schema.NonEmptyString,
  personId: Schema.NonEmptyString,
  testId: Schema.NonEmptyString,
});

export type TestInvitationRef = typeof TestInvitationRef.Type;

export const InvitationEmail = Schema.TaggedStruct("InvitationEmail", {
  locale: EmailLocale,
  pulseName: Schema.NonEmptyString,
  minimumGroupSize: MinimumGroupSize,
  invitation: InvitationRef,
  baseUrl: HttpsUrl,
  ratingQuestion: Schema.NullOr(EmailRatingQuestion),
  actions: Schema.Array(Schema.String),
  aiProcessing: AiProcessing,
});

export type InvitationEmail = typeof InvitationEmail.Type;

export const TestInvitationEmail = Schema.TaggedStruct("TestInvitationEmail", {
  locale: EmailLocale,
  pulseName: Schema.NonEmptyString,
  minimumGroupSize: MinimumGroupSize,
  test: TestInvitationRef,
  baseUrl: HttpsUrl,
  ratingQuestion: Schema.NullOr(EmailRatingQuestion),
  actions: Schema.Array(Schema.String),
  aiProcessing: AiProcessing,
});

export type TestInvitationEmail = typeof TestInvitationEmail.Type;

export const ReminderEmail = Schema.TaggedStruct("ReminderEmail", {
  locale: EmailLocale,
  pulseName: Schema.NonEmptyString,
  invitation: InvitationRef,
  baseUrl: HttpsUrl,
  ratingQuestion: Schema.NullOr(EmailRatingQuestion),
  actions: Schema.Array(Schema.String),
  aiProcessing: AiProcessing,
});

export type ReminderEmail = typeof ReminderEmail.Type;

export const InvitationEmailWithToken = Schema.TaggedStruct("InvitationEmail", {
  locale: EmailLocale,
  pulseName: Schema.NonEmptyString,
  minimumGroupSize: Schema.optionalKey(MinimumGroupSize),
  anonymityStatement: Schema.optionalKey(Schema.NonEmptyString),
  token: Schema.NonEmptyString,

  test: Schema.optionalKey(Schema.Literal(true)),
  baseUrl: HttpsUrl,
  ratingQuestion: Schema.NullOr(EmailRatingQuestion),
  actions: Schema.Array(Schema.String),
  aiProcessing: AiProcessing,
});

export type InvitationEmailWithToken = typeof InvitationEmailWithToken.Type;

export const ReminderEmailWithToken = Schema.TaggedStruct("ReminderEmail", {
  locale: EmailLocale,
  pulseName: Schema.NonEmptyString,
  token: Schema.NonEmptyString,
  baseUrl: HttpsUrl,
  ratingQuestion: Schema.NullOr(EmailRatingQuestion),
  actions: Schema.Array(Schema.String),
  unsubscribeUrl: Schema.optionalKey(HttpsUrl),
  aiProcessing: AiProcessing,
});

export type ReminderEmailWithToken = typeof ReminderEmailWithToken.Type;

export const ResultsReadyEmail = Schema.TaggedStruct("ResultsReadyEmail", {
  locale: EmailLocale,
  pulseName: Schema.NonEmptyString,
  teamName: Schema.NonEmptyString,
  resultsUrl: HttpsUrl,
  responseRatePercent: Schema.Int,
});

export type ResultsReadyEmail = typeof ResultsReadyEmail.Type;

export const TransactionalEmail = Schema.Union([
  AddedToTeam,
  InvitationEmail,
  TestInvitationEmail,
  ReminderEmail,
  ResultsReadyEmail,
]);

export type TransactionalEmail = typeof TransactionalEmail.Type;

export const StoredEmail = Schema.Union([
  AddedToTeam,
  InvitationEmail,
  TestInvitationEmail,
  ReminderEmail,
  ResultsReadyEmail,
  InvitationEmailWithToken,
  ReminderEmailWithToken,
]);

export type StoredEmail = typeof StoredEmail.Type;

export type RenderableEmail =
  | AddedToTeam
  | InvitationEmailWithToken
  | ReminderEmailWithToken
  | ResultsReadyEmail;

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

export interface OutgoingEmail extends RenderedEmail {
  readonly to: EmailAddress;
}
