import { Legal, legalPages } from "@surveybeat/domain";
import { describe, expect, it } from "vitest";
import siteHtml from "../../site.html?raw";
import { renderLegalPage, legalSections } from "./legal.ts";

const visibleText = (html: string): string =>
  html
    .replaceAll(/<(script|style|title)\b[\s\S]*?<\/\1>/g, "")
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll(/\s+/g, " ");

describe.each(legalPages)("legal page %s", (page) => {
  const html = renderLegalPage("en", siteHtml, page);

  it("renders without scripts and leaves no placeholder unfilled", () => {
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/\{\w+\}/);
    expect(html).not.toContain("<!--SITE_");
    expect(html).toMatch(/<title>[^<]+ · SurveyBeat<\/title>/);
  });

  it("has numbered sections with a title and content", () => {
    const sections = legalSections(page);
    expect(sections.length).toBeGreaterThan(1);

    for (const section of sections) {
      expect(section.title).not.toBe("");
      expect(section.blocks.length).toBeGreaterThan(0);
    }
  });

  it("links every legal page and the privacy contact from the footer and body", () => {
    for (const other of legalPages) {
      expect(html).toContain(`href="${Legal.paths[other]}"`);
    }

    expect(html).toContain(`mailto:${Legal.privacyEmail}`);
  });

  it("uses glossary terms, not the words the glossary avoids", () => {
    expect(visibleText(html)).not.toMatch(/\b(Survey|surveys|User|users|instance|Responses?)\b/);
  });
});

describe("privacy notice content", () => {
  const text = visibleText(renderLegalPage("en", siteHtml, "privacy"));

  it.each([
    "__Host-surveybeat-session",
    "HttpOnly",
    "SameSite=Lax",
    "no time",
    "Recital 26",
    "Article 28",
    "Cloudflare",
    "OpenRouter",
    "google-vertex/europe",
    "amazon-bedrock/eu-west-1",
    "sb_edit_",
    "sb_answers_",
    "Clear my answers on this device",
    "edpb.europa.eu",
  ])("discloses %s", (needle) => {
    expect(text).toContain(needle);
  });

  it("states the retention periods from the code and the policy", () => {
    expect(text).toContain("24 months");
    expect(text).toContain("5 minutes");
    expect(text).toContain("Later Answers");
    expect(text).toContain("refreshed while you use the app");
    expect(text).toContain("not in place yet");
    expect(text).toContain("cancelling a Round deletes");
    expect(text).toContain("30 days");
    expect(text).toContain("not published on this page yet");
    expect(text).toContain("redacted titles of open Actions");
  });
});

describe("sub-processor register", () => {
  const text = visibleText(renderLegalPage("en", siteHtml, "subprocessors"));

  it.each([
    "Cloudflare, Inc.",
    "OpenRouter, Inc.",
    "Google Cloud (google-vertex/europe)",
    "Amazon Web Services (amazon-bedrock/eu-west-1)",
  ])("names %s", (name) => {
    expect(text).toContain(name);
  });
});
