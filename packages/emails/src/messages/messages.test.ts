import { describe, expect, it } from "@effect/vitest";
import { catalog } from "./catalog.ts";
import { type Mismatched, messagesFor } from "./index.ts";

describe("English catalog", () => {
  it("has every plural category of English for each plural base", () => {
    const pluralBases = Object.keys(catalog)
      .filter((key) => key.endsWith(".other"))
      .map((key) => key.slice(0, -".other".length));
    const { pluralCategories } = new Intl.PluralRules("en").resolvedOptions();
    for (const base of pluralBases) {
      for (const category of pluralCategories) {
        expect(Object.keys(catalog), `en ${base}.${category}`).toContain(`${base}.${category}`);
      }
    }
  });
});

const literalNumberWithUnit =
  /\b\d[\d,]*\s*-?(?:digit|minutes?|hours?|days?|seconds?|characters?|persons?|people|questions?|themes?|rounds?|tests?)\b/i;

describe("policy numbers in English copy", () => {
  it("states no literal number with a unit", () => {
    const offenders = Object.entries(catalog)
      .filter(([, text]) => literalNumberWithUnit.test(text))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});

describe("Mismatched", () => {
  it("catches a translation whose placeholder differs from English", () => {
    type BadTranslation = Omit<typeof catalog, "reminder.heading"> & {
      readonly "reminder.heading": "{puls}";
    };
    // @ts-expect-error -- "{puls}" is not the English placeholder "{pulse}", so the key is reported
    const checked: [Mismatched<BadTranslation>] extends [never] ? true : false = true;
    expect(checked).toBe(true);
  });
});

describe("messagesFor", () => {
  it("renders the English table", () => {
    expect(messagesFor("en").message("invitation.openCheckIn")).toBe("Open check-in");
  });

  it("fills placeholders", () => {
    expect(messagesFor("en").message("reminder.heading", { pulse: "Weekly" })).toBe("Reminder: Weekly");
  });

  it("reports its locale", () => {
    expect(messagesFor("en").locale).toBe("en");
  });
});
