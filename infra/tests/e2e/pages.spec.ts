import { expect, open, test } from "./fixtures.ts";

test("the app loads", async ({ page, pageErrors }) => {
  await open(page, "/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("the answer page loads", async ({ page, pageErrors }) => {
  await open(page, "/answer");
  await expect(page.locator("#answer p").first()).toBeVisible();
  await expect(page).not.toHaveTitle("");
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
