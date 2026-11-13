// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import { SqliteClient } from "@effect/sql-sqlite-do";
import { assert, describe, it } from "@effect/vitest";
import { EmailAddress, PersonId, type SendStoreShape } from "@surveybeat/domain";
import { SqliteStorage } from "@surveybeat/testing";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { makeSqlDirectory } from "./SqlDirectory.ts";

const migrationsDir = new URL("../migrations/", import.meta.url);

/** The Organization object's directory tables on the real migrations, with one Organization. */
const directory = () =>
  Effect.gen(function* () {
    const db = new DatabaseSync(":memory:");
    for (const file of readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      db.exec(readFileSync(new URL(file, migrationsDir), "utf8"));
    }
    db.prepare("INSERT INTO organization (id, name) VALUES ('org-1', 'Acme')").run();
    const sql = yield* SqliteClient.make({
      storage: SqliteStorage.makeSqliteStorage(db) as unknown as NonNullable<
        Parameters<typeof SqliteClient.make>[0]["storage"]
      >,
    }).pipe(Effect.provideService(Scope.Scope, yield* Scope.make()), Effect.provide(Reactivity.layer));
    // Emails are not sent by these changes, so the send store is never reached.
    const sends = { create: () => Effect.void } as unknown as SendStoreShape;
    return makeSqlDirectory(sql, sends);
  });

const ada = PersonId.make("ada");

describe("the Organization's directory tables (ADR 0018)", () => {
  it.effect("loads the Organization's default language, English until it is changed", () =>
    Effect.gen(function* () {
      const store = yield* directory();
      assert.strictEqual((yield* store.load).defaultLocale, "en");
      yield* store.apply([
        {
          _tag: "SettingsUpdated",
          minimumGroupSize: 4,
          aiProcessing: false,
          defaultLocale: "de",
        },
      ]);
      assert.strictEqual((yield* store.load).defaultLocale, "de");
    }),
  );

  it.effect("stores a Person's own language and the browser language, and clears the own one", () =>
    Effect.gen(function* () {
      const store = yield* directory();
      yield* store.apply([
        {
          _tag: "PersonAdded",
          person: {
            id: ada,
            email: EmailAddress.make("ada@example.com"),
            workosUserId: null,
            organizationAdmin: false,
            removedAt: null,
            locale: null,
            detectedLocale: null,
          },
        },
      ]);
      assert.deepStrictEqual(
        (yield* store.load).people.map((person) => [person.locale, person.detectedLocale]),
        [[null, null]],
      );

      yield* store.apply([{ _tag: "PersonLanguageSet", personId: ada, locale: "de", detectedLocale: "en" }]);
      const [loaded] = (yield* store.load).people;
      assert.deepStrictEqual([loaded?.locale, loaded?.detectedLocale], ["de", "en"]);

      yield* store.apply([{ _tag: "PersonLanguageSet", personId: ada, locale: null, detectedLocale: "en" }]);
      const [cleared] = (yield* store.load).people;
      assert.deepStrictEqual([cleared?.locale, cleared?.detectedLocale], [null, "en"]);
    }),
  );
});
