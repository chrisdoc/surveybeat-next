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
  InvitationEmail: {
    _tag: "InvitationEmail",
    pulseName: "Weekly Pulse",
    anonymityStatement: "Your name is never stored with your answers.",
    token: "test-token-123",
    baseUrl: "https://app.surveybeat.app",
    ratingQuestion: {
      text: "How was your week?",
      lowLabel: "Dreadful",
      highLabel: "Energising",
    },
    actions: ["Keep pairing sessions short", "Update onboarding docs"],
  },
  ReminderEmail: {
    _tag: "ReminderEmail",
    pulseName: "Weekly Pulse",
    token: "test-token-123",
    baseUrl: "https://app.surveybeat.app",
    ratingQuestion: null,
    actions: [],
    unsubscribeUrl: "https://app.surveybeat.app/api/reminders/unsubscribe?t=test-token-123",
  },
  ResultsReadyEmail: {
    _tag: "ResultsReadyEmail",
    pulseName: "Weekly Pulse",
    teamName: "Platform",
    resultsUrl: "https://app.surveybeat.app/teams/team-1/rounds/round-1",
    responseRatePercent: 85,
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

describe("InvitationEmail", () => {
  it("contains pulse name, anonymity statement, 5 rating links, open check-in, actions, and footer", async () => {
    const { html, text } = await renderEmail(examples.InvitationEmail);
    expect(html).toContain("Weekly Pulse");
    expect(html).toContain("Your name is never stored with your answers.");
    for (let v = 1; v <= 5; v++) {
      expect(html).toContain(`https://app.surveybeat.app/a#t=test-token-123&amp;v=${v}`);
    }
    expect(html).toContain("Open check-in");
    expect(html).toContain("https://app.surveybeat.app/a#t=test-token-123");
    expect(html).toContain("Keep pairing sessions short");
    expect(html).toContain("Update onboarding docs");
    expect(html).toContain("Change when I get this");
    expect(html).toContain("This link is personal. Don&#x27;t forward it.");

    expect(text).toContain("Weekly Pulse");
    expect(text).toContain("Your name is never stored with your answers.");
    expect(text).toContain("https://app.surveybeat.app/a#t=test-token-123");
    expect(text).toContain(
      "Change when I get this: https://app.surveybeat.app/delivery?token=test-token-123",
    );
  });
});

describe("ReminderEmail", () => {
  it("includes RFC 8058 List-Unsubscribe headers and opt-out link", async () => {
    const rendered = await renderEmail(examples.ReminderEmail);
    expect(rendered.headers).toBeDefined();
    expect(rendered.headers?.["List-Unsubscribe"]).toBe(
      "<https://app.surveybeat.app/api/reminders/unsubscribe?t=test-token-123>",
    );
    expect(rendered.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(rendered.html).toContain("Open check-in");
    expect(rendered.html).toContain("Turn off reminders for this Pulse");
    expect(rendered.text).toContain(
      "Turn off reminders for this Pulse: https://app.surveybeat.app/api/reminders/unsubscribe?t=test-token-123",
    );
  });
});
