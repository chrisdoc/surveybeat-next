import { describe, expect, it } from "vitest";
import answerHtml from "../../answer.html?raw";
import indexHtml from "../../index.html?raw";
import { formatDate, message, pluralMessage } from "./index.ts";

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
