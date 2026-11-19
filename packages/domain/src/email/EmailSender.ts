import { Context, Data } from "effect";
import type { Effect } from "effect";
import type { OutgoingEmail } from "./Email.ts";

export class EmailRejected extends Data.TaggedError("EmailRejected")<{
  readonly code: string;
  readonly permanent: boolean;
}> {}

export class EmailOutcomeUnknown extends Data.TaggedError("EmailOutcomeUnknown")<{
  readonly code: string;
}> {}

export interface EmailAccepted {
  readonly messageId: string;
}

export class EmailSender extends Context.Service<
  EmailSender,
  {
    readonly send: (
      message: OutgoingEmail,
    ) => Effect.Effect<EmailAccepted, EmailRejected | EmailOutcomeUnknown>;
  }
>()("@surveybeat/domain/EmailSender") {}
