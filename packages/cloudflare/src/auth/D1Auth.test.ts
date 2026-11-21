// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import type * as Cloudflare from "@alchemy.run/cloudflare";
import { assert, describe, expect, it } from "@effect/vitest";
import { AUTH_TABLES, SESSION_COOKIE, createAuth, memoryAuth } from "@surveybeat/auth";
import { EmailAddress, OrganizationId, PersonId, AuthUserId } from "@surveybeat/domain";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { createHash, generateKeyPairSync, randomBytes, sign as signCrypto } from "node:crypto";
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

  return d1PeopleIndex(client).pipe(
    Effect.provideService(RuntimeContext, {} as RuntimeContext["Service"]),
    Effect.map((index) => ({ index, sqlite })),
  );
};

const acme = { id: OrganizationId.make("acme"), name: "Acme" };

const globex = { id: OrganizationId.make("globex"), name: "Globex" };

const ada = AuthUserId.make("user_ada");

describe("D1 PeopleIndex", () => {
  it.effect("finds unlinked Persons by normalised email, then by user once linked", () =>
    Effect.gen(function* () {
      const { index } = yield* makeIndex();
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
      const { index } = yield* makeIndex();
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
      const { index } = yield* makeIndex();
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

    assert.throws(() => {
      sqlite
        .prepare(
          "INSERT INTO person_index (organization_id, person_id, email) VALUES ('a', 'p', 'Ada@x.com')",
        )
        .run();
    });
  });

  it.effect("hides a removed Person from sign-in and shows them again when they are added back", () =>
    Effect.gen(function* () {
      const { index, sqlite } = yield* makeIndex();
      yield* index.putOrganization(acme);
      yield* index.putOrganization(globex);
      const linked = PersonId.make("linked");
      const unlinked = PersonId.make("unlinked");
      yield* index.putPerson({
        organizationId: acme.id,
        personId: linked,
        email: EmailAddress.make("ada@example.com"),
        userId: Option.some(ada),
      });
      yield* index.putPerson({
        organizationId: globex.id,
        personId: unlinked,
        email: EmailAddress.make("ada@example.com"),
        userId: Option.none(),
      });

      yield* index.removePerson(acme.id, linked);

      const removedAt = (organizationId: string) =>
        sqlite
          .prepare("SELECT auth_user_id, removed_at FROM person_index WHERE organization_id = ?")
          .get(organizationId) as { auth_user_id: string | null; removed_at: number | null };

      const firstRemovedAt = removedAt(acme.id).removed_at;
      yield* index.removePerson(acme.id, linked);
      yield* index.removePerson(globex.id, unlinked);

      assert.strictEqual(removedAt(acme.id).removed_at, firstRemovedAt);
      assert.strictEqual(typeof firstRemovedAt, "number");
      assert.strictEqual(removedAt(acme.id).auth_user_id, ada);
      assert.strictEqual(removedAt(globex.id).auth_user_id, null);
      assert.strictEqual(typeof removedAt(globex.id).removed_at, "number");
      assert.deepStrictEqual(yield* index.linkedPersons(ada), []);
      assert.deepStrictEqual(yield* index.unlinkedPersons(EmailAddress.make("ada@example.com")), []);
      yield* index.linkPerson(globex.id, unlinked, AuthUserId.make("user_later"));
      assert.strictEqual(removedAt(globex.id).auth_user_id, null);
      assert.deepStrictEqual(yield* index.linkedPersons(AuthUserId.make("user_later")), []);
      assert.strictEqual(
        (sqlite.prepare("SELECT COUNT(*) AS count FROM person_index").get() as { count: number }).count,
        2,
      );

      yield* index.putPerson({
        organizationId: acme.id,
        personId: linked,
        email: EmailAddress.make("ada@example.com"),
        userId: Option.some(ada),
      });
      assert.deepStrictEqual(yield* index.linkedPersons(ada), [
        { organization: acme, personId: linked, linked: true },
      ]);
      assert.strictEqual(removedAt(acme.id).removed_at, null);
      assert.deepStrictEqual(yield* index.unlinkedPersons(EmailAddress.make("ada@example.com")), []);

      yield* index.putPerson({
        organizationId: globex.id,
        personId: unlinked,
        email: EmailAddress.make("ada@example.com"),
        userId: Option.none(),
      });
      assert.deepStrictEqual(
        (yield* index.unlinkedPersons(EmailAddress.make("ada@example.com"))).map(
          (candidate) => candidate.organization.id,
        ),
        [globex.id],
      );
      assert.strictEqual(removedAt(globex.id).removed_at, null);
    }),
  );
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
        sendEmailChangeCode: () => Effect.void,
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
        sendEmailChangeCode: () => Effect.void,
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
      const value = decodeURIComponent(cookie.slice(`${SESSION_COOKIE}=`.length));

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
        sendEmailChangeCode: () => Effect.void,
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

  it.effect(
    "registers, authenticates, renames, and deletes a passkey in D1 and authenticates the session",
    () =>
      Effect.gen(function* () {
        const { sqlite, database } = betterAuthDatabase();
        const codes: string[] = [];

        const delivery = {
          sendSignInCode: ({ otp }: { readonly email: string; readonly otp: string }) =>
            Effect.sync(() => {
              codes.push(otp);
            }),
          sendEmailChangeCode: () => Effect.void,
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

        const sessionCookie = (signedIn.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

        const cborBytes = (buf: Buffer): Buffer =>
          buf.length < 24
            ? Buffer.concat([Buffer.from([0x40 + buf.length]), buf])
            : Buffer.concat([Buffer.from([0x58, buf.length]), buf]);

        const cborText = (text: string): Buffer => {
          const buf = Buffer.from(text, "utf8");

          return Buffer.concat([Buffer.from([0x60 + buf.length]), buf]);
        };

        const cborInt = (n: number): Buffer => {
          if (n >= 0 && n < 24) {
            return Buffer.from([n]);
          }

          if (n < 0 && n >= -24) {
            return Buffer.from([0x20 + (-1 - n)]);
          }

          throw new Error(`Unsupported CBOR int ${n}`);
        };

        const credId = randomBytes(16);
        const credIdB64 = credId.toString("base64url");
        const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
        const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };

        const coseKey = Buffer.concat([
          Buffer.from([0xa5]),
          cborInt(1),
          cborInt(2),
          cborInt(3),
          cborInt(-7),
          cborInt(-1),
          cborInt(1),
          cborInt(-2),
          cborBytes(Buffer.from(jwk.x, "base64url")),
          cborInt(-3),
          cborBytes(Buffer.from(jwk.y, "base64url")),
        ]);

        const regOptRes = yield* Effect.promise(() =>
          auth.handler(
            new Request(`${authOrigin}/auth/passkey/generate-register-options`, {
              headers: { cookie: sessionCookie, origin: authOrigin },
            }),
          ),
        );

        expect(regOptRes.status).toBe(200);
        const regCookie = (regOptRes.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

        const regOpts = (yield* Effect.promise(() => regOptRes.json())) as {
          challenge: string;
          rp: { id: string };
        };

        const credLen = Buffer.alloc(2);
        credLen.writeUInt16BE(credId.length);

        const regAuthData = Buffer.concat([
          createHash("sha256").update(regOpts.rp.id).digest(),
          Buffer.from([0x45]),
          Buffer.alloc(4),
          Buffer.from("ea9b8d664d011d213ce4b6b48cb575d4", "hex"),
          credLen,
          credId,
          coseKey,
        ]);

        const attObj = Buffer.concat([
          Buffer.from([0xa3]),
          cborText("fmt"),
          cborText("none"),
          cborText("attStmt"),
          Buffer.from([0xa0]),
          cborText("authData"),
          cborBytes(regAuthData),
        ]);

        const verifyReg = yield* Effect.promise(() =>
          auth.handler(
            new Request(`${authOrigin}/auth/passkey/verify-registration`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                origin: authOrigin,
                cookie: `${sessionCookie}; ${regCookie}`,
              },
              body: JSON.stringify({
                response: {
                  id: credIdB64,
                  rawId: credIdB64,
                  type: "public-key",
                  authenticatorAttachment: "platform",
                  response: {
                    clientDataJSON: Buffer.from(
                      JSON.stringify({
                        type: "webauthn.create",
                        challenge: regOpts.challenge,
                        origin: authOrigin,
                      }),
                    ).toString("base64url"),
                    attestationObject: attObj.toString("base64url"),
                    transports: ["internal"],
                  },
                },
                name: "Office laptop",
              }),
            }),
          ),
        );

        expect(verifyReg.status).toBe(200);
        const created = (yield* Effect.promise(() => verifyReg.json())) as { id: string };

        const storedPasskey = sqlite
          .prepare("SELECT name, credentialID, aaguid FROM auth_passkey WHERE id = ?")
          .get(created.id) as { name: string; credentialID: string; aaguid: string };

        expect(storedPasskey).toEqual({
          name: "Office laptop",
          credentialID: credIdB64,
          aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
        });

        const authOptRes = yield* Effect.promise(() =>
          auth.handler(
            new Request(`${authOrigin}/auth/passkey/generate-authenticate-options`, {
              headers: { origin: authOrigin },
            }),
          ),
        );

        expect(authOptRes.status).toBe(200);
        const authChallengeCookie = (authOptRes.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

        const authOpts = (yield* Effect.promise(() => authOptRes.json())) as {
          challenge: string;
          rpId: string;
        };

        const authClientData = Buffer.from(
          JSON.stringify({ type: "webauthn.get", challenge: authOpts.challenge, origin: authOrigin }),
        );

        const authData = Buffer.concat([
          createHash("sha256").update(authOpts.rpId).digest(),
          Buffer.from([0x05]),
          Buffer.from([0, 0, 0, 1]),
        ]);

        const signature = signCrypto(
          "sha256",
          Buffer.concat([authData, createHash("sha256").update(authClientData).digest()]),
          privateKey,
        );

        const verifyAuth = yield* Effect.promise(() =>
          auth.handler(
            new Request(`${authOrigin}/auth/passkey/verify-authentication`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                origin: authOrigin,
                cookie: authChallengeCookie,
              },
              body: JSON.stringify({
                response: {
                  id: credIdB64,
                  rawId: credIdB64,
                  type: "public-key",
                  response: {
                    clientDataJSON: authClientData.toString("base64url"),
                    authenticatorData: authData.toString("base64url"),
                    signature: signature.toString("base64url"),
                  },
                },
              }),
            }),
          ),
        );

        expect(verifyAuth.status).toBe(200);
        const passkeyCookie = (verifyAuth.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
        const passkeyToken = decodeURIComponent(passkeyCookie.slice(`${SESSION_COOKIE}=`.length));

        const provider = betterAuthIdentityProvider({
          auth,
          chosenOrganization: () => Effect.succeedNone,
          rememberOrganization: () => Effect.void,
          deleteSession: () => Effect.void,
        });

        const identity = yield* provider.authenticate(Redacted.make(passkeyToken));
        expect(identity.identity.email).toBe(authAddress);
        expect(identity.identity.emailVerified).toBe(true);

        const deleteRes = yield* Effect.promise(() =>
          auth.handler(
            new Request(`${authOrigin}/auth/passkey/delete-passkey`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                origin: authOrigin,
                cookie: passkeyCookie,
              },
              body: JSON.stringify({ id: created.id }),
            }),
          ),
        );

        expect(deleteRes.status).toBe(200);

        const countRow = sqlite.prepare("SELECT COUNT(*) AS count FROM auth_passkey").get() as {
          count: number;
        };

        expect(countRow.count).toBe(0);
      }),
  );
});
