import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Organization } from "./Organization.ts";

describe("Organization", () => {
  it.effect("decodes a valid Organization", () =>
    Effect.gen(function* () {
      const organization = yield* Schema.decodeEffect(Organization)({
        id: "org-1",
        name: "Acme",
      });
      expect(organization.name).toBe("Acme");
    }),
  );

  it.effect("rejects an empty name", () =>
    Effect.gen(function* () {
      const failure = yield* Schema.decodeEffect(Organization)({
        id: "org-1",
        name: "",
      }).pipe(Effect.flip);
      expect(failure._tag).toBe("SchemaError");
    }),
  );
});
