import { CODE_TTL_SECONDS, MAGIC_LINK_TTL_SECONDS, type CodeDelivery } from "@surveybeat/auth";
import {
  type EmailAccepted,
  EmailAddress,
  type EmailOutcomeUnknown,
  type EmailRejected,
  type OutgoingEmail,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";

const CODE_MINUTES = CODE_TTL_SECONDS / 60;
const LINK_MINUTES = MAGIC_LINK_TTL_SECONDS / 60;

export const signInCodeDelivery = (
  send: (message: OutgoingEmail) => Effect.Effect<EmailAccepted, EmailRejected | EmailOutcomeUnknown>,
): CodeDelivery => ({
  sendSignInCode: ({ email, otp }) =>
    send({
      to: EmailAddress.make(email),
      subject: `Your SurveyBeat sign-in code: ${otp}`,
      text: `Your SurveyBeat sign-in code is ${otp}. It expires in ${CODE_MINUTES} minutes.`,
      html: `<p>Your SurveyBeat sign-in code is <strong>${otp}</strong>. It expires in ${CODE_MINUTES} minutes.</p>`,
    }).pipe(Effect.asVoid, Effect.orDie),
  sendMagicLink: ({ email, url }) =>
    send({
      to: EmailAddress.make(email),
      subject: "Your SurveyBeat sign-in link",
      text: `Open SurveyBeat: ${url}\n\nThe link expires in ${LINK_MINUTES} minutes and works once.`,
      html: `<p><a href="${url}">Sign in to SurveyBeat</a></p><p>The link expires in ${LINK_MINUTES} minutes and works once.</p>`,
    }).pipe(Effect.asVoid, Effect.orDie),
});
