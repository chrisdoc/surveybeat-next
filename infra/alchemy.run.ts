import * as Cloudflare from "@alchemy.run/cloudflare";
import { Database, MainWorker, SubmissionWorker } from "@surveybeat/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

/**
 * One stack per stage: `pr-<n>` for every pull request, later `staging` and `production`.
 * State lives in the Cloudflare state store, so CI and laptops see the same stages.
 */
export default Alchemy.Stack(
  "Surveybeat",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const database = yield* Database;
    const main = yield* MainWorker;
    const submission = yield* SubmissionWorker;
    return {
      databaseId: database.databaseId,
      mainUrl: main.url.as<string>(),
      submissionUrl: submission.url.as<string>(),
    };
  }),
);
