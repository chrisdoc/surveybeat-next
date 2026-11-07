import { assert, describe, it } from "@effect/vitest";
import { HttpApi } from "effect/http-api";
import { SurveyBeatApi } from "./index.ts";
import { privacyRegistry } from "./PrivacyRegistry.ts";

/** Every endpoint of the runtime declaration, as `group.endpoint`. */
const declaredEndpoints = (): ReadonlyArray<string> => {
  const keys: Array<string> = [];
  HttpApi.reflect(SurveyBeatApi, {
    onGroup: () => {},
    onEndpoint: ({ group, endpoint }) => keys.push(`${group.identifier}.${endpoint.identifier}`),
  });
  return keys;
};

describe("privacy registry", () => {
  it("classifies every endpoint of SurveyBeatApi", () => {
    const unlisted = declaredEndpoints().filter((key) => !Object.hasOwn(privacyRegistry, key));
    assert.deepStrictEqual(unlisted, [], "add these endpoints to privacyRegistry in PrivacyRegistry.ts");
  });

  it("lists no endpoint that the declaration does not have", () => {
    const declared = new Set(declaredEndpoints());
    const stale = Object.keys(privacyRegistry).filter((key) => !declared.has(key));
    assert.deepStrictEqual(stale, []);
  });

  it("enumerates the declaration, so the checks above are not vacuous", () => {
    assert.include(declaredEndpoints(), "organizations.create");
  });
});
