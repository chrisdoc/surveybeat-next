import * as Cloudflare from "@alchemy.run/cloudflare";
import { Stack } from "alchemy/Stack";
import { Layer } from "effect";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Database } from "./Database.ts";
import { hostnameFor } from "./Hostnames.ts";
import { corsHeaders } from "./SubmissionRoutes.ts";

export const submissionsPaused = Effect.gen(function* () {
  const request = yield* HttpServerRequest;
  if (request.method === "OPTIONS") {
    return HttpServerResponse.empty({ status: 204, headers: corsHeaders });
  }
  if (request.method === "POST" && request.url.split("?")[0] === "/submit") {
    return yield* HttpServerResponse.json({ ok: true }, { status: 202, headers: corsHeaders });
  }
  return yield* HttpServerResponse.json(
    { error: "Submissions are paused while the Organization binding moves" },
    { status: 503, headers: corsHeaders },
  );
}).pipe(Effect.orDie);

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
  Effect.gen(function* () {
    yield* Cloudflare.D1.QueryDatabase(yield* Database);

    return {
      fetch: submissionsPaused,
    };
  }).pipe(Effect.provide(Layer.mergeAll(Cloudflare.D1.QueryDatabaseBinding))),
) {}
