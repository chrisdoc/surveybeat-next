import type { Locale } from "@surveybeat/domain";
import { afterEach, describe, expect, it } from "vitest";
import answerHtml from "../../answer.html?raw";
import indexHtml from "../../index.html?raw";
import { catalog } from "./catalog.ts";
import { de } from "./de.ts";
import { formatDate, type Mismatched, message, pluralMessage } from "./index.ts";
import { message as activeMessage, messagesFor, setLocale } from "./locale.ts";

describe("message catalog", () => {
  it("fills {placeholder} templates", () => {
    expect(message("answer.closes", { date: "Nov 7, 2026" })).toBe("Closes on Nov 7, 2026");
  });

  it("picks plural forms with Intl.PluralRules", () => {
    expect(pluralMessage("answer.remaining", 1)).toBe("1 Question left");
    expect(pluralMessage("answer.remaining", 3)).toBe("3 Questions left");
  });

  it("formats dates with Intl", () => {
    expect(formatDate(new Date("2026-11-07T12:00:00Z"), { dateStyle: "medium", timeZone: "UTC" })).toBe(
      "Nov 7, 2026",
    );
  });
});

const tables: Record<Locale, Readonly<Record<string, string>>> = { en: catalog, de };
const placeholderNames = (template: string): string[] =>
  Array.from(template.matchAll(/\{(\w+)\}/g), (m) => m[1] ?? "").sort();
const pluralBases = Object.keys(catalog)
  .filter((key) => key.endsWith(".other"))
  .map((key) => key.slice(0, -".other".length));

describe("German catalog", () => {
  it("has exactly the English keys, in the same order", () => {
    expect(Object.keys(de)).toEqual(Object.keys(catalog));
  });

  it("uses the same {placeholder} names as English for every key", () => {
    for (const key of Object.keys(catalog) as (keyof typeof catalog)[]) {
      expect(placeholderNames(de[key]), key).toEqual(placeholderNames(catalog[key]));
    }
  });

  it("has every plural category the locale's Intl.PluralRules returns, for each plural base", () => {
    for (const locale of ["en", "de"] as const) {
      const { pluralCategories } = new Intl.PluralRules(locale).resolvedOptions();
      for (const base of pluralBases) {
        for (const category of pluralCategories) {
          expect(tables[locale], `${locale} ${base}.${category}`).toHaveProperty(`${base}.${category}`);
        }
      }
    }
  });
});

describe("messagesFor", () => {
  it("formats German plurals, numbers and dates", () => {
    const de = messagesFor("de");
    expect(de.locale).toBe("de");
    expect(de.pluralMessage("answer.remaining", 1)).toBe("Noch 1 Frage");
    expect(de.pluralMessage("answer.remaining", 3)).toBe("Noch 3 Fragen");
    expect(de.pluralMessage("pulse.questionCount", 1234)).toBe("1.234 Fragen");
    expect(de.formatDate(new Date("2026-11-07T12:00:00Z"), { dateStyle: "medium", timeZone: "UTC" })).toBe(
      "07.11.2026",
    );
  });

  it("fills German templates", () => {
    expect(messagesFor("de").message("answer.closes", { date: "07.11.2026" })).toBe("Schließt am 07.11.2026");
  });

  it("returns the same Messages for the same locale", () => {
    expect(messagesFor("de")).toBe(messagesFor("de"));
    expect(messagesFor("en")).not.toBe(messagesFor("de"));
  });
});

describe("active locale", () => {
  afterEach(() => {
    setLocale("en");
  });

  it("switches message() with setLocale and back", () => {
    expect(activeMessage("app.retry")).toBe("Try again");
    setLocale("de");
    expect(activeMessage("app.retry")).toBe("Erneut versuchen");
    setLocale("en");
    expect(activeMessage("app.retry")).toBe("Try again");
  });
});

// Proves that Mismatched reports a German string whose placeholder differs from English.
type MisspelledDe = Omit<typeof de, "answer.closes"> & {
  readonly "answer.closes": "Schließt am {datum}";
};
describe("placeholder type check", () => {
  it("is never for the shipped German catalog", () => {
    const shipped: [Mismatched<typeof de>] extends [never] ? true : Mismatched<typeof de> = true;
    expect(shipped).toBe(true);
  });

  it("names the key whose placeholder differs", () => {
    // @ts-expect-error "answer.closes" uses {datum} where English has {date}
    const flagged: [Mismatched<MisspelledDe>] extends [never] ? true : Mismatched<MisspelledDe> = true;
    expect(flagged).toBe(true);
  });
});

// Text in TSX and TS sources is checked by the `surveybeat/no-literal-ui-text` lint rule.
// The HTML shells are checked here: they may hold no visible text at all.
describe("HTML entries", () => {
  const visibleText = (html: string) =>
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|title)\b[\s\S]*?<\/\1>/g, "")
      .replace(/<[^>]*>/g, "")
      .trim();

  it.each([
    ["index.html", indexHtml],
    ["answer.html", answerHtml],
  ])("%s has no user-facing text outside the catalog", (_name, html) => {
    expect(visibleText(html)).toBe("");
  });

  it.each([
    ["index.html", indexHtml],
    ["answer.html", answerHtml],
  ])("%s leaves the title to the catalog", (_name, html) => {
    expect(/<title>\s*<\/title>/.test(html)).toBe(true);
  });
});
