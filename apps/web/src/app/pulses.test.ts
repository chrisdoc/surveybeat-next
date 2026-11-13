import type { FailureReason, TestSendStatus } from "@surveybeat/domain";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../messages/locale.ts";
import {
  failureReasonText,
  testSendKeepsPolling,
  testSendNotice,
  testSendNoticeText,
  TEST_SEND_GIVE_UP_MILLIS,
} from "./pulses.ts";

afterEach(() => {
  setLocale("en");
});

const MINUTE = 60_000;
const queuedAt = 1_800_000_000_000;

/** A test send's status read `waitedMillis` after it was queued. */
const status = (state: TestSendStatus["state"], waitedMillis = 30_000): TestSendStatus => ({
  queuedAt,
  checkedAt: queuedAt + waitedMillis,
  state,
});

const queued = (lastCode: string | null = null, waitedMillis?: number) =>
  status({ _tag: "Queued", attempts: lastCode === null ? 0 : 1, lastCode }, waitedMillis);

describe("testSendNotice", () => {
  it("says a fresh send is queued", () => {
    expect(testSendNotice(queued())).toEqual({ _tag: "Queued" });
  });

  it("says a queued send is retrying after the code of its last rejection", () => {
    expect(testSendNotice(queued("E_RATE_LIMIT"))).toEqual({ _tag: "Retrying", code: "E_RATE_LIMIT" });
  });

  it("says a send queued for five minutes or more is stalled, with the whole minutes waited", () => {
    expect(testSendNotice(queued(null, 5 * MINUTE))).toEqual({ _tag: "Stalled", minutes: 5 });
    expect(testSendNotice(queued(null, 7 * MINUTE + 59_000))).toEqual({ _tag: "Stalled", minutes: 7 });
  });

  it("drops the last rejection code once the send is stalled", () => {
    expect(testSendNotice(queued("E_RATE_LIMIT", 6 * MINUTE))).toEqual({ _tag: "Stalled", minutes: 6 });
  });

  it("does not stall a send queued for just under five minutes", () => {
    expect(testSendNotice(queued(null, 5 * MINUTE - 1))).toEqual({ _tag: "Queued" });
  });

  it("says a send that is being delivered is sending", () => {
    expect(testSendNotice(status({ _tag: "Sending", attempt: 1 }))).toEqual({ _tag: "Sending" });
  });

  it("says a delivered send is sent", () => {
    expect(testSendNotice(status({ _tag: "Sent", sentAt: queuedAt + 1_000 }))).toEqual({ _tag: "Sent" });
  });

  it("carries the reason and code of a failed send", () => {
    expect(
      testSendNotice(
        status({ _tag: "Failed", reason: "rejected", code: "E_SENDER_NOT_VERIFIED", failedAt: queuedAt }),
      ),
    ).toEqual({ _tag: "Failed", reason: "rejected", code: "E_SENDER_NOT_VERIFIED" });
  });

  it("carries a failed send with no code as null", () => {
    expect(
      testSendNotice(status({ _tag: "Failed", reason: "unknown", code: null, failedAt: queuedAt })),
    ).toEqual({
      _tag: "Failed",
      reason: "unknown",
      code: null,
    });
  });
});

describe("testSendNoticeText", () => {
  it("writes each notice in English", () => {
    expect(testSendNoticeText({ _tag: "Queued" })).toBe("Queued…");
    expect(testSendNoticeText({ _tag: "Retrying", code: "E_RATE_LIMIT" })).toBe(
      "Queued, retrying after E_RATE_LIMIT…",
    );
    expect(testSendNoticeText({ _tag: "Sending" })).toBe("Sending…");
    expect(testSendNoticeText({ _tag: "Sent" })).toBe("Sent. Check your inbox (and spam folder).");
    expect(testSendNoticeText({ _tag: "Failed", reason: "rejected", code: "E_SENDER_NOT_VERIFIED" })).toBe(
      "Not sent: the email service refused it (E_SENDER_NOT_VERIFIED)",
    );
  });

  it("uses the plural form of the stalled notice for one minute and for many", () => {
    expect(testSendNoticeText({ _tag: "Stalled", minutes: 1 })).toBe(
      "Still queued after 1 minute. The email service may not be processing sends.",
    );
    expect(testSendNoticeText({ _tag: "Stalled", minutes: 12 })).toBe(
      "Still queued after 12 minutes. The email service may not be processing sends.",
    );
  });

  it("leaves the code out of a failure with no code", () => {
    expect(testSendNoticeText({ _tag: "Failed", reason: "unknown", code: null })).toBe(
      "Not sent: the outcome is unknown",
    );
  });

  it("writes a failure in German with the German reason text", () => {
    setLocale("de");
    expect(testSendNoticeText({ _tag: "Failed", reason: "complained", code: null })).toBe(
      "Nicht gesendet: sie wurde als Spam markiert",
    );
    expect(testSendNoticeText({ _tag: "Stalled", minutes: 3 })).toBe(
      "Nach 3 Minuten noch in der Warteschlange. Der E-Mail-Dienst verarbeitet möglicherweise keine E-Mails.",
    );
  });
});

describe("failureReasonText", () => {
  it.each<[FailureReason, string]>([
    ["unknown", "the outcome is unknown"],
    ["rejected", "the email service refused it"],
    ["abandoned", "the queue gave up"],
    ["bounced", "it bounced"],
    ["complained", "it was marked as spam"],
  ])("names %s", (reason, text) => {
    expect(failureReasonText(reason)).toBe(text);
  });
});

describe("testSendKeepsPolling", () => {
  it("keeps checking a send that is queued or sending", () => {
    expect(testSendKeepsPolling(queued())).toBe(true);
    expect(testSendKeepsPolling(status({ _tag: "Sending", attempt: 1 }))).toBe(true);
  });

  it("stops once the send is sent or failed", () => {
    expect(testSendKeepsPolling(status({ _tag: "Sent", sentAt: queuedAt }))).toBe(false);
    expect(
      testSendKeepsPolling(status({ _tag: "Failed", reason: "bounced", code: null, failedAt: queuedAt })),
    ).toBe(false);
  });

  it("gives up on a send still queued after fifteen minutes, measured on the server clock", () => {
    expect(testSendKeepsPolling(queued(null, TEST_SEND_GIVE_UP_MILLIS - 1))).toBe(true);
    expect(testSendKeepsPolling(queued(null, TEST_SEND_GIVE_UP_MILLIS))).toBe(false);
  });
});
