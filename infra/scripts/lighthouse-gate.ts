import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface LighthouseAudit {
  numericValue: number;
}

interface LighthouseResult {
  audits: {
    "first-contentful-paint": LighthouseAudit;
    "largest-contentful-paint": LighthouseAudit;
    "total-blocking-time": LighthouseAudit;
  };
}

const FCP_BUDGET = 800;
const LCP_BUDGET = 1300;
const TBT_BUDGET = 50;

async function main() {
  const argUrl = process.argv[2];
  let targetUrl = argUrl;
  let server: ReturnType<typeof createServer> | null = null;

  if (!targetUrl) {
    const port = 4173;
    const distPath = resolve(import.meta.dirname, "../../apps/web/dist");
    const htmlContent = readFileSync(resolve(distPath, "answer.html"), "utf8");

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (url.pathname === "/exchange" && req.method === "POST") {
        res.writeHead(200, {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
        });
        res.end(
          JSON.stringify({
            roundId: "round-test-1",
            pulseName: "Weekly Pulse",
            minimumGroupSize: 4,
            aiProcessing: false,
            questions: [
              {
                id: "q-1",
                position: 1,
                text: "How was your week?",
                type: { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: true },
              },
            ],
            actions: [],
            closeTime: 9999999,
            state: "open",
            hasAnswered: false,
          }),
        );
        return;
      }

      if (url.pathname.startsWith("/assets/")) {
        const filePath = resolve(distPath, url.pathname.slice(1));
        if (existsSync(filePath)) {
          const contentType = filePath.endsWith(".js")
            ? "application/javascript"
            : filePath.endsWith(".css")
              ? "text/css"
              : "application/octet-stream";
          res.writeHead(200, { "content-type": contentType });
          res.end(readFileSync(filePath));
          return;
        }
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(htmlContent);
    });

    await new Promise<void>((res) => server?.listen(port, res));
    targetUrl = `http://127.0.0.1:${port}/a#t=test-token-123&v=4`;
    console.log(`Local test server running at http://127.0.0.1:${port}`);
  }

  console.log(`Running Lighthouse audit on ${targetUrl}...`);

  const lighthouseBin = resolve(import.meta.dirname, "../node_modules/.bin/lighthouse");

  const findChrome = (): string | undefined => {
    if (process.env["CHROME_PATH"]) return process.env["CHROME_PATH"];
    const base = resolve(process.env["HOME"] ?? "/home/ubuntu", ".cache/ms-playwright");
    if (!existsSync(base)) return undefined;
    for (const entry of ["chromium_headless_shell-1248", "chromium-1248"]) {
      const dir = resolve(base, entry);
      if (existsSync(dir)) {
        const match = [
          resolve(dir, "chrome-headless-shell-linux-arm64/chrome-headless-shell"),
          resolve(dir, "chrome-linux-arm64/chrome"),
          resolve(dir, "chrome-linux/chrome"),
          resolve(dir, "chrome-headless-shell-linux/chrome-headless-shell"),
        ].find(existsSync);
        if (match) return match;
      }
    }
    return undefined;
  };

  const chromePath = findChrome();

  const runLighthouse = (): Promise<LighthouseResult> =>
    new Promise((resolvePromise, reject) => {
      const args = [
        targetUrl,
        "--output=json",
        "--only-categories=performance",
        "--quiet",
        "--chrome-flags=--headless=new --no-sandbox --disable-gpu",
      ];
      const env = { ...process.env };
      if (chromePath) {
        env["CHROME_PATH"] = chromePath;
      }
      const useLocalBin = existsSync(lighthouseBin);
      const cmd = useLocalBin ? lighthouseBin : "pnpm";
      const fullArgs = useLocalBin ? args : ["dlx", "lighthouse@13.6.0", ...args];
      const proc = spawn(cmd, fullArgs, { env, stdio: ["ignore", "pipe", "inherit"] });
      let stdout = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Lighthouse exited with code ${code}`));
          return;
        }
        try {
          const parsed: LighthouseResult = JSON.parse(stdout);
          resolvePromise(parsed);
        } catch (e) {
          reject(e);
        }
      });
    });

  try {
    const maxRuns = 3;
    let fcp = 0;
    let lcp = 0;
    let tbt = 0;
    let failures: Array<string> = [];

    for (let run = 1; run <= maxRuns; run++) {
      const report = await runLighthouse();
      fcp = report.audits["first-contentful-paint"].numericValue;
      lcp = report.audits["largest-contentful-paint"].numericValue;
      tbt = report.audits["total-blocking-time"].numericValue;

      failures = [];
      if (fcp > FCP_BUDGET) failures.push(`FCP ${Math.round(fcp)} ms exceeds budget of ${FCP_BUDGET} ms`);
      if (lcp > LCP_BUDGET) failures.push(`LCP ${Math.round(lcp)} ms exceeds budget of ${LCP_BUDGET} ms`);
      if (tbt > TBT_BUDGET) failures.push(`TBT ${Math.round(tbt)} ms exceeds budget of ${TBT_BUDGET} ms`);

      if (failures.length === 0) {
        break;
      }
      if (run < maxRuns) {
        console.warn(
          `\nRun ${run} missed budget (TBT: ${Math.round(tbt)}ms). Retrying (${run + 1}/${maxRuns})...`,
        );
      }
    }

    console.log(`\nLighthouse Performance Results:`);
    console.log(`• FCP: ${Math.round(fcp)} ms (Budget: ≤ ${FCP_BUDGET} ms)`);
    console.log(`• LCP: ${Math.round(lcp)} ms (Budget: ≤ ${LCP_BUDGET} ms)`);
    console.log(`• TBT: ${Math.round(tbt)} ms (Budget: ≤ ${TBT_BUDGET} ms)`);

    if (failures.length > 0) {
      console.error(`\n❌ Lighthouse CI Gate Failed:`);
      failures.forEach((f) => console.error(`  - ${f}`));
      process.exit(1);
    }

    console.log(`\n✅ All Lighthouse performance budgets passed!`);
  } finally {
    if (server) {
      server.close();
    }
  }
}

main().catch((err) => {
  console.error("Error running Lighthouse gate:", err);
  process.exit(1);
});
