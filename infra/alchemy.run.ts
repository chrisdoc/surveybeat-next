import * as Cloudflare from "@alchemy.run/cloudflare";
import { SurveyBeatApi } from "@surveybeat/api";
import { Database, MainWorker, ProductionEmail, SubmissionWorker } from "@surveybeat/cloudflare";
import * as Alchemy from "alchemy";
import * as Secrets from "alchemy/Secrets";
import { Stack } from "alchemy/Stack";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import { readAllowlistForStage } from "./orgCreationAllowlist.ts";

/**
 * One stack per stage: `pr-<n>` for every pull request, later `staging` and `production`.
 * State lives in the Cloudflare state store, so CI and laptops see the same stages.
 */
export default Alchemy.Stack(
  "Surveybeat",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
    // The Alchemy defaults (`.env`, then the shell) plus the stage's Organization creation
    // allowlist from `infra/org-creation-allowlist.yaml`, which wins over both: the file is the
    // only place that decides who may create an Organization (ADR 0002).
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
    // Guard against unauthenticated walking-skeleton endpoints in staging and production
    if (stage === "production" || stage === "staging") {
      if ("organizations" in SurveyBeatApi.groups) {
        throw new Error(
          "Deploy guard failed: unauthenticated OrganizationsApiGroup must not be registered in staging or production.",
        );
      }
    }

    const database = yield* Database;
    const main = yield* MainWorker;
    const submission = yield* SubmissionWorker;
    // Production only. PR and personal stages send no real email (docs/infra.md).
    const sending = yield* ProductionEmail;
    return {
      databaseId: database.databaseId,
      mainUrl: main.url.as<string>(),
      submissionUrl: submission.url.as<string>(),
      ...(sending === undefined ? {} : { sendingDomainEnabled: sending.enabled }),
    };
  }),
);
