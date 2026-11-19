import type { CodeDelivery } from "@surveybeat/auth";
import { EmailAddress, Policy } from "@surveybeat/domain";
import type { EmailAccepted, EmailOutcomeUnknown, EmailRejected, OutgoingEmail } from "@surveybeat/domain";
import * as Effect from "effect/Effect";

const CODE_MINUTES = Policy.signIn.codeMinutes;

const LINK_MINUTES = Policy.signIn.magicLinkMinutes;

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
