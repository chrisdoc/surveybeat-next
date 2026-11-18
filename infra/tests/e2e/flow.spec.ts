// @effect-diagnostics asyncFunction:off -- Playwright's API is promise-based and these specs never enter an Effect.

import type { APIRequestContext, BrowserContext, Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { flowLeadFor } from "./flow-lead.ts";

/**
 * The SPEC §7 flow on a local stage, one step per test, in order. A Lead creates an Organization,
 * a Team of four People and a Pulse; a test route opens the Round now, so the flow need not wait for
 * the planned open time; each Person answers from the Invitation email in a fresh browser; the Lead
 * closes the Round, reads its Results and commits an Action. Each step reads what the earlier steps
 * left in `flow`.
 *
 * The test routes and the captured email exist only on a `test_*` stage, so the flow runs only when
 * `E2E_BASE_URL` is unset. The answer page posts to the Main Worker's origin on localhost; the spec
 * routes those posts to the Submission Worker on port 1338, which the local stack also runs.
 */

const hasTestRoutes = process.env["E2E_BASE_URL"] === undefined;
const submissionOrigin = "http://localhost:1338";
const answerEndpoints = /^http:\/\/localhost:1337\/(exchange|first-answer|answer)$/;

const flowRun = process.env["E2E_FLOW_RUN"] ?? "";
let lead = "";
const runId = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
  byte.toString(16).padStart(2, "0"),
).join("");
const members = [1, 2, 3].map((n) => `flow-member-${n}-${runId}@example.com`);
let invitees: ReadonlyArray<string> = [];

const TEAM = "Platform";
const ACTION = "Keep pairing sessions short";
const QUESTIONS = {
  manageable: "How manageable was your workload this week?",
  safe: "How safe did you feel raising concerns or mistakes in the team?",
  priorities: "How clear were your priorities this week?",
  recognised: "How recognised did you feel for your work this week?",
  obstacle: "What slowed you down most this week?",
};

// Captured mail is written by the Organization alarm and the email queue, a few seconds after the Round opens.
const mailTimeout = { timeout: 15_000 };
const sixDigits = /\b(\d{6})\b/;
const invitationToken = /#t=([A-Za-z0-9_-]{22})/;
const score = /\d[.,]\d ?\/ ?5/;

const leadErrors: Array<Error> = [];
const flow = {
  organizationId: "",
  teamId: "",
  pulseId: "",
  roundId: "",
  tokens: new Map<string, string>(),
};

const capturedText = async (request: APIRequestContext, recipient: string): Promise<string | null> => {
  const response = await request.get(`/__test/email?recipient=${encodeURIComponent(recipient)}`);
  const body: { text: string | null } = await response.json();
  return body.text;
};

const mailedCode = async (request: APIRequestContext, recipient: string): Promise<string> => {
  let code = "";
  await expect
    .poll(async () => {
      code = (await capturedText(request, recipient))?.match(sixDigits)?.[1] ?? "";
      return code;
    }, mailTimeout)
    .toMatch(/^\d{6}$/);
  return code;
};

const mailedToken = async (request: APIRequestContext, recipient: string): Promise<string> => {
  let token = "";
  await expect
    .poll(async () => {
      token = (await capturedText(request, recipient))?.match(invitationToken)?.[1] ?? "";
      return token;
    }, mailTimeout)
    .toMatch(/^[A-Za-z0-9_-]{22}$/);
  return token;
};

const sendToSubmissionWorker = async (route: Route): Promise<void> => {
  const { pathname } = new URL(route.request().url());
  await route.continue({ url: `${submissionOrigin}${pathname}` });
};

const answerEveryQuestion = async (page: Page): Promise<void> => {
  await page
    .getByRole("group", { name: QUESTIONS.manageable })
    .getByRole("radio", { name: "3", exact: true })
    .check();

  for (const question of [QUESTIONS.safe, QUESTIONS.priorities, QUESTIONS.recognised]) {
    await page.getByRole("group", { name: question }).getByRole("radio", { name: "3", exact: true }).check();
  }
  await page
    .getByRole("group", { name: QUESTIONS.obstacle })
    .getByRole("radio", { name: "Interruptions" })
    .check();
  await page
    .locator('[data-question-screen="6"]')
    .getByRole("textbox", { name: "Want to say more?" })
    .fill("Nothing to add.");
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();
};

test.describe.serial("SPEC §7 flow", () => {
  test.skip(!hasTestRoutes, "the flow's test routes and captured email exist only on the local test_ stage");

  let leadContext: BrowserContext;
  let leadPage: Page;

  test.beforeAll(async ({ browser }) => {
    lead = flowLeadFor(flowRun, test.info().retry);
    invitees = [lead, ...members];
    leadContext = await browser.newContext();
    leadPage = await leadContext.newPage();
    leadPage.on("pageerror", (error) => leadErrors.push(error));
  });

  test.afterAll(async () => {
    await leadContext?.close();
  });

  test("create an Organization", async () => {
    await leadPage.goto("/");
    await leadPage.getByRole("textbox", { name: "Your email" }).fill(lead);
    await leadPage.getByRole("button", { name: "Email me a code" }).click();
    await expect(leadPage.getByText(`We sent a 6-digit code to ${lead}.`)).toBeVisible();

    const code = await mailedCode(leadContext.request, lead);
    await leadPage.getByRole("textbox", { name: "Sign-in code" }).fill(code);
    await leadPage.getByRole("button", { name: "Sign in with this code" }).click();

    await expect(leadPage.getByRole("heading", { name: "Create an Organization" })).toBeVisible();
    await leadPage.getByRole("textbox", { name: "Organization name" }).fill("Flow Org");
    await leadPage.getByRole("button", { name: "Create Organization" }).click();
    await expect(leadPage.getByRole("button", { name: "Create Team" })).toBeVisible();

    const session = await leadContext.request.get("/auth/session");
    const body: { organization: { id: string } } = await session.json();
    flow.organizationId = body.organization.id;

    await leadPage.getByRole("button", { name: "Create Team" }).click();
    await leadPage.getByRole("textbox", { name: "Team name" }).fill(TEAM);
    await leadPage.getByRole("textbox", { name: "Lead's email" }).fill(lead);
    await leadPage.getByRole("button", { name: "Create Team", exact: true }).click();

    await expect(leadPage).toHaveURL(/\/teams\/[^/]+$/);
    await expect(leadPage.getByRole("heading", { name: TEAM, level: 1 })).toBeVisible();
    flow.teamId = new URL(leadPage.url()).pathname.split("/")[2] ?? "";

    await leadPage.getByRole("button", { name: "Add member" }).click();
    for (const email of members) {
      await leadPage.getByRole("textbox", { name: "Add a member by email" }).fill(email);
      await leadPage.getByRole("button", { name: "Add member", exact: true }).click();
      await expect(leadPage.getByText(email, { exact: true })).toBeVisible();
    }
    await expect(leadPage.getByText(lead, { exact: true })).toBeVisible();
  });

  test("create a Pulse", async () => {
    await leadPage.goto(`/teams/${flow.teamId}/pulses`);
    await leadPage.getByRole("button", { name: "Create a Pulse" }).click();
    await expect(leadPage).toHaveURL(/\/teams\/[^/]+\/pulses\/[^/]+$/);
    flow.pulseId = new URL(leadPage.url()).pathname.split("/")[4] ?? "";
    await expect(leadPage.getByText(QUESTIONS.manageable)).toBeVisible();
  });

  test("receive the Invitation", async () => {
    const opened = await leadContext.request.post(
      `/__test/flow/open-round?organization=${flow.organizationId}&pulse=${flow.pulseId}`,
    );
    expect(opened.status(), "open the Round").toBe(200);
    const body: { roundId: string } = await opened.json();
    flow.roundId = body.roundId;

    for (const email of invitees) {
      flow.tokens.set(email, await mailedToken(leadContext.request, email));
    }
    expect(flow.tokens.size).toBe(invitees.length);
  });

  test("answer from the email", async ({ browser }) => {
    test.setTimeout(120_000);
    for (const email of invitees) {
      const context = await browser.newContext();
      try {
        await context.route(answerEndpoints, sendToSubmissionWorker);
        const page = await context.newPage();
        const saves = { started: 0, settled: 0, failed: 0 };
        page.on("request", (request) => {
          if (request.method() === "POST" && /\/(first-answer|answer)$/.test(request.url()))
            saves.started += 1;
        });
        page.on("requestfinished", async (request) => {
          if (!/\/(first-answer|answer)$/.test(request.url())) return;
          const response = await request.response();
          if (response === null || !response.ok()) saves.failed += 1;
          saves.settled += 1;
        });
        page.on("requestfailed", (request) => {
          if (!/\/(first-answer|answer)$/.test(request.url())) return;
          saves.failed += 1;
          saves.settled += 1;
        });
        const exchanged = page.waitForResponse((response) => response.url().endsWith("/exchange"));
        await page.goto(`/a#t=${flow.tokens.get(email) ?? ""}`);
        const exchange: { roundId?: string } = await (await exchanged).json();
        expect(exchange.roundId, "the Submission Worker answers the exchange").toBe(flow.roundId);
        await expect(page.getByRole("group", { name: QUESTIONS.manageable })).toBeVisible();
        await answerEveryQuestion(page);
        await expect
          .poll(() => saves.started > 0 && saves.settled === saves.started, {
            message: "every answer save settles before the browser closes",
            timeout: 15_000,
          })
          .toBe(true);
        expect(saves.failed, "no answer save failed").toBe(0);
      } finally {
        await context.close();
      }
    }
  });

  test("close the Round", async () => {
    await leadPage.goto(`/teams/${flow.teamId}/pulses/${flow.pulseId}/rounds`);
    await leadPage.getByRole("button", { name: "Close early" }).click();
    await leadPage.getByRole("button", { name: "Yes, continue" }).click();
    await expect(leadPage.getByRole("button", { name: "Close early" })).toHaveCount(0);
  });

  test("see the Results", async () => {
    await leadPage.goto(`/teams/${flow.teamId}/rounds/${flow.roundId}`);
    await expect(async () => {
      await leadPage.reload();
      await expect(leadPage.getByText(score).first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(leadPage.getByText("so no Results are shown")).toHaveCount(0);
  });

  test("create an Action", async () => {
    await leadPage.getByRole("button", { name: "Commit an action" }).click();
    await leadPage.getByLabel("Action title").fill(ACTION);
    await leadPage.getByRole("button", { name: "Commit action" }).click();
    await expect(leadPage.getByRole("heading", { name: ACTION })).toBeVisible();
    expect(leadErrors).toEqual([]);
  });
});
