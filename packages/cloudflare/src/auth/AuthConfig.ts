import { OrganizationCreationAllowlist } from "@surveybeat/domain";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import type { WorkosConfig } from "./WorkosIdentityProvider.ts";

/**
 * The Main Worker's sign-in bindings, declared on its `env`. The three WorkOS values are read at
 * deploy time from the environment (GitHub secrets in CI: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`,
 * `ORG_CREATION_ALLOWLIST`) and bound as Worker secrets. The cookie password is generated per
 * stage by Alchemy and kept in its state, so it survives redeploys and differs between stages.
 */
export const authBindings = Effect.gen(function* () {
  return {
    WORKOS_API_KEY: Config.Redacted("WORKOS_API_KEY"),
    WORKOS_CLIENT_ID: Config.Redacted("WORKOS_CLIENT_ID"),
    ORG_CREATION_ALLOWLIST: Config.Redacted("ORG_CREATION_ALLOWLIST"),
    WORKOS_COOKIE_PASSWORD: yield* Alchemy.makeRandom("SessionCookiePassword", { bytes: 32 }),
  };
});

/** Reads the bindings back inside a request. A missing or short value is a deploy bug, so it dies. */
export const authSettings = Effect.gen(function* () {
  const workos: WorkosConfig = {
    apiKey: yield* Config.Redacted("WORKOS_API_KEY"),
    clientId: Redacted.value(yield* Config.Redacted("WORKOS_CLIENT_ID")),
    cookiePassword: yield* Config.Redacted("WORKOS_COOKIE_PASSWORD"),
  };
  if (Redacted.value(workos.cookiePassword).length < 32) {
    return yield* Effect.die("WORKOS_COOKIE_PASSWORD must be at least 32 characters");
  }
  const allowlist = new OrganizationCreationAllowlist(
    Redacted.value(yield* Config.Redacted("ORG_CREATION_ALLOWLIST")),
  );
  return { workos, allowlist };
}).pipe(Effect.orDie);
