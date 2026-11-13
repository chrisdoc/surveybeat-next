/**
 * Canary sweep with a positive control (privacy suite design, issue #25 section 3; A7 part b).
 *
 *   node infra/tests/privacy/canary-sweep.ts --stage pr-12 https://pr-12.app.surveybeat.app https://pr-12.submit.surveybeat.app
 *
 * 1. Sends a unique canary to the Main Worker (logs on) and another to the Submission Worker (logs off),
 *    each REQUESTS times, because the account samples Workers Logs (see `observability.ts`).
 * 2. Positive control: polls Workers Logs for up to 10 minutes until the Main Worker's canary is found.
 *    Without this, zero hits for the Submission Worker would prove nothing.
 * 3. Only then: the Submission Worker produced zero events, and its canary appears in no event of any Worker.
 *
 * Today the sweep covers Workers Logs. The other sinks (Analytics Engine, Queue and dead-letter messages,
 * R2 backups, a D1 dump, response bodies) join as the slices that write to them land.
 * Needs CLOUDFLARE_API_TOKEN (Workers Observability read) and CLOUDFLARE_ACCOUNT_ID.
 */
import { findWorker } from "../../scripts/check-observability.ts";
import { type Account, countEvents, usageLimit } from "./observability.ts";

/** At a 1% sample rate, 1000 requests all go unsampled with probability 0.99^1000 ≈ 4e-5. */
const REQUESTS = 1000;
const CONCURRENCY = 25;
const DEADLINE_MS = 10 * 60_000;
const POLL_MS = 20_000;
/** Once Main's canary shows, Submission's events from the same moment have had time to arrive too. */
const SETTLE_MS = 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const canary = (label: string) =>
  `sbcanary${label}${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** Sends `count` requests, `CONCURRENCY` at a time. Returns how many got any HTTP response, by status. */
const send = async (count: number, request: () => Promise<Response>): Promise<Map<number, number>> => {
  const statuses = new Map<number, number>();
  let started = 0;
  const worker = async () => {
    while (started < count) {
      started++;
      try {
        const response = await request();
        await response.body?.cancel();
        statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      } catch {
        // Not delivered: counts against the total below.
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return statuses;
};

const total = (statuses: Map<number, number>) => [...statuses.values()].reduce((a, b) => a + b, 0);

const main = async (): Promise<number> => {
  const args = process.argv.slice(2);
  const stageFlag = args.indexOf("--stage");
  const stage = stageFlag === -1 ? undefined : args[stageFlag + 1];
  const [mainUrl, submissionUrl] = args.filter(
    (_, i) => stageFlag === -1 || (i !== stageFlag && i !== stageFlag + 1),
  );
  const token = process.env["CLOUDFLARE_API_TOKEN"];
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  if (stage === undefined || mainUrl === undefined || submissionUrl === undefined || !token || !accountId) {
    console.error(
      "Usage: canary-sweep.ts --stage <stage> <main-url> <submission-url> (needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID)",
    );
    return 2;
  }
  const account: Account = { accountId, token };
  const mainScript = (await findWorker(accountId, token, stage, "Main")).name;
  const submissionScript = (await findWorker(accountId, token, stage, "Submission")).name;
  if (mainScript === undefined || submissionScript === undefined) {
    console.error("FAIL: the Cloudflare API returned a Worker without a script name");
    return 1;
  }

  const mainCanary = canary("main");
  const submissionCanary = canary("submission");
  const from = Date.now() - 60_000;
  console.log(`Main Worker ${mainScript}, canary ${mainCanary}`);
  console.log(`Submission Worker ${submissionScript}, canary ${submissionCanary}`);

  // An unauthenticated session request with the canary query param hits the Main Worker without waking a Durable Object.
  const mainSent = await send(REQUESTS, () => fetch(`${mainUrl}/auth/session?canary=${mainCanary}`));
  const submissionSent = await send(REQUESTS, () =>
    fetch(`${submissionUrl}/submit?canary=${submissionCanary}`, {
      method: "POST",
      headers: { "x-surveybeat-canary": submissionCanary },
      body: JSON.stringify({ canary: submissionCanary }),
    }),
  );
  console.log(`Main: ${JSON.stringify(Object.fromEntries(mainSent))}`);
  console.log(`Submission: ${JSON.stringify(Object.fromEntries(submissionSent))}`);
  if (total(mainSent) < REQUESTS * 0.99 || (submissionSent.get(202) ?? 0) < REQUESTS * 0.99) {
    console.error(
      "FAIL: too few canary requests reached the Workers for the positive control to be meaningful",
    );
    return 1;
  }

  // Positive control.
  const deadline = Date.now() + DEADLINE_MS;
  for (;;) {
    const found = await countEvents(account, {
      from,
      to: Date.now(),
      service: mainScript,
      needle: mainCanary,
    });
    if (found.count > 0) {
      console.log(`Positive control: ${found.count} sampled Main Worker events carry its canary`);
      break;
    }
    if (Date.now() > deadline) {
      console.error(
        `FAIL: positive control. The Main Worker's canary never appeared in Workers Logs within ${DEADLINE_MS / 60_000} minutes, ` +
          "so the absence of Submission Worker events would prove nothing.",
      );
      console.error(`Account Workers Logs usage limit: ${await usageLimit(account)}`);
      return 1;
    }
    console.log("Main Worker canary not in Workers Logs yet, retrying");
    await sleep(POLL_MS);
  }

  await sleep(SETTLE_MS);
  const to = Date.now();
  const submissionEvents = await countEvents(account, { from, to, service: submissionScript });
  const submissionCanaryHits = await countEvents(account, { from, to, needle: submissionCanary });
  let failed = false;
  if (submissionEvents.count > 0) {
    console.error(`FAIL: the Submission Worker produced ${submissionEvents.count} Workers Logs events`);
    failed = true;
  }
  if (submissionCanaryHits.count > 0) {
    console.error(
      `FAIL: the Submission Worker's canary appears in ${submissionCanaryHits.count} events of ${submissionCanaryHits.services.join(", ")}`,
    );
    failed = true;
  }
  if (failed) return 1;
  console.log(
    "OK: the Submission Worker produced zero events and its canary appears nowhere in Workers Logs",
  );
  return 0;
};

if (import.meta.main) {
  process.exitCode = await main();
}
