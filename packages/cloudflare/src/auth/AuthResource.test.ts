import { describe, expect, it } from "@effect/vitest";
import { CODE_TTL_SECONDS } from "@surveybeat/auth";
import { Policy } from "@surveybeat/domain";
import type { EmailAccepted, OutgoingEmail } from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import { signInCodeDelivery } from "./AuthResource.ts";

const delivery = (sent: OutgoingEmail[]) =>
  signInCodeDelivery((message) => {
    sent.push(message);
    const accepted: EmailAccepted = { messageId: "m-1" };
    return Effect.succeed(accepted);
  });

describe("sign-in code lifetime", () => {
  it("is one number: the sign-in page, the code email and Better Auth agree", () => {
    expect(Policy.signIn.codeMinutes * 60).toBe(CODE_TTL_SECONDS);
  });

  it.effect("names that lifetime in the code email", () =>
    Effect.gen(function* () {
      const sent: OutgoingEmail[] = [];
      yield* delivery(sent).sendSignInCode({ email: "ada@example.com", otp: "123456" });
      expect(sent[0]?.text).toContain(`It expires in ${Policy.signIn.codeMinutes} minutes.`);
      expect(sent[0]?.html).toContain(`It expires in ${Policy.signIn.codeMinutes} minutes.`);
    }),
  );

  it.effect("names the magic link's own lifetime in its email", () =>
    Effect.gen(function* () {
      const sent: OutgoingEmail[] = [];
      yield* delivery(sent).sendMagicLink({ email: "ada@example.com", url: "https://app.example/x" });
      expect(sent[0]?.text).toContain(`expires in ${Policy.signIn.magicLinkMinutes} minutes`);
    }),
  );
});
