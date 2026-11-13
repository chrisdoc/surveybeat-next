import { describe, expect, it } from "vitest";
import { scaleText } from "./scale.ts";

describe("Rating scale text on the answer page", () => {
  it("shows the Question's low label at 1 and high label at 5", () => {
    expect(scaleText(1, "Unclear", "Clear")).toBe("1 · Unclear");
    expect(scaleText(5, "Unclear", "Clear")).toBe("5 · Clear");
  });

  it("shows plain numbers for 2, 3 and 4 even when labels are set", () => {
    expect(scaleText(2, "Unclear", "Clear")).toBe("2");
    expect(scaleText(3, "Unclear", "Clear")).toBe("3");
    expect(scaleText(4, "Unclear", "Clear")).toBe("4");
  });

  it("shows a plain number at an end whose label is missing or empty", () => {
    expect(scaleText(1, undefined, "Clear")).toBe("1");
    expect(scaleText(5, "Unclear", undefined)).toBe("5");
    expect(scaleText(1, "", "Clear")).toBe("1");
    expect(scaleText(5, "Unclear", "")).toBe("5");
  });

  it("keeps long German labels whole", () => {
    expect(scaleText(5, "Nicht zu bewältigen", "Sehr gut zu bewältigen")).toBe("5 · Sehr gut zu bewältigen");
  });
});
