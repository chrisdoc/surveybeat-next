import * as Cloudflare from "@alchemy.run/cloudflare";
import { MainWorker, SubmissionWorker } from "@surveybeat/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "SurveybeatE2E",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const main = yield* MainWorker;
    const submission = yield* SubmissionWorker;
    return { mainUrl: main.url.as<string>(), submissionUrl: submission.url.as<string>() };
  }),
);
