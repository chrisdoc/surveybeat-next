// @effect-diagnostics asyncFunction:off -- Playwright's API is promise-based and these specs never enter an Effect.

import AxeBuilder from "@axe-core/playwright";
import { expect, open, test } from "./fixtures.ts";

test("the app loads", async ({ page, pageErrors }) => {
  await open(page, "/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("the header and footer fit a phone and pass axe on the sign-in and Privacy pages", async ({
  page,
  pageErrors,
}) => {
  // A 390 px phone: one header row, the footer's Privacy link, no horizontal scroll (B1, #152).
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, heading] of [
    ["/", "Sign in to SurveyBeat"],
    ["/privacy", "Privacy at SurveyBeat"],
  ] as const) {
    await open(page, path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Privacy" })).toBeVisible();

    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations, `axe on ${path}`).toEqual([]);

    expect(
      await page.evaluate("document.documentElement.scrollWidth"),
      `scroll width on ${path}`,
    ).toBeLessThanOrEqual(390);
  }
  expect(pageErrors).toEqual([]);
});

test("a client route answers the app shell on a hard load", async ({ page, pageErrors }) => {
  // /history has no file behind it, so the asset layer has to fall back to index.html. Without that
  // fallback a bookmark, a refresh, or a shared link on any screen answers 404 (it did in production).
  const response = await page.goto("/history");
  expect(response?.status(), "GET /history").toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("the answer page loads", async ({ page, pageErrors }) => {
  // Opened without an Invitation token, the page loads and shows only its error (#143, B10).
  await open(page, "/answer");
  await expect(page.locator("#err")).toBeVisible();
  await expect(page.locator("#screen-1")).toBeHidden();
  await expect(page).toHaveTitle("Your answer");
  expect(pageErrors).toEqual([]);
});

test("a signed-out visitor sees the email-code sign-in form", async ({ page, pageErrors }) => {
  await open(page, "/");
  await expect(page.getByRole("textbox", { name: "Your email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("the login route lands on the app's own sign-in form", async ({ page }) => {
  await page.goto("/auth/login");
  await expect(page.getByRole("textbox", { name: "Your email" })).toBeVisible();
});

test("the directory and Pulse APIs refuse a visitor without a session", async ({ request }) => {
  for (const path of ["/api/teams", "/api/organization", "/api/teams/t/pulses", "/api/teams/t/pulses/p"]) {
    expect((await request.get(path)).status(), `GET ${path}`).toBe(401);
  }
});

const sixDigits = /\b(\d{6})\b/;

test("a code mailed to the visitor signs them in and the session answers with their Organization state", async ({
  page,
  pageErrors,
}) => {
  const email = "e2e-sign-in@example.com";
  await open(page, "/");

  await page.getByRole("textbox", { name: "Your email" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText(`We sent a 6-digit code to ${email}.`)).toBeVisible();

  let code = "";
  await expect
    .poll(async () => {
      const response = await page.request.get(`/__test/email?recipient=${encodeURIComponent(email)}`);
      const body = (await response.json()) as { text: string | null };
      code = body.text?.match(sixDigits)?.[1] ?? "";
      return code;
    })
    .toMatch(/^\d{6}$/);

  await page.getByRole("textbox", { name: "Sign-in code" }).fill(code);
  await page.getByRole("button", { name: "Sign in with this code" }).click();

  await expect(page.getByRole("heading", { name: "You're not part of an Organization yet" })).toBeVisible();

  const session = await page.request.get("/auth/session");
  expect(session.status(), "GET /auth/session").toBe(200);
  const body = (await session.json()) as { _tag: string };
  expect(body._tag).toBe("NotInOrganization");

  expect(pageErrors).toEqual([]);
});

test("a wrong code is refused and leaves the visitor signed out", async ({ page }) => {
  const email = "e2e-wrong-code@example.com";
  await open(page, "/");

  await page.getByRole("textbox", { name: "Your email" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText(`We sent a 6-digit code to ${email}.`)).toBeVisible();

  await page.getByRole("textbox", { name: "Sign-in code" }).fill("000000");
  await page.getByRole("button", { name: "Sign in with this code" }).click();

  await expect(page.getByText("Signing in did not work. Please try again.")).toBeVisible();
  expect((await page.request.get("/auth/session")).status(), "GET /auth/session").toBe(401);
});
