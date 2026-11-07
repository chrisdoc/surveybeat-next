import { Context, Data, type Effect } from "effect";
import type { OutgoingEmail } from "./Email.ts";

/**
 * The provider clearly refused the message, so it was not sent. `permanent` rejections
 * (a suppressed recipient, an invalid header) fail at once; the others are retried.
 */
export class EmailRejected extends Data.TaggedError("EmailRejected")<{
  readonly code: string;
  readonly permanent: boolean;
}> {}

/** The provider gave no clear answer. The message may or may not have been sent, so it is never resent. */
export class EmailOutcomeUnknown extends Data.TaggedError("EmailOutcomeUnknown")<{
  readonly code: string;
}> {}

/** The provider accepted the message. Delivery is reported later, as a `DeliveryEvent`. */
export interface EmailAccepted {
  readonly messageId: string;
}

/**
 * Hands one message to an email provider. Cloudflare Email Sending in production; a recording
 * adapter everywhere else. Postmark is the documented fallback behind the same interface.
 */
export class EmailSender extends Context.Service<
  EmailSender,
  {
    readonly send: (
      message: OutgoingEmail,
    ) => Effect.Effect<EmailAccepted, EmailRejected | EmailOutcomeUnknown>;
  }
>()("@surveybeat/domain/EmailSender") {}
