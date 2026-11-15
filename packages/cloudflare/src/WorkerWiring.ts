import * as HttpPlatform from "effect/http/HttpPlatform";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PEOPLE_TEST_ROUTE } from "./auth/PeopleTestRoutes.ts";
import { isTestStage, TEST_ROUTES } from "./EmailTestRoutes.ts";
import { PULSES_TEST_ROUTE } from "./PulseTestRoutes.ts";
import { RESEND_EMAIL_TEST_ROUTE } from "./ResendEmailTestRoutes.ts";
import { RESULT_RECOVERY_TEST_ROUTE } from "./ResultRecoveryTestRoutes.ts";
import { REVIEW_TEST_ROUTE } from "./ReviewWindowTestRoutes.ts";
import { ROUNDS_TEST_ROUTE } from "./RoundTestRoutes.ts";
import { TEST_INVITATION_TEST_ROUTE } from "./TestInvitationTestRoutes.ts";
import { THEMES_TEST_ROUTE } from "./ThemesTestRoutes.ts";

export const assetsDirectory = new URL("../../../apps/web/dist", import.meta.url).pathname;

export const randomHex32 = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );

export const httpPlatformStub = Layer.succeed(HttpPlatform.HttpPlatform, {
  platform: "web",
  compression: {
    algorithms: new Set<"gzip">(),
    compressResponse: (response) => Effect.succeed(response),
  },
  fileResponse: () => Effect.die("HttpPlatform.fileResponse not supported"),
  fileWebResponse: () => Effect.die("HttpPlatform.fileWebResponse not supported"),
});

export const mainWorkerAssets = (stage: string) => ({
  directory: assetsDirectory,
  notFoundHandling: "single-page-application" as const,
  runWorkerFirst: [
    "/auth/*",
    "/api/*",
    "/delivery",
    "/delivery/*",
    ...(isTestStage(stage)
      ? [
          TEST_ROUTES,
          PEOPLE_TEST_ROUTE,
          PULSES_TEST_ROUTE,
          ROUNDS_TEST_ROUTE,
          THEMES_TEST_ROUTE,
          REVIEW_TEST_ROUTE,
          RESULT_RECOVERY_TEST_ROUTE,
          TEST_INVITATION_TEST_ROUTE,
          RESEND_EMAIL_TEST_ROUTE,
        ]
      : []),
  ],
});
