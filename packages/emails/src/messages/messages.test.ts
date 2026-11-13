import { describe, expect, it } from "@effect/vitest";
import { catalog } from "./catalog.ts";
import { de } from "./de.ts";
import { type Mismatched, messagesFor, type MessageKey } from "./index.ts";

const placeholderNames = (template: string): Array<string> =>
  [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();

describe("German catalog", () => {
  it("has the same keys as English, in the same order", () => {
    expect(Object.keys(de)).toEqual(Object.keys(catalog));
  });

  it("uses the same {placeholder} names as English for every key", () => {
    for (const key of Object.keys(catalog) as Array<MessageKey>) {
      expect(placeholderNames(de[key]), key).toEqual(placeholderNames(catalog[key]));
    }
  });

  it("has every plural category of each locale for each plural base", () => {
    const pluralBases = Object.keys(catalog)
      .filter((key) => key.endsWith(".other"))
      .map((key) => key.slice(0, -".other".length));
    for (const locale of ["en", "de"] as const) {
      const { pluralCategories } = new Intl.PluralRules(locale).resolvedOptions();
      const table = locale === "en" ? catalog : de;
      for (const base of pluralBases) {
        for (const category of pluralCategories) {
          expect(Object.keys(table), `${locale} ${base}.${category}`).toContain(`${base}.${category}`);
        }
      }
    }
  });
});

describe("Mismatched", () => {
  it("catches a German string whose placeholder differs from English", () => {
    type BadDe = Omit<typeof de, "invitation.subject"> & { readonly "invitation.subject": "{puls}" };
    // @ts-expect-error -- "{puls}" is not the English placeholder "{pulse}", so the key is reported
    const checked: [Mismatched<BadDe>] extends [never] ? true : false = true;
    expect(checked).toBe(true);
  });
});

describe("messagesFor", () => {
  it("renders the German table for de and the English table for en", () => {
    expect(messagesFor("de").message("invitation.openCheckIn")).toBe(de["invitation.openCheckIn"]);
    expect(messagesFor("en").message("invitation.openCheckIn")).toBe("Open check-in");
  });

  it("fills placeholders in the chosen language", () => {
    expect(messagesFor("de").message("reminder.heading", { pulse: "Wochen-Pulse" })).toBe(
      "Erinnerung: Wochen-Pulse",
    );
  });

  it("reports its locale", () => {
    expect(messagesFor("de").locale).toBe("de");
  });
});
