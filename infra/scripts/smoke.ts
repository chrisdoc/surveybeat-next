/**
 * Smoke test for a deployed stage: check session and sign-in.
 *
 *   node infra/scripts/smoke.ts https://pr-12.app.surveybeat.app [https://pr-12.submit.surveybeat.app]
 *
 * A new custom hostname needs DNS and a certificate first, so the first request is retried.
 * With `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` set (CI passes the repository secrets), it also
 * checks that the key belongs to the client's WorkOS environment (SurveyBeat Staging for PR stages),
 * since a key from another environment deploys fine and only fails at the first real sign-in.
 */
export {};

const [mainUrl, submissionUrl] = process.argv.slice(2);
if (mainUrl === undefined) {
  console.error("Usage: smoke.ts <main-url> [<submission-url>]");
  process.exit(2);
}

const ATTEMPTS = 120;
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
    console.log(
      `${init?.method ?? "GET"} ${url}: ${last}, retrying (${attempt}/${ATTEMPTS}; for new hostnames, delays are usually TLS certificate issuance)`,
    );
    await sleep(DELAY_MS);
  }
  throw new Error(`${url} never became ready: ${last} (hint: the cause is usually certificate issuance)`);
};

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// Sign-in: the Worker can read its WorkOS secrets (an unauthenticated session check answers 401,
// not 500), and retrying covers initial edge/certificate issuance convergence.
const session = await request(`${mainUrl}/auth/session`);
if (session.status !== 401) fail(`GET /auth/session without a cookie answered ${session.status}`);
console.log(`GET /auth/session -> 401 (OK)`);

const login = await fetch(`${mainUrl}/auth/login`, { redirect: "manual" });
const authorize = login.headers.get("location");
if (login.status !== 302 || authorize === null) fail(`GET /auth/login answered ${login.status}`);
const authorizeUrl = new URL(authorize);
if (authorizeUrl.searchParams.get("redirect_uri") !== `${mainUrl}/auth/callback`) {
  fail(`the login redirect asks for redirect_uri ${authorizeUrl.searchParams.get("redirect_uri")}`);
}
const hosted = (await fetch(authorizeUrl, { redirect: "manual" })).headers.get("location") ?? "";
const hostedUrl = URL.canParse(hosted) ? new URL(hosted) : undefined;
if (
  hostedUrl === undefined ||
  !hostedUrl.hostname.endsWith(".authkit.app") ||
  hostedUrl.pathname !== "/bootstrap"
) {
  fail(`WorkOS did not accept the authorization URL: it redirected to ${hosted || "nothing"}`);
}
console.log(`GET /auth/login -> ${hostedUrl.origin}`);

const apiKey = process.env["WORKOS_API_KEY"];
const clientId = process.env["WORKOS_CLIENT_ID"];
if (apiKey !== undefined && apiKey !== "" && clientId !== undefined && clientId !== "") {
  // A made-up code: the right key gets `invalid_grant`, a key from another environment `invalid_client`.
  const exchange = await fetch("https://api.workos.com/user_management/authenticate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: apiKey,
      grant_type: "authorization_code",
      code: "smoke-test-not-a-code",
    }),
  });
  const answer: unknown = await exchange.json();
  const error = typeof answer === "object" && answer !== null && "error" in answer ? answer.error : undefined;
  if (error === "invalid_client")
    fail("WORKOS_API_KEY does not belong to the environment of WORKOS_CLIENT_ID");
  if (error !== "invalid_grant")
    fail(`the WorkOS key check answered ${exchange.status} ${JSON.stringify(answer)}`);
  console.log("WORKOS_API_KEY belongs to the client's environment");
}

if (submissionUrl !== undefined) {
  const submitted = await request(`${submissionUrl}/submit`, { method: "POST", body: "{}" });
  if (submitted.status !== 202) fail(`POST /submit answered ${submitted.status}`);
  console.log("POST /submit -> 202");
}
console.log("OK");
