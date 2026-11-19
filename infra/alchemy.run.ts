// @effect-diagnostics anyUnknownInErrorContext:off -- the ConfigProvider layer's failure channel is unknown in effect 4.1.2; the stack entry cannot narrow what it does not handle.

import * as Cloudflare from "@alchemy.run/cloudflare";
import { SurveyBeatApi } from "@surveybeat/api";
import { Database, MainWorker, ProductionEmail, SiteWorker, SubmissionWorker } from "@surveybeat/cloudflare";
import * as Alchemy from "alchemy";
import * as Secrets from "alchemy/Secrets";
import { Stack } from "alchemy/Stack";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import { readAllowlistForStage } from "./orgCreationAllowlist.ts";

export default Alchemy.Stack(
  "Surveybeat",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),

    secrets: ({ stage }) => [
      Secrets.DotEnv(),
      Secrets.ProcessEnv(),
      ConfigProvider.layerAdd(
        ConfigProvider.fromEnv({ env: { ORG_CREATION_ALLOWLIST: readAllowlistForStage(stage) } }),
        { asPrimary: true },
      ),
    ],
  },
  Effect.gen(function* () {
    const { stage } = yield* Stack;

    if ((stage === "production" || stage === "staging") && "organizations" in SurveyBeatApi.groups) {
      throw new Error(
        "Deploy guard failed: unauthenticated OrganizationsApiGroup must not be registered in staging or production.",
      );
    }

    const database = yield* Database;
    const main = yield* MainWorker;
    const submission = yield* SubmissionWorker;
    const site = yield* SiteWorker;

    const sending = yield* ProductionEmail;
    return {
      databaseId: database.databaseId,
      mainUrl: main.url.as<string>(),
      submissionUrl: submission.url.as<string>(),
      siteUrl: site.url.as<string>(),
      ...(sending === undefined ? {} : { sendingDomainEnabled: sending.enabled }),
    };
  }),
);
