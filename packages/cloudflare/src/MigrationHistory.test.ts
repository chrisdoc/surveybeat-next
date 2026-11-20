import { assert, describe, it } from "@effect/vitest";
import { migrationHistoryDrift } from "@surveybeat/testing";

// The Durable Object and D1 ledgers record each migration by name and never run it again, so a file
// edited after it was applied changes only fresh databases. #200 renamed person.workos_user_id inside
// 0003_person.sql; production kept the old column and every Round job failed on 2026-11-20.
describe("migration history", () => {
  for (const directory of ["migrations", "d1-migrations"]) {
    it(`${directory}: every applied migration is unchanged, and new ones are locked`, () => {
      assert.deepStrictEqual(
        migrationHistoryDrift(
          new URL(`../${directory}/`, import.meta.url),
          new URL(`../${directory}.lock.json`, import.meta.url),
        ),
        [],
      );
    });
  }
});
