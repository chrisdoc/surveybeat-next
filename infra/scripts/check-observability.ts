// @effect-diagnostics asyncFunction:off -- a standalone Node script: it reports to the shell and never builds an Effect program.
// @effect-diagnostics globalConsole:off -- the script writes its report to stdout/stderr; it never runs an Effect program.
// @effect-diagnostics globalFetch:off -- the script calls the deployed stage over the platform fetch; there is no HttpClient outside a Worker.

/**
 * Deployed-settings read-back for the Submission Worker (ADR 0005).
 *
 *   node infra/scripts/check-observability.ts --stage pr-12
 *
 * Reads the Worker's settings from the Cloudflare API and exits 1 if any log channel is on or a
 * tail consumer is attached. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
 *
 * Alchemy tags every Worker with its stack, stage and logical id, so the Worker is found by tag
 * and nothing has to be parsed out of the deploy output.
 *
 * `logs.invocation_logs` and `persist` (also `traces.persist`) cannot be switched off over the API
 * while their channel is disabled: Cloudflare reports `true` whatever is sent (checked with the
 * Worker script-settings and Workers PATCH endpoints, 2026-11-07). They log nothing then, so they
 * count only when their channel is enabled, and they are always printed.
 */
import * as Schema from "effect/Schema";

const Flag = Schema.optional(Schema.NullOr(Schema.Boolean));

const WorkerSettings = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  logpush: Flag,
  tail_consumers: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
  observability: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        enabled: Flag,
        logs: Schema.optional(
          Schema.NullOr(Schema.Struct({ enabled: Flag, invocation_logs: Flag, persist: Flag })),
        ),
        traces: Schema.optional(Schema.NullOr(Schema.Struct({ enabled: Flag, persist: Flag }))),
      }),
    ),
  ),
});
export type WorkerSettings = typeof WorkerSettings.Type;

const Page = Schema.Struct({
  result: Schema.Array(WorkerSettings),
  result_info: Schema.optional(Schema.Struct({ total_pages: Schema.optional(Schema.Finite) })),
});
const One = Schema.Struct({ result: WorkerSettings });

/** What is wrong with the Worker's deployed settings. Empty means every log channel is off. */
export const findViolations = (worker: WorkerSettings): string[] => {
  const observability = worker.observability;
  const logs = observability?.logs;
  const traces = observability?.traces;
  const found: string[] = [];
  if (observability?.enabled === true) found.push("observability.enabled is on");
  if (logs?.enabled === true) found.push("observability.logs.enabled is on");
  if (logs?.enabled === true && logs.invocation_logs === true)
    found.push("observability.logs.invocation_logs is on");
  if (logs?.enabled === true && logs.persist === true) found.push("observability.logs.persist is on");
  if (traces?.enabled === true) found.push("observability.traces.enabled is on");
  if (traces?.enabled === true && traces.persist === true) found.push("observability.traces.persist is on");
  if (worker.logpush === true) found.push("logpush is on");
  if ((worker.tail_consumers?.length ?? 0) > 0) found.push("tail consumers are attached");
  return found;
};

const api = "https://api.cloudflare.com/client/v4";

const get = async (path: string, token: string): Promise<unknown> => {
  const response = await fetch(`${api}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`GET ${path} failed with HTTP ${response.status}`);
  return response.json();
};

/** A Worker of a stage by its id in the stack (e.g. `Submission`), found by the tags Alchemy puts on it. */
export const findWorker = async (
  accountId: string,
  token: string,
  stage: string,
  logicalId: string,
): Promise<WorkerSettings> => {
  const wanted = ["alchemy:stack:Surveybeat", `alchemy:stage:${stage}`, `alchemy:id:${logicalId}`];
  for (let page = 1; ; page++) {
    const body = Schema.decodeUnknownSync(Page)(
      await get(`/accounts/${accountId}/workers/workers?per_page=100&page=${page}`, token),
    );
    const match = body.result.find((worker) => wanted.every((tag) => worker.tags?.includes(tag)));
    if (match !== undefined) {
      // The detail endpoint is the one `cf workers get` reads.
      const detail = await get(`/accounts/${accountId}/workers/workers/${match.id}`, token);
      return Schema.decodeUnknownSync(One)(detail).result;
    }
    if (page >= (body.result_info?.total_pages ?? 1)) {
      throw new Error(`No ${logicalId} Worker found for stage ${stage}`);
    }
  }
};

const main = async (): Promise<number> => {
  const stageFlag = process.argv.indexOf("--stage");
  const stage = stageFlag === -1 ? undefined : process.argv[stageFlag + 1];
  const token = process.env["CLOUDFLARE_API_TOKEN"];
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  if (stage === undefined || token === undefined || accountId === undefined) {
    console.error(
      "Usage: check-observability.ts --stage <stage> (needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID)",
    );
    return 2;
  }
  const worker = await findWorker(accountId, token, stage, "Submission");
  console.log(
    JSON.stringify(
      {
        worker: worker.name ?? worker.id,
        observability: worker.observability,
        logpush: worker.logpush,
        tail_consumers: worker.tail_consumers,
      },
      null,
      2,
    ),
  );
  const violations = findViolations(worker);
  if (violations.length > 0) {
    for (const violation of violations) console.error(`FAIL: ${violation}`);
    return 1;
  }
  console.log("OK: every log channel is off and no tail consumer is attached");
  return 0;
};

if (import.meta.main) {
  process.exitCode = await main();
}
