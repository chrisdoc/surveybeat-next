import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { hostnameFor } from "./Hostnames.ts";
import { Stack } from "alchemy/Stack";

/**
 * The Submission Worker (ADR 0005). Every log channel is switched off, because Alchemy turns
 * observability on when the prop is omitted. `infra/scripts/check-observability.ts` reads the
 * deployed settings back, since Alchemy has not applied `invocationLogs` and `persist` in the past.
 */
export default class SubmissionWorker extends Cloudflare.Worker<SubmissionWorker>()(
  "Submission",
  Effect.gen(function* () {
    const stack = yield* Stack;
    const hostname = hostnameFor(stack.stage, "submit");
    return {
      main: import.meta.url,
      observability: {
        enabled: false,
        logs: { enabled: false, invocationLogs: false, persist: false },
        traces: { enabled: false, persist: false },
      },
      logpush: false,
      tailConsumers: [],
      streamingTailConsumers: [],
      ...(hostname === undefined ? {} : { domain: hostname }),
    };
  }),
  Effect.succeed({
    fetch: Effect.gen(function* () {
      const request = yield* HttpServerRequest;
      const path = request.url.split("?")[0];
      if (path === "/submit" && request.method === "POST") {
        // Deliberately logs nothing and never reads the body.
        return yield* HttpServerResponse.json({ ok: true }, { status: 202 });
      }
      return yield* HttpServerResponse.json({ error: "not found" }, { status: 404 });
    }),
  }),
) {}
