import { describe, expect, it } from "@effect/vitest";
import type { TransactionalEmail } from "@surveybeat/domain";
import { renderEmail } from "./render.tsx";

/** One example per template. The mapped type fails to compile when a template has no example. */
const examples: { readonly [K in TransactionalEmail["_tag"]]: Extract<TransactionalEmail, { _tag: K }> } = {
  AddedToTeam: {
    _tag: "AddedToTeam",
    teamName: "Platform",
    leadName: "Grace Hopper",
    signInUrl: "https://app.surveybeat.app/",
  },
};

describe.each(Object.values(examples))("$_tag", (email) => {
  it("renders the subject, HTML, and plain-text parts", async () => {
    const rendered = await renderEmail(email);
    expect(rendered.subject).toMatchSnapshot("subject");
    expect(rendered.html).toMatchSnapshot("html");
    expect(rendered.text).toMatchSnapshot("text");
  });

  it("supports light and dark mode", async () => {
    const { html } = await renderEmail(email);
    expect(html).toContain('<meta name="color-scheme" content="light dark"');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
  });
});

describe("AddedToTeam", () => {
  it("escapes names in the HTML part", async () => {
    const { html, text } = await renderEmail({
      ...examples.AddedToTeam,
      teamName: "R&D <script>alert(1)</script>",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("R&amp;D &lt;script&gt;");
    expect(text).toContain("R&D <script>alert(1)</script>");
  });

  it("keeps the subject on one line", async () => {
    const { subject } = await renderEmail({
      ...examples.AddedToTeam,
      teamName: "Platform\r\nBcc: x@evil.test",
    });
    expect(subject).toBe("You've been added to Platform Bcc: x@evil.test");
  });

  it("puts the link in the plain-text part", async () => {
    const { subject, text } = await renderEmail(examples.AddedToTeam);
    expect(subject).toBe("You've been added to Platform");
    expect(text).toContain("Open SurveyBeat: https://app.surveybeat.app/");
  });
});
