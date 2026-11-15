import * as Cloudflare from "@alchemy.run/cloudflare";
import { Stack } from "alchemy/Stack";
import { Layer } from "effect";
import * as Effect from "effect/Effect";
import { Database } from "./Database.ts";
import { hostnameFor } from "./Hostnames.ts";
import Organization from "./Organization.ts";
import { submissionRoutes } from "./SubmissionRoutes.ts";

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
    const organizations = yield* Organization;
    const database = yield* Cloudflare.D1.QueryDatabase(yield* Database);

    return {
      fetch: submissionRoutes(organizations, database),
    };
  }).pipe(Effect.provide(Layer.mergeAll(Cloudflare.D1.QueryDatabaseBinding))),
) {}
