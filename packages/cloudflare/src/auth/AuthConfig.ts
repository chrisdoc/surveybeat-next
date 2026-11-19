import { OrganizationCreationAllowlist } from "@surveybeat/domain";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export const authBindings = Effect.gen(function* () {
  return {
    ORG_CREATION_ALLOWLIST: Config.Redacted("ORG_CREATION_ALLOWLIST"),
    INVITATION_TOKEN_KEY: yield* Alchemy.makeRandom("InvitationTokenKey", { bytes: 32 }),
  };
});

export const authSettings = Effect.gen(function* () {
  const allowlist = new OrganizationCreationAllowlist(
    Redacted.value(yield* Config.Redacted("ORG_CREATION_ALLOWLIST")),
  );

  return { allowlist };
}).pipe(Effect.orDie);
