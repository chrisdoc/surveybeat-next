import * as Cloudflare from "@alchemy.run/cloudflare";
import { MainWorker } from "@surveybeat/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "SurveybeatE2E",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const main = yield* MainWorker;
    return { mainUrl: main.url.as<string>() };
  }),
);
