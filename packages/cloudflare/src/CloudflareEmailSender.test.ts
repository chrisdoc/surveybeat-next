import { describe, expect, it } from "@effect/vitest";
import { EmailOutcomeUnknown, EmailRejected } from "@surveybeat/domain";
import { classifySendError } from "./CloudflareEmailSender.ts";

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
