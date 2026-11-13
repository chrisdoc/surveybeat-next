import { assert, describe, it } from "@effect/vitest";
import { allowlistForStage, readAllowlistForStage } from "./orgCreationAllowlist.ts";

const file = `
production:
  - owner@example.com
  - second@example.com
default:
  - dev@example.com
`;

describe("allowlistForStage", () => {
  it("joins the stage's own emails", () => {
    assert.strictEqual(allowlistForStage(file, "production"), "owner@example.com,second@example.com");
  });

  it("falls back to default for a stage without an entry", () => {
    assert.strictEqual(allowlistForStage(file, "pr-74"), "dev@example.com");
  });

  it("refuses a stage with neither its own entry nor default", () => {
    assert.throws(() => allowlistForStage("production:\n  - owner@example.com\n", "staging"), /no entry/);
  });

  it("refuses an empty list", () => {
    assert.throws(() => allowlistForStage("production: []\ndefault:\n  - dev@example.com\n", "production"));
  });

  it("refuses something that is not an email", () => {
    assert.throws(() => allowlistForStage("default:\n  - not-an-email\n", "pr-1"));
  });

  it("reads the checked-in file for every deployed stage", () => {
    for (const stage of ["production", "staging", "pr-1", "dev-someone"]) {
      assert.notStrictEqual(readAllowlistForStage(stage), "");
    }
  });
});
