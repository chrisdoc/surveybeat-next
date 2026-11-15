// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * End-to-end tests against a deployed stage (SPEC §7) or the app served by a local stage.
 *
 *   E2E_BASE_URL=https://pr-12.app.surveybeat.app pnpm test:e2e
 *   pnpm test:e2e
 *
 * Without `E2E_BASE_URL`, `alchemy dev` deploys the real `MainWorker` (Durable Object, D1 and the
 * sign-in handlers) to local workerd at `http://localhost:1337`, and the static assets are built
 * from `apps/web` first. The specs then drive the same routes a stage answers, `/auth/session`
 * included, so no stub can hide a missing handler.
 */
const root = resolve(import.meta.dirname, "../../..");
const localStageURL = "http://localhost:1337";
const baseURL = process.env["E2E_BASE_URL"] ?? localStageURL;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  forbidOnly: process.env["CI"] !== undefined,
  // A fresh custom hostname can still be settling after the smoke test.
  retries: process.env["CI"] === undefined ? 0 : 1,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["github"]],
  outputDir: "../../../test-results/e2e",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // The audit's phone layouts (C4, #160): the signed-in screens the polish pass changed at a
    // 393 x 851 phone, where a table or a row is most likely to break. The answer page tests its
    // own phone width, and the sign-in form is a desktop concern, so only `polish.spec.ts`
    // runs here.
    { name: "phone", testMatch: /polish\.spec\.ts/, use: { ...devices["Pixel 5"] } },
  ],
  ...(process.env["E2E_BASE_URL"]
    ? {}
    : {
        webServer: {
          command:
            "pnpm --filter @surveybeat/web build && exec node_modules/.bin/alchemy dev -c infra/tests/e2e/stack.ts --stage test_e2e --no-input --log-level warn",
          cwd: root,
          url: `${localStageURL}/`,
          timeout: 180_000,
          reuseExistingServer: process.env["CI"] === undefined,
          env: { ORG_CREATION_ALLOWLIST: "nobody@example.invalid" },
        },
      }),
});
