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
