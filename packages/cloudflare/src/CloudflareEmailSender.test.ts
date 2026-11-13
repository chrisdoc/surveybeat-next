import { describe, expect, it } from "@effect/vitest";
import { EmailAddress, EmailOutcomeUnknown, EmailRejected } from "@surveybeat/domain";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import { classifySendError, cloudflareEmailSender } from "./CloudflareEmailSender.ts";
import { SendEmail } from "./Email.ts";

const thrown = (code: string) => Object.assign(new Error("send failed"), { code });

describe("classifySendError", () => {
  it.each(["E_RATE_LIMIT_EXCEEDED", "E_DAILY_LIMIT_EXCEEDED", "E_DELIVERY_FAILED"])("retries %s", (code) => {
    expect(classifySendError(thrown(code))).toEqual(new EmailRejected({ code, permanent: false }));
  });

  it.each(["E_RECIPIENT_SUPPRESSED", "E_SENDER_NOT_VERIFIED", "E_HEADER_NOT_ALLOWED"])(
    "fails %s at once",
    (code) => {
      expect(classifySendError(thrown(code))).toEqual(new EmailRejected({ code, permanent: true }));
    },
  );

  it("finds the code on a wrapped cause", () => {
    expect(classifySendError({ cause: thrown("E_RATE_LIMIT_EXCEEDED") })).toEqual(
      new EmailRejected({ code: "E_RATE_LIMIT_EXCEEDED", permanent: false }),
    );
  });

  it("treats an error without a code as an unknown outcome", () => {
    expect(classifySendError(new TypeError("Network connection lost"))).toEqual(
      new EmailOutcomeUnknown({ code: "E_UNCLASSIFIED" }),
    );
    expect(classifySendError(undefined)).toEqual(new EmailOutcomeUnknown({ code: "E_UNCLASSIFIED" }));
  });

  it("treats an internal provider error as an unknown outcome", () => {
    expect(classifySendError(thrown("E_INTERNAL_SERVER_ERROR"))).toEqual(
      new EmailOutcomeUnknown({ code: "E_INTERNAL_SERVER_ERROR" }),
    );
  });
});

// Issue 147: production's `send_email` binding shared the name `Email` with the Email queue's producer
// binding, so the deployed Main Worker kept only the queue. `env.Email.send(message)` then queued the
// rendered email instead of sending it, resolved to undefined, and every send failed as `unknown`.
describe("the send_email binding", () => {
  // Every other binding the deployed production Main Worker has (read back on 2026-11-10).
  const otherBindings = [
    "ASSETS",
    "Database",
    "Email",
    "EmailDlq",
    "EmailEvents",
    "Jobs",
    "JobsDlq",
    "Organization",
  ];

  it.effect("has a name no other Main Worker binding uses", () =>
    Effect.gen(function* () {
      const binding = yield* SendEmail;
      expect(otherBindings).not.toContain(binding.name);
    }),
  );
});

describe("cloudflareEmailSender", () => {
  const message = { to: EmailAddress.make("lead@example.com"), subject: "Hi", html: "<p>Hi</p>", text: "Hi" };
  const senderWith = (result: unknown) =>
    cloudflareEmailSender({
      raw: Effect.die("unused"),
      send: () => Effect.succeed(result as never),
      sendRaw: () => Effect.die("unused"),
    }).pipe(Effect.provideService(RuntimeContext, {} as never));

  it.effect("returns the provider's message id", () =>
    Effect.gen(function* () {
      const sender = yield* senderWith({ messageId: "m-1" });
      expect(yield* sender.send(message)).toEqual({ messageId: "m-1" });
    }),
  );

  it.effect("treats a send that returns no message id as an unknown outcome, not a crash", () =>
    Effect.gen(function* () {
      const sender = yield* senderWith(undefined);
      expect(yield* Effect.flip(sender.send(message))).toEqual(
        new EmailOutcomeUnknown({ code: "E_NO_MESSAGE_ID" }),
      );
    }),
  );
});
