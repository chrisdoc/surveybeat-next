import { describe, expect, it } from "vitest";
import { warningMessage } from "./pulses.ts";

describe("warningMessage for a Team below the minimum group size", () => {
  it.each([
    [
      1,
      "This Team has 1 person, fewer than the 4 needed before any Result is shown. You can still set up the Pulse.",
    ],
    [
      3,
      "This Team has 3 people, fewer than the 4 needed before any Result is shown. You can still set up the Pulse.",
    ],
  ])("counts %i correctly", (members, text) => {
    expect(warningMessage({ _tag: "TeamBelowMinimumGroupSize", members, minimumGroupSize: 4 })).toBe(text);
  });
});
