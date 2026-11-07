import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

/**
 * Submission Worker: every log channel Alchemy exposes is switched off.
 * Props used (recorded in RESULTS.md):
 *   observability: { enabled: false, logs: { enabled: false, invocationLogs: false, persist: false },
 *                    traces: { enabled: false, persist: false } }
 *   logpush: false
 *   tailConsumers: [] and streamingTailConsumers: []
 */
export default class SubmissionWorker extends Cloudflare.Worker<SubmissionWorker>()(
  "Submission",
  {
    main: import.meta.url,
    observability: {
      enabled: false,
      logs: { enabled: false, invocationLogs: false, persist: false },
      traces: { enabled: false, persist: false },
    },
    logpush: false,
    tailConsumers: [],
    streamingTailConsumers: [],
  },
  Effect.succeed({
    fetch: Effect.gen(function* () {
      const request = yield* HttpServerRequest;
      const path = request.url.split("?")[0];
      if (path === "/submit" && request.method === "POST") {
        // Deliberately does not log anything and does not echo the body.
        return yield* HttpServerResponse.json({ ok: true }, { status: 202 });
      }
      return yield* HttpServerResponse.json({ error: "not found" }, { status: 404 });
    }),
  }),
) {}
