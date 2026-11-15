import type { CodeDelivery } from "@surveybeat/auth";
import {
  type EmailAccepted,
  EmailAddress,
  type EmailOutcomeUnknown,
  type EmailRejected,
  type OutgoingEmail,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";

export const signInCodeDelivery = (
  send: (message: OutgoingEmail) => Effect.Effect<EmailAccepted, EmailRejected | EmailOutcomeUnknown>,
): CodeDelivery => ({
  sendSignInCode: ({ email, otp }) =>
    send({
      to: EmailAddress.make(email),
      subject: `Your SurveyBeat sign-in code: ${otp}`,
      text: `Your SurveyBeat sign-in code is ${otp}. It expires in 10 minutes.`,
      html: `<p>Your SurveyBeat sign-in code is <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
    }).pipe(Effect.asVoid, Effect.orDie),
  sendMagicLink: ({ email, url }) =>
    send({
      to: EmailAddress.make(email),
      subject: "Your SurveyBeat sign-in link",
      text: `Open SurveyBeat: ${url}\n\nThe link expires in 5 minutes and works once.`,
      html: `<p><a href="${url}">Sign in to SurveyBeat</a></p><p>The link expires in 5 minutes and works once.</p>`,
    }).pipe(Effect.asVoid, Effect.orDie),
});
