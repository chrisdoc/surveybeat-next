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

test("a signed-out visitor is sent to AuthKit from the sign-in screen", async ({ page, pageErrors }) => {
  await open(page, "/");
  await page.getByRole("button", { name: "Sign in" }).click();
  // The hosted AuthKit page of the stage's WorkOS environment, which accepted our callback URL.
  await expect(page).toHaveURL(/^https:\/\/[^/]+\.authkit\.app\/(?!redirect-uri-invalid)/);
  expect(pageErrors).toEqual([]);
});

test("the login redirect reaches the AuthKit domain", async ({ page }) => {
  await page.goto("/auth/login");
  await expect(page).toHaveURL(/^https:\/\/[^/]+\.authkit\.app\/(?!redirect-uri-invalid)/);
});

test("the directory and Pulse APIs refuse a visitor without a session", async ({ request }) => {
  for (const path of ["/api/teams", "/api/organization", "/api/teams/t/pulses", "/api/teams/t/pulses/p"]) {
    expect((await request.get(path)).status(), `GET ${path}`).toBe(401);
  }
});
