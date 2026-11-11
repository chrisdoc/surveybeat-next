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

interface AuditResult {
  url: string;
  fcp: number;
  lcp: number;
  tbt: number;
  failures: Array<string>;
}

async function main() {
  const argUrls = process.argv.slice(2);
  let targetUrls: Array<string> = argUrls;
  let server: ReturnType<typeof createServer> | null = null;

  if (targetUrls.length === 0) {
    const port = 4173;
    const distPath = resolve(import.meta.dirname, "../../apps/web/dist");
    // One prerendered shell per locale: `/de/...` gets the German page, everything else the English one.
    const enHtml = readFileSync(resolve(distPath, "answer.html"), "utf8");
    const deHtml = readFileSync(resolve(distPath, "de/answer.html"), "utf8");

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
      res.end(url.pathname.startsWith("/de/") ? deHtml : enHtml);
    });

    await new Promise<void>((res) => server?.listen(port, res));
    targetUrls = [
      `http://127.0.0.1:${port}/a#t=test-token-123&v=4`,
      `http://127.0.0.1:${port}/de/a#t=test-token-123&v=4`,
    ];
    console.log(`Local test server running at http://127.0.0.1:${port}`);
  }

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

  const runLighthouse = (targetUrl: string): Promise<LighthouseResult> =>
    new Promise((resolvePromise, reject) => {
      const args = [
        targetUrl,
        "--output=json",
        // Only the gated audits: the full category runs gatherers that inject their own scripts into the page while
        // it loads, and their long tasks land in TBT (seen as `_lighthouse-eval.js` tasks of 250-420 ms).
        "--only-audits=first-contentful-paint,largest-contentful-paint,total-blocking-time",
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

  const median = (values: ReadonlyArray<number>): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };

  /**
   * Audits one URL: one warm-up run that is discarded (cold Chrome and disk caches), then `RUNS` measured runs. Each
   * metric is gated on its median, as Lighthouse CI recommends: one noisy run on a shared runner neither fails nor
   * passes the gate, and the budgets themselves stay the same.
   */
  const RUNS = 5;
  const auditUrl = async (targetUrl: string): Promise<AuditResult> => {
    console.log(`\nRunning Lighthouse audit on ${targetUrl} (1 warm-up, ${RUNS} measured runs)...`);
    await runLighthouse(targetUrl);
    const runs: Array<{ fcp: number; lcp: number; tbt: number }> = [];
    for (let run = 1; run <= RUNS; run++) {
      const report = await runLighthouse(targetUrl);
      const measured = {
        fcp: report.audits["first-contentful-paint"].numericValue,
        lcp: report.audits["largest-contentful-paint"].numericValue,
        tbt: report.audits["total-blocking-time"].numericValue,
      };
      runs.push(measured);
      console.log(
        `  run ${run}: FCP ${Math.round(measured.fcp)} ms, LCP ${Math.round(measured.lcp)} ms, TBT ${Math.round(measured.tbt)} ms`,
      );
    }
    const fcp = median(runs.map((run) => run.fcp));
    const lcp = median(runs.map((run) => run.lcp));
    const tbt = median(runs.map((run) => run.tbt));

    const failures: Array<string> = [];
    if (fcp > FCP_BUDGET)
      failures.push(`median FCP ${Math.round(fcp)} ms exceeds budget of ${FCP_BUDGET} ms`);
    if (lcp > LCP_BUDGET)
      failures.push(`median LCP ${Math.round(lcp)} ms exceeds budget of ${LCP_BUDGET} ms`);
    if (tbt > TBT_BUDGET)
      failures.push(`median TBT ${Math.round(tbt)} ms exceeds budget of ${TBT_BUDGET} ms`);
    return { url: targetUrl, fcp, lcp, tbt, failures };
  };

  try {
    const results: Array<AuditResult> = [];
    for (const targetUrl of targetUrls) {
      results.push(await auditUrl(targetUrl));
    }

    console.log(`\nLighthouse Performance Results (median of ${RUNS} runs):`);
    for (const result of results) {
      console.log(`\n${result.url}`);
      console.log(`• FCP: ${Math.round(result.fcp)} ms (Budget: ≤ ${FCP_BUDGET} ms)`);
      console.log(`• LCP: ${Math.round(result.lcp)} ms (Budget: ≤ ${LCP_BUDGET} ms)`);
      console.log(`• TBT: ${Math.round(result.tbt)} ms (Budget: ≤ ${TBT_BUDGET} ms)`);
    }

    const failed = results.filter((result) => result.failures.length > 0);
    if (failed.length > 0) {
      console.error(`\n❌ Lighthouse CI Gate Failed:`);
      for (const result of failed) {
        result.failures.forEach((f) => console.error(`  - ${result.url}: ${f}`));
      }
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
