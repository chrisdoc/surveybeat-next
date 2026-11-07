import type * as Cloudflare from "@alchemy.run/cloudflare";
import { assert, describe, it } from "@effect/vitest";
import {
  EmailAddress,
  OrganizationId,
  PersonId,
  SessionId,
  WorkosOrganizationId,
  WorkosUserId,
} from "@surveybeat/domain";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { d1PeopleIndex } from "./D1PeopleIndex.ts";

// The D1 adapter's SQL against the real migrations, on Node's SQLite (the engine D1 runs).
const migrations = new URL("../../d1-migrations/", import.meta.url);

const makeIndex = () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrations).sort())
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  const statement = (sql: string, binds: ReadonlyArray<unknown>) => ({
    bind: (...values: ReadonlyArray<unknown>) => statement(sql, values),
    all: () =>
      Effect.sync(() => ({ results: sqlite.prepare(sql).all(...(binds as Array<null | string | number>)) })),
    run: () =>
      Effect.sync(
        () => (sqlite.prepare(sql).run(...(binds as Array<null | string | number>)), { results: [] }),
      ),
  });
  const client = {
    prepare: (sql: string) => statement(sql, []),
  } as unknown as Cloudflare.D1.QueryDatabaseClient;
  return d1PeopleIndex(client).pipe(Effect.provideService(RuntimeContext, {} as RuntimeContext["Service"]));
};

const acme = { id: OrganizationId.make("acme"), name: "Acme" };
const globex = { id: OrganizationId.make("globex"), name: "Globex" };
const ada = WorkosUserId.make("user_ada");

describe("D1 PeopleIndex", () => {
  it.effect("finds unlinked Persons by normalised email, then by user once linked", () =>
    Effect.gen(function* () {
      const index = yield* makeIndex();
      yield* index.putOrganization(acme, Option.some(WorkosOrganizationId.make("org_acme")));
      yield* index.putOrganization(globex, Option.none());
      const person = PersonId.make("p1");
      yield* index.putPerson({
        organizationId: acme.id,
        personId: person,
        email: EmailAddress.make("Ada@Example.com"),
        userId: Option.none(),
      });
      yield* index.putPerson({
        organizationId: globex.id,
        personId: PersonId.make("p2"),
        email: EmailAddress.make("ada@example.com"),
        userId: Option.none(),
      });

      const unlinked = yield* index.unlinkedPersons(EmailAddress.make("ADA@example.com"));
      assert.deepStrictEqual(
        unlinked.map((candidate) => candidate.organization.id),
        [acme.id, globex.id],
      );

      yield* index.linkPerson(acme.id, person, ada);
      // Linking is one-shot: a second user cannot take the Person over.
      yield* index.linkPerson(acme.id, person, WorkosUserId.make("user_mallory"));
      assert.deepStrictEqual(yield* index.linkedPersons(ada), [
        { organization: acme, personId: person, linked: true },
      ]);
      assert.deepStrictEqual(
        (yield* index.unlinkedPersons(EmailAddress.make("ada@example.com"))).map((c) => c.organization.id),
        [globex.id],
      );
    }),
  );

  it.effect("maps WorkOS organizations both ways, and keeps a known WorkOS id when re-put without one", () =>
    Effect.gen(function* () {
      const index = yield* makeIndex();
      const workos = WorkosOrganizationId.make("org_acme");
      yield* index.putOrganization(acme, Option.none());
      assert.isTrue(Option.isNone(yield* index.workosOrganizationOf(acme.id)));
      yield* index.putOrganization(acme, Option.some(workos));
      yield* index.putOrganization(acme, Option.none());
      assert.deepStrictEqual(yield* index.workosOrganizationOf(acme.id), Option.some(workos));
      assert.deepStrictEqual(yield* index.organizationByWorkos(workos), Option.some(acme));
    }),
  );

  it.effect("keeps the first Organization claim of a user", () =>
    Effect.gen(function* () {
      const index = yield* makeIndex();
      const first = { organization: acme, adminPersonId: PersonId.make("admin-1") };
      const second = { organization: globex, adminPersonId: PersonId.make("admin-2") };
      const [a, b] = yield* Effect.all(
        [index.claimOrganization(ada, first), index.claimOrganization(ada, second)],
        {
          concurrency: "unbounded",
        },
      );
      const open = { ...first, completed: false };
      assert.deepStrictEqual(a, open);
      assert.deepStrictEqual(b, open);
      assert.deepStrictEqual(yield* index.claimOf(ada), Option.some(open));
    }),
  );

  it.effect("closes a claim for good once it is completed", () =>
    Effect.gen(function* () {
      const index = yield* makeIndex();
      const claim = { organization: acme, adminPersonId: PersonId.make("admin-1") };
      yield* index.claimOrganization(ada, claim);
      yield* index.completeClaim(ada, 1);
      yield* index.completeClaim(ada, 2);
      const closed = { ...claim, completed: true };
      assert.deepStrictEqual(yield* index.claimOf(ada), Option.some(closed));
      assert.deepStrictEqual(yield* index.claimOrganization(ada, claim), closed);
    }),
  );

  it("closes, when migrating, the claims whose creator was already linked", () => {
    const sqlite = new DatabaseSync(":memory:");
    const files = readdirSync(migrations).sort();
    const before = files.filter((file) => file < "0004");
    for (const file of before) sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
    sqlite.exec(`
      INSERT INTO organization_claim VALUES ('user_done', 'org-done', 'Done', 'admin-done');
      INSERT INTO organization_claim VALUES ('user_open', 'org-open', 'Open', 'admin-open');
      INSERT INTO person_index VALUES ('org-done', 'admin-done', 'done@example.com', 'user_done');
    `);
    for (const file of files.filter((file) => !before.includes(file))) {
      sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
    }
    const rows = sqlite
      .prepare(
        "SELECT workos_user_id, completed_at IS NOT NULL AS completed FROM organization_claim ORDER BY 1",
      )
      .all();
    assert.deepStrictEqual(
      rows.map((row) => ({ ...row })),
      [
        { workos_user_id: "user_done", completed: 1 },
        { workos_user_id: "user_open", completed: 0 },
      ],
    );
  });

  it.effect("records revoked sessions", () =>
    Effect.gen(function* () {
      const index = yield* makeIndex();
      const session = SessionId.make("session_1");
      assert.isFalse(yield* index.isSessionRevoked(session));
      yield* index.revokeSession(session, 1);
      yield* index.revokeSession(session, 2);
      assert.isTrue(yield* index.isSessionRevoked(session));
    }),
  );

  it("rejects an email stored without normalising", () => {
    const sqlite = new DatabaseSync(":memory:");
    for (const file of readdirSync(migrations).sort()) {
      sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
    }
    assert.throws(() =>
      sqlite
        .prepare(
          "INSERT INTO person_index (organization_id, person_id, email) VALUES ('a', 'p', 'Ada@x.com')",
        )
        .run(),
    );
  });
});
