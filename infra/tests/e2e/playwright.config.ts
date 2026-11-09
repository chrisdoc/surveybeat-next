import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * End-to-end tests against a deployed stage (SPEC §7) or local web preview.
 *
 *   E2E_BASE_URL=https://pr-12.app.surveybeat.app pnpm test:e2e
 */
const defaultPort = 4173;
const baseURL = process.env["E2E_BASE_URL"] ?? `http://127.0.0.1:${defaultPort}`;
const distDir = resolve(import.meta.dirname, "../../../apps/web/dist");

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
  ...(process.env["E2E_BASE_URL"]
    ? {}
    : {
        webServer: {
          command: `node -e '
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const dist = "${distDir}";
const s = http.createServer((req, res) => {
  const url = new URL(req.url, "http://" + req.headers.host);
  let file = path.join(dist, url.pathname);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) {
    if (url.pathname.startsWith("/a") || url.pathname.startsWith("/answer")) file = path.join(dist, "answer.html");
    else file = path.join(dist, "index.html");
  }
  const ext = path.extname(file);
  const type = ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "text/html";
  res.writeHead(200, { "content-type": type, "access-control-allow-origin": "*" });
  res.end(fs.readFileSync(file));
});
s.listen(${defaultPort}, "127.0.0.1");
'`,
          port: defaultPort,
          reuseExistingServer: !process.env["CI"],
        },
      }),
});
