// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import type * as Cloudflare from "@alchemy.run/cloudflare";
import { assert, describe, expect, it } from "@effect/vitest";
import { AUTH_TABLES, SESSION_COOKIE, createAuth, memoryAuth } from "@surveybeat/auth";
import { EmailAddress, OrganizationId, PersonId, AuthUserId } from "@surveybeat/domain";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { readdirSync, readFileSync } from "node:fs";
import * as Redacted from "effect/Redacted";
import { DatabaseSync } from "node:sqlite";
import { betterAuthIdentityProvider } from "./BetterAuthIdentityProvider.ts";
import { d1PeopleIndex } from "./D1PeopleIndex.ts";

// The D1 adapter's SQL against the real migrations, on Node's SQLite (the engine D1 runs).
const migrations = new URL("../../d1-migrations/", import.meta.url);

const makeIndex = () => {
  const sqlite = new DatabaseSync(":memory:");

  for (const file of readdirSync(migrations).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }

  const statement = (sql: string, binds: readonly unknown[]) => ({
    bind: (...values: readonly unknown[]) => statement(sql, values),
    all: () =>
      Effect.sync(() => ({ results: sqlite.prepare(sql).all(...(binds as (null | string | number)[])) })),
    run: () =>
      Effect.sync(() => {
        sqlite.prepare(sql).run(...(binds as (null | string | number)[]));

        return { results: [] };
      }),
  });

  const client = {
    prepare: (sql: string) => statement(sql, []),
  } as unknown as Cloudflare.D1.QueryDatabaseClient;

  return d1PeopleIndex(client).pipe(Effect.provideService(RuntimeContext, {} as RuntimeContext["Service"]));
};

const acme = { id: OrganizationId.make("acme"), name: "Acme" };

const globex = { id: OrganizationId.make("globex"), name: "Globex" };

const ada = AuthUserId.make("user_ada");

describe("D1 PeopleIndex", () => {
  it.effect("finds unlinked Persons by normalised email, then by user once linked", () =>
    Effect.gen(function* () {
      const index = yield* makeIndex();
      yield* index.putOrganization(acme);
      yield* index.putOrganization(globex);
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
      yield* index.linkPerson(acme.id, person, AuthUserId.make("user_mallory"));
      assert.deepStrictEqual(yield* index.linkedPersons(ada), [
        { organization: acme, personId: person, linked: true },
      ]);
      assert.deepStrictEqual(
        (yield* index.unlinkedPersons(EmailAddress.make("ada@example.com"))).map((c) => c.organization.id),
        [globex.id],
      );
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

    for (const file of before) {
      sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
    }

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
        "SELECT auth_user_id, completed_at IS NOT NULL AS completed FROM organization_claim ORDER BY 1",
      )
      .all();

    assert.deepStrictEqual(
      rows.map((row) => ({ ...row })),
      [
        { auth_user_id: "user_done", completed: 1 },
        { auth_user_id: "user_open", completed: 0 },
      ],
    );
  });

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

const authOrigin = "http://localhost:5173";

const authAddress = "person@example.com";

const authSettings = {
  baseURL: authOrigin,
  secret: "surveybeat-d1-test-secret-000000000000",
  trustedOrigins: [authOrigin],
};

interface D1Result<T> {
  readonly results: T[];
  readonly meta: { readonly changes: number; readonly last_row_id: number };
}

interface AuthorizedStatement {
  readonly bind: (...values: readonly unknown[]) => AuthorizedStatement;
  readonly all: () => Promise<D1Result<unknown>>;
  readonly run: () => Promise<unknown>;
}

// Better Auth resolves its session rows through a D1-shaped database, so the test hands it Node's
// SQLite behind that interface and lets the real migrations run in front of it.
const betterAuthDatabase = () => {
  const sqlite = new DatabaseSync(":memory:");

  for (const file of readdirSync(migrations).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }

  const bounded = (binds: readonly unknown[]) => binds as (null | number | string)[];

  const statement = (sql: string, binds: readonly unknown[]): AuthorizedStatement => ({
    bind: (...values) => statement(sql, values),
    run: () => {
      sqlite.prepare(sql).run(...bounded(binds));

      return Promise.resolve();
    },
    all: () => {
      const prepared = sqlite.prepare(sql);

      if (prepared.columns().length === 0) {
        const applied = prepared.run(...bounded(binds));

        return Promise.resolve({
          results: [] as unknown[],
          meta: { changes: Number(applied.changes), last_row_id: Number(applied.lastInsertRowid) },
        });
      }

      return Promise.resolve({
        results: prepared.all(...bounded(binds)),
        meta: { changes: 0, last_row_id: 0 },
      });
    },
  });

  const database = {
    prepare: (sql: string) => statement(sql, []),
    batch: (statements: readonly AuthorizedStatement[]) =>
      Promise.all(statements.map((query) => query.all())),
    exec: (sql: string) => Promise.resolve(sqlite.exec(sql)),
  };

  return { sqlite, database };
};

const authPost = (path: string, body: unknown) =>
  new Request(`${authOrigin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: authOrigin },
    body: JSON.stringify(body),
  });

const authGetSession = (cookie: string) =>
  new Request(`${authOrigin}/auth/get-session`, {
    headers: { cookie, origin: authOrigin },
  });

describe("Better Auth sessions in D1", () => {
  it.effect("keeps a session for the next auth instance, unlike the memory adapter", () =>
    Effect.gen(function* () {
      const { sqlite, database } = betterAuthDatabase();
      const codes: string[] = [];

      const delivery = {
        sendSignInCode: ({ otp }: { readonly email: string; readonly otp: string }) =>
          Effect.sync(() => {
            codes.push(otp);
          }),
        sendMagicLink: () => Effect.void,
      };

      const d1 = database as unknown as NonNullable<Parameters<typeof createAuth>[0]["database"]>;

      const first = createAuth({ settings: authSettings, delivery, database: d1 });

      const sent = yield* Effect.promise(() =>
        first.handler(
          authPost("/auth/email-otp/send-verification-otp", { email: authAddress, type: "sign-in" }),
        ),
      );

      expect(sent.status).toBe(200);

      const signedIn = yield* Effect.promise(() =>
        first.handler(authPost("/auth/sign-in/email-otp", { email: authAddress, otp: codes[0] ?? "" })),
      );

      expect(signedIn.status).toBe(200);
      const cookie = (signedIn.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      expect(cookie).toContain(`${SESSION_COOKIE}=`);

      const stored = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${AUTH_TABLES.session}`).get() as {
        count: number;
      };

      expect(stored.count).toBe(1);

      const nextInstance = createAuth({ settings: authSettings, delivery, database: d1 });
      const read = yield* Effect.promise(() => nextInstance.handler(authGetSession(cookie)));
      expect(read.status).toBe(200);
      const body: unknown = yield* Effect.promise(() => read.json());
      expect(body).toMatchObject({ user: { email: authAddress } });

      const inMemory = memoryAuth(delivery);
      const forgotten = yield* Effect.promise(() => inMemory.handler(authGetSession(cookie)));
      expect(yield* Effect.promise(() => forgotten.json())).toBeNull();
    }),
  );
});

describe("Better Auth identity provider over D1", () => {
  it.effect("refuses the cookie once the session row is deleted", () =>
    Effect.gen(function* () {
      const { sqlite, database } = betterAuthDatabase();
      const codes: string[] = [];

      const delivery = {
        sendSignInCode: ({ otp }: { readonly email: string; readonly otp: string }) =>
          Effect.sync(() => {
            codes.push(otp);
          }),
        sendMagicLink: () => Effect.void,
      };

      const d1 = database as unknown as NonNullable<Parameters<typeof createAuth>[0]["database"]>;
      const auth = createAuth({ settings: authSettings, delivery, database: d1 });
      yield* Effect.promise(() =>
        auth.handler(
          authPost("/auth/email-otp/send-verification-otp", { email: authAddress, type: "sign-in" }),
        ),
      );

      const signedIn = yield* Effect.promise(() =>
        auth.handler(authPost("/auth/sign-in/email-otp", { email: authAddress, otp: codes[0] ?? "" })),
      );

      const cookie = (signedIn.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      const value = cookie.slice(`${SESSION_COOKIE}=`.length);

      const provider = betterAuthIdentityProvider({
        auth,
        chosenOrganization: (sessionId) =>
          Effect.promise(() =>
            database
              .prepare("SELECT organization_id FROM auth_session_organization WHERE session_id = ?")
              .bind(sessionId)
              .all(),
          ).pipe(
            Effect.map((result) =>
              Option.map(
                Option.fromNullishOr(result.results[0] as { organization_id: string } | undefined),
                (row) => OrganizationId.make(row.organization_id),
              ),
            ),
          ),
        rememberOrganization: (sessionId, organizationId) =>
          Effect.promise(() =>
            database
              .prepare(
                `INSERT INTO auth_session_organization (session_id, organization_id) VALUES (?, ?)
                 ON CONFLICT (session_id) DO UPDATE SET organization_id = excluded.organization_id`,
              )
              .bind(sessionId, organizationId)
              .run(),
          ).pipe(Effect.asVoid),
        deleteSession: (sessionId) =>
          Effect.promise(() =>
            database.prepare("DELETE FROM auth_session WHERE id = ?").bind(sessionId).run(),
          ),
      });

      const session = yield* provider.authenticate(Redacted.make(value));
      expect(session.identity.email).toBe(authAddress);

      // One session spans Organizations: the choice is remembered beside the session, not in it.
      yield* provider.chooseOrganization(session.sessionId, acme.id);
      yield* provider.chooseOrganization(session.sessionId, globex.id);
      assert.deepStrictEqual(yield* provider.chosenOrganization(session.sessionId), Option.some(globex.id));

      const count = (table: string) => {
        const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };

        return row.count;
      };

      expect(count("auth_session_organization")).toBe(1);

      yield* provider.revokeSession(session.sessionId);
      expect(count(AUTH_TABLES.session)).toBe(0);
      // Revocation deletes the session and nothing else: it adds no row anywhere.
      expect(count("auth_session_organization")).toBe(0);
      expect(count("person_index")).toBe(0);

      const refused = yield* provider.authenticate(Redacted.make(value)).pipe(Effect.flip);
      expect(refused._tag).toBe("Unauthenticated");
    }),
  );
});

describe("Better Auth plugin tables in D1", () => {
  it.effect("signs in through a magic link against the migrated plugin tables", () =>
    Effect.gen(function* () {
      const { sqlite, database } = betterAuthDatabase();
      const links: string[] = [];

      const delivery = {
        sendSignInCode: () => Effect.void,
        sendMagicLink: ({ url }: { readonly email: string; readonly url: string }) =>
          Effect.sync(() => {
            links.push(url);
          }),
      };

      const d1 = database as unknown as NonNullable<Parameters<typeof createAuth>[0]["database"]>;
      const auth = createAuth({ settings: authSettings, delivery, database: d1 });

      const sent = yield* Effect.promise(() =>
        auth.handler(authPost("/auth/sign-in/magic-link", { email: authAddress })),
      );

      expect(sent.status).toBe(200);
      expect(links).toHaveLength(1);

      const link = new URL(links[0] ?? "");

      const verified = yield* Effect.promise(() =>
        auth.handler(new Request(link.toString(), { headers: { origin: authOrigin } })),
      );

      expect(verified.status).toBeLessThan(400);
      const cookie = (verified.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      expect(cookie).toContain(`${SESSION_COOKIE}=`);

      const read = yield* Effect.promise(() => auth.handler(authGetSession(cookie)));
      const body: unknown = yield* Effect.promise(() => read.json());
      expect(body).toMatchObject({ user: { email: authAddress, role: "user" } });

      for (const table of ["auth_organization", "auth_member", "auth_invitation", "auth_passkey"]) {
        const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
        expect(row.count, table).toBe(0);
      }

      const user = sqlite.prepare("SELECT role FROM auth_user WHERE email = ?").get(authAddress) as {
        role: string;
      };

      expect(user.role).toBe("user");
    }),
  );
});
