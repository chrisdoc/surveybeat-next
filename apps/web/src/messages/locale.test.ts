import { afterEach, describe, expect, it } from "vitest";
import {
  formatChange as activeFormatChange,
  formatRoundDate as activeFormatRoundDate,
  messagesFor,
  setLocale,
} from "./locale.ts";

const en = messagesFor("en");

describe("formatScore", () => {
  it("shows one decimal place", () => {
    expect(en.formatScore(4)).toBe("4.0");
    expect(en.formatScore(4.2)).toBe("4.2");
    expect(en.formatScore(3.6)).toBe("3.6");
  });
});

describe("formatChange", () => {
  it("signs every non-zero change and leaves zero unsigned", () => {
    expect(en.formatChange(0.5)).toBe("+0.5");
    expect(en.formatChange(-0.5)).toBe("-0.5");
    expect(en.formatChange(0)).toBe("0.0");
  });
});

describe("formatPercent", () => {
  it("rounds a ratio to a whole percentage", () => {
    expect(en.formatPercent(0.75)).toBe("75%");
    expect(en.formatPercent(0.375)).toBe("38%");
    expect(en.formatPercent(0)).toBe("0%");
  });
});

describe("formatRoundDate", () => {
  it("formats a YYYY-MM-DD Round date as a medium date, the same in every time zone", () => {
    expect(en.formatRoundDate("2026-11-02")).toBe("Nov 2, 2026");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(en.formatRoundDate("not-a-date")).toBe("not-a-date");
    expect(en.formatRoundDate("2026-13-45")).toBe("2026-13-45");
  });
});

describe("active locale helpers", () => {
  afterEach(() => {
    setLocale("en");
  });

  it("follow setLocale", () => {
    expect(activeFormatChange(0.5)).toBe("+0.5");
    expect(activeFormatRoundDate("2026-11-02")).toBe("Nov 2, 2026");
    setLocale("en");
    expect(activeFormatChange(0.5)).toBe("+0.5");
    expect(activeFormatRoundDate("2026-11-02")).toBe("Nov 2, 2026");
  });
});
