import { expect, open, test } from "./fixtures.ts";

test("the app loads", async ({ page, pageErrors }) => {
  await open(page, "/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("the answer page loads", async ({ page, pageErrors }) => {
  await open(page, "/answer");
  await expect(page.locator("#screen-1")).toBeVisible();
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
