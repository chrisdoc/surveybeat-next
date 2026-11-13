import type * as Cloudflare from "@alchemy.run/cloudflare";
import { EmailOutcomeUnknown, EmailRejected, EmailSender } from "@surveybeat/domain";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FROM } from "./Email.ts";

/** Refusals that another attempt cannot fix. */
const PERMANENT = new Set([
  "E_RECIPIENT_SUPPRESSED",
  "E_SENDER_NOT_VERIFIED",
  "E_SENDER_DOMAIN_NOT_AVAILABLE",
  "E_ACCOUNT_SUSPENDED",
  "E_VALIDATION_ERROR",
  "E_FIELD_MISSING",
  "E_TOO_MANY_RECIPIENTS",
  "E_CONTENT_TOO_LARGE",
]);

/** Codes that do not say whether the message went out. */
const AMBIGUOUS = new Set(["E_INTERNAL_SERVER_ERROR"]);

const codeOf = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = "code" in error ? error.code : undefined;
  if (typeof code === "string" && code.startsWith("E_")) return code;
  return "cause" in error ? codeOf(error.cause) : undefined;
};

/**
 * Maps what `env.EMAIL.send()` threw. A coded error is a clear rejection (the message was not
 * accepted). Anything else, such as a dropped connection, may have been sent: its outcome is unknown.
 */
export const classifySendError = (error: unknown): EmailRejected | EmailOutcomeUnknown => {
  const code = codeOf(error);
  if (code === undefined) return new EmailOutcomeUnknown({ code: "E_UNCLASSIFIED" });
  if (AMBIGUOUS.has(code)) return new EmailOutcomeUnknown({ code });
  return new EmailRejected({ code, permanent: PERMANENT.has(code) || code.startsWith("E_HEADER_") });
};

const decodeResult = Schema.decodeUnknownOption(Schema.Struct({ messageId: Schema.NonEmptyString }));

/** `EmailSender` on Cloudflare Email Sending, from `notify.surveybeat.app`. Built inside a handler. */
export const cloudflareEmailSender = (client: Cloudflare.Email.SendClient) =>
  Effect.gen(function* () {
    const runtime = yield* Effect.context<RuntimeContext>();
    return EmailSender.of({
      send: (message) =>
        client
          .send({
            from: FROM,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
            ...(message.headers !== undefined ? { headers: { ...message.headers } } : {}),
          })
          .pipe(
            Effect.mapError((error) => classifySendError(error.cause)),
            // A call that resolves without a message id (as a misbound queue does) may have sent nothing.
            Effect.flatMap((result) =>
              Option.match(decodeResult(result), {
                onNone: () => Effect.fail(new EmailOutcomeUnknown({ code: "E_NO_MESSAGE_ID" })),
                onSome: ({ messageId }) => Effect.succeed({ messageId }),
              }),
            ),
            Effect.provideContext(runtime),
          ),
    });
  });
