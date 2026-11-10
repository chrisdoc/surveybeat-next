import { assert, describe, it } from "@effect/vitest";
import { SurveyBeatApi } from "./index.ts";

describe("SurveyBeatApi", () => {
  it("declares the core product groups", () => {
    const groupNames = Object.keys(SurveyBeatApi.groups);
    assert.deepStrictEqual(groupNames.sort(), ["actions", "auth", "directory", "notes", "pulses", "rounds"]);
  });

  it("does not expose unauthenticated organizations group", () => {
    assert.isFalse("organizations" in SurveyBeatApi.groups);
  });
});
