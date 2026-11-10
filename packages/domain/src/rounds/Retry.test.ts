import { describe, expect, it } from "@effect/vitest";
import { nextRetryAt, RETRY_WINDOW_MS } from "./Retry.ts";

const MINUTE = 60_000;
const HOUR = 3600_000;
const REQUESTED_AT = 1_731_140_000_000;

describe("nextRetryAt (ADR 0016)", () => {
  it("first failure retries 5 minutes later", () => {
    expect(nextRetryAt(REQUESTED_AT, 1, REQUESTED_AT)).toBe(REQUESTED_AT + 5 * MINUTE);
  });

  it("doubles the wait and caps it at 4 hours", () => {
    const now = REQUESTED_AT;
    expect(nextRetryAt(REQUESTED_AT, 2, now)).toBe(now + 10 * MINUTE);
    expect(nextRetryAt(REQUESTED_AT, 3, now)).toBe(now + 20 * MINUTE);
    expect(nextRetryAt(REQUESTED_AT, 7, now)).toBe(now + 4 * HOUR);
    expect(nextRetryAt(REQUESTED_AT, 20, now)).toBe(now + 4 * HOUR);
  });

  it("gives up once the next attempt would fall after 24 hours", () => {
    expect(nextRetryAt(REQUESTED_AT, 1, REQUESTED_AT + RETRY_WINDOW_MS - 5 * MINUTE)).toBe(
      REQUESTED_AT + RETRY_WINDOW_MS,
    );
    expect(nextRetryAt(REQUESTED_AT, 1, REQUESTED_AT + RETRY_WINDOW_MS - 4 * MINUTE)).toBeNull();
  });
});
