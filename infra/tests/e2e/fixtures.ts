import { test as base, expect, type Page } from "@playwright/test";

/** Uncaught errors on a page. Each test asserts there are none. */
export const test = base.extend<{ pageErrors: Array<Error> }>({
  pageErrors: async ({ page }, use) => {
    const errors: Array<Error> = [];
    page.on("pageerror", (error) => errors.push(error));
    await use(errors);
  },
});

export { expect };

export const open = async (page: Page, path: string) => {
  const response = await page.goto(path);
  expect(response?.status(), `GET ${path}`).toBe(200);
};
