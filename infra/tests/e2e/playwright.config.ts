import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a deployed stage (SPEC §7).
 *
 *   E2E_BASE_URL=https://pr-12.app.surveybeat.app pnpm test:e2e
 */
const baseURL = process.env["E2E_BASE_URL"];
if (baseURL === undefined || baseURL === "") {
  throw new Error("Set E2E_BASE_URL to the stage's Main Worker URL, e.g. https://pr-12.app.surveybeat.app");
}

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  forbidOnly: process.env["CI"] !== undefined,
  // A fresh custom hostname can still be settling after the smoke test.
  retries: process.env["CI"] === undefined ? 0 : 1,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["github"]],
  outputDir: "../../../test-results/e2e",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
