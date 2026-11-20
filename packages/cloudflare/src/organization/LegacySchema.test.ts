import { SqliteClient } from "@effect/sql-sqlite-do";
import { assert, describe, it } from "@effect/vitest";
import { defaultSendPolicy, makeSendStore } from "@surveybeat/domain";
import { migratedDatabase, SqliteStorage } from "@surveybeat/testing";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { makeSqlDirectory } from "../SqlDirectory.ts";
import { makeSqlSendRepository } from "../SqlSendRepository.ts";
import { needsPersonColumnRename, renameLegacyPersonColumn } from "./LegacySchema.ts";

const migrationsDir = new URL("../../migrations/", import.meta.url);

// An Organization object created before #200 applied the original 0003_person.sql, whose column is
// `workos_user_id`. #200 renamed it inside 0003, which the migration ledger never re-runs, so such an
// object still has the old name. Production's Organization is one of these.
const legacyDatabase = () => {
  const db = migratedDatabase(migrationsDir);
  db.exec("ALTER TABLE person RENAME COLUMN auth_user_id TO workos_user_id");
  db.exec(`
    INSERT INTO organization (id, name) VALUES ('org-1', 'Acme');
    INSERT INTO person (id, email, workos_user_id, organization_admin) VALUES ('p-1', 'lead@example.com', 'user-1', 1);
  `);

  return db;
};

const clientFor = (db: ReturnType<typeof migratedDatabase>) =>
  Effect.gen(function* () {
    return yield* SqliteClient.make({
      storage: SqliteStorage.makeSqliteStorage(db) as unknown as NonNullable<
        Parameters<typeof SqliteClient.make>[0]["storage"]
      >,
    }).pipe(Effect.provideService(Scope.Scope, yield* Scope.make()), Effect.provide(Reactivity.layer));
  });

const columnsOf = (db: ReturnType<typeof migratedDatabase>) =>
  db
    .prepare("SELECT name FROM pragma_table_info('person')")
    .all()
    .map((row) => String(row.name));

describe("needsPersonColumnRename", () => {
  it("is true only for the pre-#200 column set", () => {
    assert.isTrue(needsPersonColumnRename(["id", "email", "workos_user_id"]));
    assert.isFalse(needsPersonColumnRename(["id", "email", "auth_user_id"]));
    assert.isFalse(needsPersonColumnRename(["id", "email", "workos_user_id", "auth_user_id"]));
  });
});

describe("renameLegacyPersonColumn", () => {
  it.effect("renames workos_user_id on an object made before #200, keeping the link and its uniqueness", () =>
    Effect.gen(function* () {
      const db = legacyDatabase();
      const sql = yield* clientFor(db);

      const renamed = yield* renameLegacyPersonColumn(sql);

      assert.isTrue(renamed);
      assert.include(columnsOf(db), "auth_user_id");
      assert.notInclude(columnsOf(db), "workos_user_id");
      assert.deepStrictEqual(db.prepare("SELECT auth_user_id FROM person WHERE id = 'p-1'").get(), {
        auth_user_id: "user-1",
      });
      assert.throws(() =>
        db.exec("INSERT INTO person (id, email, auth_user_id) VALUES ('p-2', 'other@example.com', 'user-1')"),
      );
    }),
  );

  it.effect("lets the directory load People again on that object", () =>
    Effect.gen(function* () {
      const db = legacyDatabase();
      const sql = yield* clientFor(db);
      const directory = makeSqlDirectory(sql, makeSendStore(makeSqlSendRepository(sql), defaultSendPolicy));

      const before = yield* Effect.exit(directory.load);
      yield* renameLegacyPersonColumn(sql);
      const after = yield* directory.load;

      assert.isTrue(before._tag === "Failure");
      assert.deepStrictEqual(
        after.people.map((person): [string, string | null] => [person.id, person.authUserId]),
        [["p-1", "user-1"]],
      );
    }),
  );

  it.effect("leaves an object made from the current migrations alone, and is idempotent", () =>
    Effect.gen(function* () {
      const db = migratedDatabase(migrationsDir);
      const sql = yield* clientFor(db);

      assert.isFalse(yield* renameLegacyPersonColumn(sql));
      assert.include(columnsOf(db), "auth_user_id");

      const legacy = legacyDatabase();
      const legacySql = yield* clientFor(legacy);
      assert.isTrue(yield* renameLegacyPersonColumn(legacySql));
      assert.isFalse(yield* renameLegacyPersonColumn(legacySql));
    }),
  );
});
