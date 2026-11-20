// @effect-diagnostics asyncFunction:off -- a standalone Node script: it reports to the shell and never builds an Effect program.
// @effect-diagnostics globalConsole:off -- the script writes its report to stdout/stderr; it never runs an Effect program.
// @effect-diagnostics newPromise:off -- the script waits on a child process or a timeout with a plain Promise; there is no Effect runtime in it.
// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

interface LighthouseAudit {
  numericValue: number;
}

interface LighthouseResult {
  audits: {
    "first-contentful-paint": LighthouseAudit;
    "largest-contentful-paint": LighthouseAudit;
    "total-blocking-time": LighthouseAudit;
    metrics?: { details?: { items?: readonly { observedFirstContentfulPaint?: number }[] } };
    "render-blocking-insight"?: { details?: { items?: readonly { url: string }[] } };
    "network-requests"?: {
      details?: {
        items?: readonly {
          url: string;
          resourceType?: string;
          priority?: string;
          networkRequestTime?: number;
          networkEndTime?: number;
        }[];
      };
    };
  };
}

const reportDir = path.resolve(import.meta.dirname, "../../test-results/lighthouse");

const observedTimings = (report: LighthouseResult): string => {
  const observedFcp = report.audits.metrics?.details?.items?.[0]?.observedFirstContentfulPaint;
  const requests = report.audits["network-requests"]?.details?.items ?? [];

  const firstScript = requests
    .filter((request) => request.resourceType === "Script")
    .map((request) => request.networkRequestTime ?? 0)
    .sort((a, b) => a - b)[0];

  const fmt = (value: number | undefined) => (value === undefined ? "?" : `${Math.round(value)} ms`);

  const requestTimings = requests
    .filter((request) => !request.url.startsWith("data:"))
    .map((request) => {
      const requestPath = new URL(request.url).pathname.replace(/-[\w-]{8}\.js$/u, ".js");
      const ended = request.networkEndTime ?? 0;
      const beforePaint = observedFcp !== undefined && ended <= observedFcp ? " before paint" : "";

      return `${requestPath} ${request.priority ?? "?"} ${fmt(request.networkRequestTime)}→${fmt(ended)}${beforePaint}`;
    })
    .join("; ");

  return `observed FCP ${fmt(observedFcp)}, first script request ${fmt(firstScript)}; ${requestTimings}`;
};

const FCP_BUDGET = 800;

const SUBRESOURCE_BODY_DELAY_MS = 100;

const plantedStylesheet = "/assets/planted-render-blocking.css";

const plantRenderBlocking = process.env.LIGHTHOUSE_PLANT_RENDER_BLOCKING === "1";

const LCP_BUDGET = 1300;

const TBT_BUDGET = 50;

interface Reply {
  headers: Record<string, string>;
  body: string | Buffer;
}

interface AuditResult {
  url: string;
  fcp: number;
  lcp: number;
  tbt: number;
  renderBlocking: readonly string[];
  failures: string[];
}

async function main() {
  const argUrls = process.argv.slice(2);
  let targetUrls: string[] = argUrls;
  let server: ReturnType<typeof createServer> | null = null;

  if (targetUrls.length === 0) {
    const port = 4173;
    const distPath = path.resolve(import.meta.dirname, "../../apps/web/dist");

    const builtHtml = readFileSync(path.resolve(distPath, "answer.html"), "utf8");

    const enHtml = plantRenderBlocking
      ? builtHtml.replace("</head>", `<link rel="stylesheet" href="${plantedStylesheet}"></head>`)
      : builtHtml;

    const reply = (req: IncomingMessage): Reply => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      if (url.pathname === plantedStylesheet) {
        return { headers: { "content-type": "text/css" }, body: "body{}" };
      }

      if (url.pathname === "/exchange" && req.method === "POST") {
        return {
          headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
          body: JSON.stringify({
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
            closeTime: 9_999_999,
            state: "open",
            hasAnswered: false,
          }),
        };
      }

      if (url.pathname.startsWith("/assets/")) {
        const filePath = path.resolve(distPath, url.pathname.slice(1));

        if (existsSync(filePath)) {
          const contentType = filePath.endsWith(".js")
            ? "application/javascript"
            : filePath.endsWith(".css")
              ? "text/css"
              : "application/octet-stream";

          return { headers: { "content-type": contentType }, body: readFileSync(filePath) };
        }
      }

      return { headers: { "content-type": "text/html; charset=utf-8" }, body: enHtml };
    };

    server = createServer((req, res) => {
      const { headers, body } = reply(req);

      res.writeHead(200, headers);

      if (req.headers["sec-fetch-dest"] === "document") {
        res.end(body);

        return;
      }

      res.flushHeaders();
      void sleep(SUBRESOURCE_BODY_DELAY_MS).then(() => res.end(body));
    });

    await new Promise<void>((resolve) => {
      server?.listen(port, resolve);
    });
    targetUrls = [`http://127.0.0.1:${port}/a#t=test-token-123&v=4`];
    console.log(
      `Local test server running at http://127.0.0.1:${port} (subresource bodies held ${SUBRESOURCE_BODY_DELAY_MS} ms${plantRenderBlocking ? ", planted render-blocking stylesheet" : ""})`,
    );
  }

  const lighthouseBin = path.resolve(import.meta.dirname, "../node_modules/.bin/lighthouse");

  const findChrome = (): string | undefined => {
    if (process.env.CHROME_PATH) {
      return process.env.CHROME_PATH;
    }

    const base = path.resolve(process.env.HOME ?? "/home/ubuntu", ".cache/ms-playwright");

    if (!existsSync(base)) {
      return undefined;
    }

    for (const entry of ["chromium_headless_shell-1248", "chromium-1248"]) {
      const dir = path.resolve(base, entry);

      if (existsSync(dir)) {
        const match = [
          path.resolve(dir, "chrome-headless-shell-linux-arm64/chrome-headless-shell"),
          path.resolve(dir, "chrome-linux-arm64/chrome"),
          path.resolve(dir, "chrome-linux/chrome"),
          path.resolve(dir, "chrome-headless-shell-linux/chrome-headless-shell"),
        ].find(existsSync);

        if (match) {
          return match;
        }
      }
    }

    return undefined;
  };

  const chromePath = findChrome();

  const runLighthouse = (targetUrl: string, name: string): Promise<LighthouseResult> => {
    const outputPath = path.resolve(reportDir, `${name}.json`);

    return new Promise((resolve, reject) => {
      const args = [
        targetUrl,
        "--output=json",
        `--output-path=${outputPath}`,
        "--save-assets",

        "--only-audits=first-contentful-paint,largest-contentful-paint,total-blocking-time,metrics,network-requests,render-blocking-insight",
        "--quiet",
        "--chrome-flags=--headless=new --no-sandbox --disable-gpu",
      ];

      const env = { ...process.env };

      if (chromePath) {
        env.CHROME_PATH = chromePath;
      }

      const useLocalBin = existsSync(lighthouseBin);
      const cmd = useLocalBin ? lighthouseBin : "pnpm";
      const fullArgs = useLocalBin ? args : ["dlx", "lighthouse@13.6.0", ...args];
      mkdirSync(reportDir, { recursive: true });
      const proc = spawn(cmd, fullArgs, { env, stdio: ["ignore", "inherit", "inherit"] });
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Lighthouse exited with code ${code}`));

          return;
        }

        try {
          const parsed: LighthouseResult = JSON.parse(readFileSync(outputPath, "utf8"));
          resolve(parsed);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  };

  const median = (values: readonly number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);

    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };

  const RUNS = plantRenderBlocking ? 1 : 9;

  const auditUrl = async (targetUrl: string): Promise<AuditResult> => {
    console.log(`\nRunning Lighthouse audit on ${targetUrl} (1 warm-up, ${RUNS} measured runs)...`);
    await runLighthouse(targetUrl, "warm-up");
    const runs: { fcp: number; lcp: number; tbt: number }[] = [];
    const renderBlocking = new Set<string>();

    for (let run = 1; run <= RUNS; run++) {
      const report = await runLighthouse(targetUrl, `run-${run}`);

      const measured = {
        fcp: report.audits["first-contentful-paint"].numericValue,
        lcp: report.audits["largest-contentful-paint"].numericValue,
        tbt: report.audits["total-blocking-time"].numericValue,
      };

      runs.push(measured);

      for (const item of report.audits["render-blocking-insight"]?.details?.items ?? []) {
        renderBlocking.add(item.url);
      }

      console.log(
        `  run ${run}: FCP ${Math.round(measured.fcp)} ms, LCP ${Math.round(measured.lcp)} ms, TBT ${Math.round(measured.tbt)} ms (${observedTimings(report)})`,
      );
    }

    const fcp = median(runs.map((run) => run.fcp));
    const lcp = median(runs.map((run) => run.lcp));
    const tbt = median(runs.map((run) => run.tbt));

    const failures: string[] = [];

    if (fcp > FCP_BUDGET) {
      failures.push(`median FCP ${Math.round(fcp)} ms exceeds budget of ${FCP_BUDGET} ms`);
    }

    if (lcp > LCP_BUDGET) {
      failures.push(`median LCP ${Math.round(lcp)} ms exceeds budget of ${LCP_BUDGET} ms`);
    }

    if (renderBlocking.size > 0) {
      failures.push(`render-blocking requests before first paint: ${[...renderBlocking].join(", ")}`);
    }

    if (tbt > TBT_BUDGET) {
      failures.push(`median TBT ${Math.round(tbt)} ms exceeds budget of ${TBT_BUDGET} ms`);
    }

    return { url: targetUrl, fcp, lcp, tbt, renderBlocking: [...renderBlocking], failures };
  };

  try {
    const results: AuditResult[] = [];

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

    if (plantRenderBlocking) {
      const caught = results.every((result) =>
        result.renderBlocking.some((url) => new URL(url).pathname === plantedStylesheet),
      );

      if (!caught) {
        console.error(`\n❌ Positive control failed: the gate did not flag ${plantedStylesheet}`);
        process.exit(1);
      }

      console.log(`\n✅ Positive control: the gate flags the planted render-blocking stylesheet`);

      return;
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

const reportFailure = (failure: unknown): void => {
  console.error("Error running Lighthouse gate:", failure);
  process.exit(1);
};

main().catch(reportFailure);
