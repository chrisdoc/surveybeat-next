/**
 * Smoke test for a deployed stage: create an Organization and read it back.
 *
 *   node infra/scripts/smoke.ts https://pr-12.app.surveybeat.app [https://pr-12.submit.surveybeat.app]
 *
 * A new custom hostname needs DNS and a certificate first, so the first request is retried.
 */
export {};

const [mainUrl, submissionUrl] = process.argv.slice(2);
if (mainUrl === undefined) {
  console.error("Usage: smoke.ts <main-url> [<submission-url>]");
  process.exit(2);
}

const ATTEMPTS = 40;
const DELAY_MS = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries network errors and 5xx/404 (the edge has not converged yet), returns anything else. */
const request = async (url: string, init?: RequestInit): Promise<Response> => {
  let last = "no attempt";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.status !== 404 && response.status < 500) return response;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    console.log(`${init?.method ?? "GET"} ${url}: ${last}, retrying (${attempt}/${ATTEMPTS})`);
    await sleep(DELAY_MS);
  }
  throw new Error(`${url} never became ready: ${last}`);
};

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const created = await request(`${mainUrl}/orgs`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Smoke test" }),
});
if (created.status !== 200) fail(`POST /orgs answered ${created.status}`);
const organization: unknown = await created.json();
const id =
  typeof organization === "object" && organization !== null && "id" in organization
    ? organization.id
    : undefined;
if (typeof id !== "string") fail("POST /orgs returned no id");
console.log(`POST /orgs -> ${id}`);

const fetched = await request(`${mainUrl}/orgs/${id}`);
if (fetched.status !== 200) fail(`GET /orgs/${id} answered ${fetched.status}`);
const body: unknown = await fetched.json();
if (JSON.stringify(body) !== JSON.stringify(organization)) fail("GET /orgs/:id differs from POST");
console.log(`GET /orgs/${id} -> ${JSON.stringify(body)}`);

// The stage is ready by now, so a 404 here is the answer, not the edge catching up.
const missing = await fetch(`${mainUrl}/orgs/${"0".repeat(32)}`);
if (missing.status !== 404) fail(`GET of an unknown id answered ${missing.status}`);

if (submissionUrl !== undefined) {
  const submitted = await request(`${submissionUrl}/submit`, { method: "POST", body: "{}" });
  if (submitted.status !== 202) fail(`POST /submit answered ${submitted.status}`);
  console.log("POST /submit -> 202");
}
console.log("OK");
