import { OrganizationCreationAllowlist } from "@surveybeat/domain";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import type { WorkosConfig } from "./WorkosIdentityProvider.ts";

export const authBindings = Effect.gen(function* () {
  return {
    WORKOS_API_KEY: Config.Redacted("WORKOS_API_KEY"),
    WORKOS_CLIENT_ID: Config.Redacted("WORKOS_CLIENT_ID"),
    ORG_CREATION_ALLOWLIST: Config.Redacted("ORG_CREATION_ALLOWLIST"),
    WORKOS_COOKIE_PASSWORD: yield* Alchemy.makeRandom("SessionCookiePassword", { bytes: 32 }),
    INVITATION_TOKEN_KEY: yield* Alchemy.makeRandom("InvitationTokenKey", { bytes: 32 }),
  };
});

export const WORKOS_REQUEST_TIMEOUT = Duration.seconds(5);

export const authSettings = Effect.gen(function* () {
  const workos: WorkosConfig = {
    apiKey: yield* Config.Redacted("WORKOS_API_KEY"),
    clientId: Redacted.value(yield* Config.Redacted("WORKOS_CLIENT_ID")),
    cookiePassword: yield* Config.Redacted("WORKOS_COOKIE_PASSWORD"),
    requestTimeout: WORKOS_REQUEST_TIMEOUT,
  };
  if (Redacted.value(workos.cookiePassword).length < 32) {
    return yield* Effect.die("WORKOS_COOKIE_PASSWORD must be at least 32 characters");
  }
  const allowlist = new OrganizationCreationAllowlist(
    Redacted.value(yield* Config.Redacted("ORG_CREATION_ALLOWLIST")),
  );
  return { workos, allowlist };
}).pipe(Effect.orDie);
