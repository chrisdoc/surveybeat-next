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

/**
 * What to say, without how it looks. A send stores this and the Queue consumer renders it,
 * so a template fix reaches mail that is still waiting to be sent.
 */
export const TransactionalEmail = Schema.Union([AddedToTeam]);
export type TransactionalEmail = typeof TransactionalEmail.Type;

/** A rendered message: the HTML part and the plain-text part always travel together. */
export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** What an `EmailSender` delivers. The sender address is the adapter's configuration. */
export interface OutgoingEmail extends RenderedEmail {
  readonly to: EmailAddress;
}
