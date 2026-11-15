// @effect-diagnostics asyncFunction:off -- a standalone Node script: it reports to the shell and never builds an Effect program.
// @effect-diagnostics globalConsole:off -- the script writes its report to stdout/stderr; it never runs an Effect program.
// @effect-diagnostics globalFetch:off -- the script calls the deployed stage over the platform fetch; there is no HttpClient outside a Worker.
// @effect-diagnostics globalTimers:off -- a plain setTimeout in a script that has no Effect runtime.
// @effect-diagnostics newPromise:off -- the script waits on a child process or a timeout with a plain Promise; there is no Effect runtime in it.

export {};

const [mainUrl, submissionUrl] = process.argv.slice(2);
if (mainUrl === undefined) {
  console.error("Usage: smoke.ts <main-url> [<submission-url>]");
  process.exit(2);
}

const ATTEMPTS = 120;
const DELAY_MS = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const session = await request(`${mainUrl}/auth/session`);
if (session.status !== 401) fail(`GET /auth/session without a cookie answered ${session.status}`);
console.log(`GET /auth/session -> 401 (OK)`);

const login = await fetch(`${mainUrl}/auth/login`, { redirect: "manual" });
if (login.status !== 302 || login.headers.get("location") !== `${mainUrl}/`) {
  fail(`GET /auth/login answered ${login.status} -> ${login.headers.get("location") ?? "nothing"}`);
}
console.log(`GET /auth/login -> ${mainUrl}/ (OK)`);

const form = await request(`${mainUrl}/`);
if (form.status !== 200) fail(`GET / answered ${form.status}`);
if (!(form.headers.get("content-type") ?? "").includes("text/html")) {
  fail(`GET / serves ${form.headers.get("content-type") ?? "no content type"}`);
}
console.log(`GET / -> 200 text/html (OK)`);

if (submissionUrl !== undefined) {
  const submitted = await request(`${submissionUrl}/submit`, { method: "POST", body: "{}" });
  if (submitted.status !== 202) fail(`POST /submit answered ${submitted.status}`);
  console.log("POST /submit -> 202");
}
console.log("OK");
