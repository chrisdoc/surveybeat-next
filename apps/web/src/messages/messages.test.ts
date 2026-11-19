import * as DateTime from "effect/DateTime";
import { afterEach, describe, expect, it } from "vitest";
import answerHtml from "../../answer.html?raw";
import indexHtml from "../../index.html?raw";
import siteHtml from "../../site.html?raw";
import { catalog } from "./catalog.ts";
import { formatDate, message, pluralMessage } from "./index.ts";
import type { Mismatched } from "./index.ts";
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
    expect(
      formatDate(DateTime.makeUnsafe("2026-11-07T12:00:00Z"), { dateStyle: "medium", timeZone: "UTC" }),
    ).toBe("Nov 7, 2026");
  });
});

const placeholderNames = (template: string): string[] =>
  Array.from(template.matchAll(/\{(\w+)\}/g), (m) => m[1] ?? "").sort();
const pluralBases = Object.keys(catalog)
  .filter((key) => key.endsWith(".other"))
  .map((key) => key.slice(0, -".other".length));

describe("English catalog", () => {
  it("has a plural form for every category Intl.PluralRules returns, for each plural base", () => {
    const { pluralCategories } = new Intl.PluralRules("en").resolvedOptions();
    for (const base of pluralBases) {
      for (const category of pluralCategories) {
        expect(catalog, `en ${base}.${category}`).toHaveProperty(`${base}.${category}`);
      }
    }
  });

  it("keeps the placeholder names of each key", () => {
    expect(placeholderNames(catalog["answer.closes"])).toEqual(["date"]);
    expect(placeholderNames(catalog["answer.anonymity"])).toEqual(["n"]);
  });
});

describe("messagesFor", () => {
  it("formats English plurals, numbers and dates", () => {
    const en = messagesFor("en");
    expect(en.locale).toBe("en");
    expect(en.pluralMessage("answer.remaining", 1)).toBe("1 Question left");
    expect(en.pluralMessage("answer.remaining", 3)).toBe("3 Questions left");
    expect(en.pluralMessage("pulse.questionCount", 1234)).toBe("1,234 Questions");
    expect(
      en.formatDate(DateTime.makeUnsafe("2026-11-07T12:00:00Z"), { dateStyle: "medium", timeZone: "UTC" }),
    ).toBe("Nov 7, 2026");
  });

  it("fills English templates", () => {
    expect(messagesFor("en").message("answer.closes", { date: "Nov 7, 2026" })).toBe("Closes on Nov 7, 2026");
  });

  it("returns the same Messages for the same locale", () => {
    expect(messagesFor("en")).toBe(messagesFor("en"));
  });
});

describe("active locale", () => {
  afterEach(() => {
    setLocale("en");
  });

  it("keeps message() in English after setLocale('en')", () => {
    setLocale("en");
    expect(activeMessage("app.retry")).toBe("Try again");
  });
});

// Proves that Mismatched reports a translation whose placeholder differs from English (ADR 0025: kept for a second locale).
type MisspelledEn = Omit<typeof catalog, "answer.closes"> & {
  readonly "answer.closes": "Closes on {datum}";
};
describe("placeholder type check", () => {
  it("is never for the shipped English catalog", () => {
    const shipped: [Mismatched<typeof catalog>] extends [never] ? true : Mismatched<typeof catalog> = true;
    expect(shipped).toBe(true);
  });

  it("names the key whose placeholder differs", () => {
    // @ts-expect-error "answer.closes" uses {datum} where English has {date}
    const flagged: [Mismatched<MisspelledEn>] extends [never] ? true : Mismatched<MisspelledEn> = true;
    expect(flagged).toBe(true);
  });
});

const literalNumberWithUnit =
  /\b\d[\d,]*\s*-?(?:digit|minutes?|hours?|days?|seconds?|characters?|persons?|people|questions?|themes?|rounds?|tests?)\b/i;
const singularPluralLabelKeys = new Set(["results.trendLength.one"]);

describe("policy numbers in English copy", () => {
  it("states a policy number as a Policy placeholder, never a literal with a unit", () => {
    const offenders = Object.entries(catalog)
      .filter(([key, text]) => !singularPluralLabelKeys.has(key) && literalNumberWithUnit.test(text))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});

// Text in TSX and TS sources is checked by the `surveybeat/no-literal-ui-text` lint rule.
// The HTML shells are checked here: they may hold no visible text at all.
describe("HTML entries", () => {
  const visibleText = (html: string) =>
    html
      .replaceAll(/<!--[\s\S]*?-->/g, "")
      .replaceAll(/<(script|style|title)\b[\s\S]*?<\/\1>/g, "")
      .replaceAll(/<[^>]*>/g, "")
      .trim();

  it.each([
    ["index.html", indexHtml],
    ["answer.html", answerHtml],
    ["site.html", siteHtml],
  ])("%s has no user-facing text outside the catalog", (_name, html) => {
    expect(visibleText(html)).toBe("");
  });

  it.each([
    ["index.html", indexHtml],
    ["answer.html", answerHtml],
    ["site.html", siteHtml],
  ])("%s leaves the title to the catalog", (_name, html) => {
    expect(/<title>\s*<\/title>/.test(html)).toBe(true);
  });
});
