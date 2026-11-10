import { describe, expect, it } from "@effect/vitest";
import { type RenderableEmail, StoredEmail } from "@surveybeat/domain";
import { Schema } from "effect";
import { renderEmail } from "./render.tsx";
import { colors } from "./theme.ts";

/** One example per template. The mapped type fails to compile when a template has no example. */
const examples: { readonly [K in RenderableEmail["_tag"]]: Extract<RenderableEmail, { _tag: K }> } = {
  AddedToTeam: {
    _tag: "AddedToTeam",
    locale: "en",
    teamName: "Platform",
    leadName: "Grace Hopper",
    signInUrl: "https://app.surveybeat.app/",
  },
  InvitationEmail: {
    _tag: "InvitationEmail",
    locale: "en",
    pulseName: "Weekly Pulse",
    minimumGroupSize: 4,
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
    locale: "en",
    pulseName: "Weekly Pulse",
    token: "test-token-123",
    baseUrl: "https://app.surveybeat.app",
    ratingQuestion: null,
    actions: [],
  },
  ResultsReadyEmail: {
    _tag: "ResultsReadyEmail",
    locale: "en",
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

  it("sets the document language to the email's locale", async () => {
    const { html } = await renderEmail(email);
    expect(html).toContain('<html dir="ltr" lang="en">');
  });
});

describe.each(Object.values(examples))("$_tag in German", (example) => {
  const email: typeof example = { ...example, locale: "de" };

  it("renders the subject, HTML, and plain-text parts in German", async () => {
    const rendered = await renderEmail(email);
    expect(rendered.subject).toMatchSnapshot("subject");
    expect(rendered.html).toMatchSnapshot("html");
    expect(rendered.text).toMatchSnapshot("text");
  });

  it("sets the document language to German", async () => {
    const { html } = await renderEmail(email);
    expect(html).toContain('<html dir="ltr" lang="de">');
    expect(html).not.toContain('lang="en"');
  });
});

describe("a send stored before locales were recorded", () => {
  it("decodes as English and renders English", async () => {
    const stored = Schema.decodeUnknownSync(StoredEmail)({
      _tag: "AddedToTeam",
      teamName: "Platform",
      leadName: "Grace Hopper",
      signInUrl: "https://app.surveybeat.app/",
    });
    expect(stored.locale).toBe("en");
    if (stored._tag !== "AddedToTeam") throw new Error("expected an AddedToTeam");
    const { subject, html } = await renderEmail(stored);
    expect(subject).toBe("You've been added to Platform");
    expect(html).toContain('<html dir="ltr" lang="en">');
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
    expect(html).toContain(
      "Your lead only sees combined answers from at least 4 people, never who answered what. Your name is never stored with your answers.",
    );
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
    expect(text).toContain("at least 4 people");
    expect(text).toContain("never who answered what");
    expect(text).toContain("https://app.surveybeat.app/a#t=test-token-123");
    expect(text).toContain(
      "Change when I get this: https://app.surveybeat.app/delivery?token=test-token-123",
    );
  });
});

describe("InvitationEmail rows stored before N was carried", () => {
  it("render their statement verbatim", async () => {
    const { minimumGroupSize: _n, ...rest } = examples.InvitationEmail;
    const { text } = await renderEmail({
      ...rest,
      anonymityStatement: "Your name is never stored with your answers.",
    });
    expect(text).toContain("Your name is never stored with your answers.");
    expect(text).not.toContain("at least");
  });
});

describe("ReminderEmail", () => {
  it("renders the unsubscribe URL stored by an older row as is", async () => {
    const { headers } = await renderEmail({
      ...examples.ReminderEmail,
      unsubscribeUrl: "https://old.example/api/reminders/unsubscribe?t=old",
    });
    expect(headers?.["List-Unsubscribe"]).toBe("<https://old.example/api/reminders/unsubscribe?t=old>");
  });

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

const aiNotice =
  "Comments are summarised by an AI service in the EU after names, emails, phone numbers, handles and links are removed. It keeps nothing.";

describe("AI processing notice", () => {
  it.each([
    ["InvitationEmail", examples.InvitationEmail],
    ["ReminderEmail", examples.ReminderEmail],
  ] as const)("%s states the notice in both parts when AI processing is on", async (_name, example) => {
    const { html, text } = await renderEmail({ ...example, aiProcessing: true });
    expect(html).toContain(aiNotice);
    expect(text).toContain(aiNotice);
  });

  it.each([
    ["off", { aiProcessing: false }],
    ["absent", {}],
  ] as const)("%s leaves the notice out of both parts of an InvitationEmail", async (_label, flag) => {
    const { html, text } = await renderEmail({ ...examples.InvitationEmail, ...flag });
    expect(html).not.toContain("Comments are summarised");
    expect(text).not.toContain("Comments are summarised");
  });

  it.each([
    ["off", { aiProcessing: false }],
    ["absent", {}],
  ] as const)("%s leaves the notice out of both parts of a ReminderEmail", async (_label, flag) => {
    const { html, text } = await renderEmail({ ...examples.ReminderEmail, ...flag });
    expect(html).not.toContain("Comments are summarised");
    expect(text).not.toContain("Comments are summarised");
  });

  it("puts the notice in the privacy panel, under the anonymity statement", async () => {
    const { html } = await renderEmail({ ...examples.InvitationEmail, aiProcessing: true });
    expect(html.indexOf("at least 4 people")).toBeLessThan(html.indexOf("Comments are summarised"));
  });
});

describe("theme", () => {
  it("keeps the light palette in step with the app theme", () => {
    expect(colors).toEqual({
      page: "#F3F4F1",
      card: "#FFFFFF",
      border: "#E1E5E1",
      rowBorder: "#ECEFEC",
      text: "#0E2A24",
      muted: "#3D554F",
      accent: "#0B5D55",
      button: "#0E2A24",
      buttonText: "#FFFFFF",
      panel: "#0E2A24",
      panelText: "#DCE9E5",
      mint: "#9FD6CB",
      ratingBorder: "#768C85",
    });
  });
});
