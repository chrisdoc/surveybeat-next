import { SqliteClient } from "@effect/sql-sqlite-do";
import type * as Cloudflare from "@alchemy.run/cloudflare";
import { assert, describe, it } from "@effect/vitest";
import { createAuth, SESSION_COOKIE } from "@surveybeat/auth";
import {
  AuthUserId,
  confirmEmailChange,
  correctPersonEmail,
  defaultSendPolicy,
  EmailAddress,
  EmailRectification,
  makeSendStore,
  OrganizationDirectory,
  OrganizationId,
  PeopleIndex,
  PersonId,
  requestEmailChange,
  SessionIdentityProvider,
} from "@surveybeat/domain";
import type { Member } from "@surveybeat/domain";
import { migratedDatabase, SqliteStorage } from "@surveybeat/testing";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Redacted from "effect/Redacted";
import * as Scope from "effect/Scope";
import { betterAuthIdentityProvider } from "./auth/BetterAuthIdentityProvider.ts";
import { d1EmailRectification } from "./auth/D1EmailRectification.ts";
import { d1PeopleIndex } from "./auth/D1PeopleIndex.ts";
import { organizationDirectory } from "./organization/Directory.ts";
import { makeSqlDirectory } from "./SqlDirectory.ts";
import { makeSqlRounds, secureRandomBytes } from "./SqlRounds.ts";
import { makeSqlSendRepository } from "./SqlSendRepository.ts";

type Database = ReturnType<typeof migratedDatabase>;

const migrations = new URL("../migrations/", import.meta.url);

const d1Migrations = new URL("../d1-migrations/", import.meta.url);

const authOrigin = "http://localhost:5173";

const ACME = OrganizationId.make("acme");

const GLOBEX = OrganizationId.make("globex");

const INITECH = OrganizationId.make("initech");

const HOOLI = OrganizationId.make("hooli");

const ADMIN = PersonId.make("acme-admin");

const bounded = (binds: readonly unknown[]) => binds as (null | number | string)[];

interface Statement {
  readonly bind: (...values: readonly unknown[]) => Statement;
  readonly all: () => Promise<unknown>;
  readonly run: () => Promise<unknown>;
}

const betterAuthDatabase = (sqlite: Database) => {
  const statement = (sql: string, binds: readonly unknown[]): Statement => ({
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

  return {
    prepare: (sql: string) => statement(sql, []),
    batch: (statements: readonly Statement[]) => Promise.all(statements.map((query) => query.all())),
    exec: (sql: string) => Promise.resolve(sqlite.exec(sql)),
  };
};

const d1Client = (sqlite: Database) => {
  const statement = (sql: string, binds: readonly unknown[]) => ({
    bind: (...next: readonly unknown[]) => statement(sql, next),
    all: () => Effect.sync(() => ({ results: sqlite.prepare(sql).all(...bounded(binds)) })),
    run: () => Effect.sync(() => sqlite.prepare(sql).run(...bounded(binds))),
  });

  return { prepare: (sql: string) => statement(sql, []) } as unknown as Cloudflare.D1.QueryDatabaseClient;
};

const organizationSql = (db: Database) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();

    return yield* SqliteClient.make({
      storage: SqliteStorage.makeSqliteStorage(db) as unknown as NonNullable<
        Parameters<typeof SqliteClient.make>[0]["storage"]
      >,
    }).pipe(Effect.provideService(Scope.Scope, scope), Effect.provide(Reactivity.layer));
  });

const dump = (db: Database, except: readonly string[] = []): string => {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name))
    .filter((name) => !except.includes(name));

  return JSON.stringify(
    Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])),
  );
};

const seedOrganization = (
  id: string,
  people: readonly (readonly [string, string, string | null, number, number | null, number | null])[],
) => {
  const db = migratedDatabase(migrations);
  db.prepare("INSERT INTO organization (id, name) VALUES (?, ?)").run(id, id);

  for (const [personId, email, userId, admin, removedAt, erasedAt] of people) {
    db.prepare(
      `INSERT INTO person (id, email, auth_user_id, organization_admin, removed_at, erased_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(personId, email, userId, admin, removedAt, erasedAt);
  }

  return db;
};

interface Crash {
  moveIndex: boolean;
  rectify: OrganizationId | null;
}

const world = () =>
  Effect.gen(function* () {
    const sqlite = migratedDatabase(d1Migrations);
    const signInCodes = new Map<string, string>();
    const changeCodes = new Map<string, string>();
    const sentChangeCodes: string[] = [];

    const auth = createAuth({
      settings: {
        baseURL: authOrigin,
        secret: "surveybeat-rectification-test-secret-0000",
        trustedOrigins: [authOrigin],
      },
      delivery: {
        sendSignInCode: ({ email, otp }) =>
          Effect.sync(() => {
            signInCodes.set(email, otp);
          }),
        sendEmailChangeCode: ({ email, otp }) =>
          Effect.sync(() => {
            changeCodes.set(email, otp);
            sentChangeCodes.push(email);
          }),
        sendMagicLink: () => Effect.void,
      },
      database: betterAuthDatabase(sqlite),
    });

    const post = (path: string, body: unknown) =>
      Effect.promise(() =>
        auth.handler(
          new Request(`${authOrigin}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json", origin: authOrigin },
            body: JSON.stringify(body),
          }),
        ),
      );

    const signIn = (email: string) =>
      Effect.gen(function* () {
        yield* post("/auth/email-otp/send-verification-otp", { email, type: "sign-in" });

        const response = yield* post("/auth/sign-in/email-otp", {
          email,
          otp: signInCodes.get(email) ?? "",
        });

        const pair = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

        return Redacted.make(pair.slice(`${SESSION_COOKIE}=`.length));
      });

    const ada = yield* signIn("ada@example.com");
    const bob = yield* signIn("bob@example.com");
    yield* signIn("stranger@example.com");

    const idOf = (email: string) => {
      const found = sqlite.prepare("SELECT id FROM auth_user WHERE email = ?").get(email)?.id;

      if (typeof found !== "string") {
        throw new TypeError(`no account for ${email}`);
      }

      return AuthUserId.make(found);
    };

    const strangerId = idOf("stranger@example.com");
    const adaId = idOf("ada@example.com");
    const bobId = idOf("bob@example.com");

    sqlite.exec(`
      INSERT INTO organization_index (organization_id, name) VALUES ('acme', 'Acme'), ('globex', 'Globex'), ('initech', 'Initech');
      INSERT INTO person_index (organization_id, person_id, email, auth_user_id, removed_at) VALUES
        ('acme', 'acme-admin', 'admin@example.com', 'user_admin', NULL),
        ('acme', 'acme-ada', 'ada@example.com', '${adaId}', NULL),
        ('acme', 'acme-bob', 'bob@example.com', '${bobId}', NULL),
        ('acme', 'acme-pat', 'pat@example.com', NULL, NULL),
        ('acme', 'acme-quinn', 'quinn@example.com', NULL, 7),
        ('globex', 'globex-ada', 'ada@example.com', '${adaId}', NULL),
        ('globex', 'globex-pat', 'pat@example.com', NULL, NULL),
        ('initech', 'initech-ada', 'ada@example.com', '${adaId}', 5),
        ('initech', 'initech-lone', 'lone@example.com', NULL, NULL);
      INSERT INTO email_message (message_id, organization_id, send_id) VALUES ('captured-ada', 'acme', 'ada-welcome');
    `);

    const organizations = new Map<OrganizationId, Database>([
      [
        ACME,
        seedOrganization("acme", [
          ["acme-admin", "admin@example.com", "user_admin", 1, null, null],
          ["acme-ada", "ada@example.com", adaId, 0, null, null],
          ["acme-bob", "bob@example.com", bobId, 0, null, null],
          ["acme-pat", "pat@example.com", null, 0, null, null],
          ["acme-quinn", "quinn@example.com", null, 0, 7, null],
          ["acme-gone", "erased-acme-gone@erased.invalid", null, 0, 9, 9],
        ]),
      ],
      [
        GLOBEX,
        seedOrganization("globex", [
          ["globex-ada", "ada@example.com", adaId, 0, null, null],
          ["globex-pat", "pat@example.com", null, 0, null, null],
        ]),
      ],
      [
        INITECH,
        seedOrganization("initech", [
          ["initech-ada", "ada@example.com", adaId, 0, 5, null],
          ["initech-lone", "lone@example.com", null, 0, null, null],
        ]),
      ],
      [
        HOOLI,
        seedOrganization("hooli", [["hooli-gone", "erased-hooli-gone@erased.invalid", adaId, 0, 9, 9]]),
      ],
    ]);

    organizations
      .get(ACME)
      ?.prepare(
        "INSERT INTO email_send (id, recipient, content, status, state) VALUES ('ada-welcome', 'ada@example.com', ?, 'Sent', ?)",
      )
      .run(
        JSON.stringify({ _tag: "AddedToTeam", teamName: "Platform", leadName: "ada@example.com" }),
        JSON.stringify({ _tag: "Sent", messageId: "captured-ada", sentAt: 8000 }),
      );

    const crash: Crash = { moveIndex: false, rectify: null };

    const durableFor = (organizationId: OrganizationId) =>
      Effect.gen(function* () {
        const db = organizations.get(organizationId);

        if (db === undefined) {
          return yield* Effect.die(`no database for ${organizationId}`);
        }

        const sql = yield* organizationSql(db);
        const sends = makeSendStore(makeSqlSendRepository(sql), defaultSendPolicy);

        return organizationDirectory({
          sql,
          rounds: makeSqlRounds(sql, secureRandomBytes),
          directory: makeSqlDirectory(sql, sends),
        });
      });

    const directoryStub: Pick<
      OrganizationDirectory["Service"],
      "run" | "rectifyEmail" | "clearPersonErasure"
    > = {
      run: (organizationId, actorId, command, now) =>
        Effect.flatMap(durableFor(organizationId), (durable) =>
          durable.runDirectoryCommand(actorId, command, now),
        ),
      rectifyEmail: (organizationId, userId, email) =>
        Effect.suspend(() => {
          if (crash.rectify === organizationId) {
            crash.rectify = null;

            return Effect.die("the Worker stopped");
          }

          return Effect.flatMap(durableFor(organizationId), (durable) => durable.rectifyEmail(userId, email));
        }),
      clearPersonErasure: () => Effect.void,
    };

    const directory = directoryStub as unknown as OrganizationDirectory["Service"];

    const provider = betterAuthIdentityProvider({
      auth,
      chosenOrganization: () => Effect.succeedNone,
      rememberOrganization: () => Effect.void,
      deleteSession: () => Effect.void,
    });

    const run = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        EmailRectification | OrganizationDirectory | PeopleIndex | SessionIdentityProvider
      >,
    ) =>
      Effect.gen(function* () {
        const rectification = yield* d1EmailRectification(d1Client(sqlite));

        return yield* effect.pipe(
          Effect.provideService(EmailRectification, {
            ...rectification,
            moveIndex: (userId, email) =>
              Effect.suspend(() => {
                if (crash.moveIndex) {
                  crash.moveIndex = false;

                  return Effect.die("the Worker stopped");
                }

                return rectification.moveIndex(userId, email);
              }),
          }),
          Effect.provideService(OrganizationDirectory, directory),
          Effect.provideService(PeopleIndex, yield* d1PeopleIndex(d1Client(sqlite))),
          Effect.provideService(SessionIdentityProvider, provider),
        );
      }).pipe(Effect.provideService(RuntimeContext, {} as RuntimeContext["Service"]));

    const sessionOf = (cookie: Redacted.Redacted) => provider.authenticate(cookie).pipe(Effect.orDie);

    const request = (cookie: Redacted.Redacted, address: string) =>
      Effect.flatMap(sessionOf(cookie), (session) =>
        run(requestEmailChange(cookie, session, address).pipe(Effect.exit)),
      );

    const confirm = (cookie: Redacted.Redacted, address: string, code: string) =>
      Effect.flatMap(sessionOf(cookie), (session) =>
        run(confirmEmailChange(cookie, session, address, code).pipe(Effect.exit)),
      );

    const correct = (member: Member, personId: PersonId, address: string) =>
      run(correctPersonEmail(member, personId, address).pipe(Effect.exit));

    const adminMember = (organizationAdmin: boolean): Member => ({
      organization: { id: ACME, name: "Acme" },
      personId: organizationAdmin ? ADMIN : PersonId.make("acme-bob"),
      organizationAdmin,
      locale: null,
      detectedLocale: null,
      organizationLocale: "en",
    });

    const snapshots = () => ({
      d1: dump(sqlite),
      organizations: [...organizations].map(([id, db]) => [id, dump(db)] as const),
    });

    const personEmail = (organizationId: OrganizationId, personId: string): unknown =>
      organizations.get(organizationId)?.prepare("SELECT email FROM person WHERE id = ?").get(personId)
        ?.email;

    const indexEmail = (organizationId: string, personId: string): unknown =>
      sqlite
        .prepare("SELECT email FROM person_index WHERE organization_id = ? AND person_id = ?")
        .get(organizationId, personId)?.email;

    const accountEmail = (userId: string): unknown =>
      sqlite.prepare("SELECT email FROM auth_user WHERE id = ?").get(userId)?.email;

    const pendingRows = (): number =>
      Number(sqlite.prepare("SELECT count(*) AS n FROM email_rectification").get()?.n);

    return {
      directory,
      provider,
      run,
      sqlite,
      organizations,
      ada,
      bob,
      adaId,
      bobId,
      strangerId,
      crash,
      changeCodes,
      sentChangeCodes,
      request,
      confirm,
      correct,
      adminMember,
      snapshots,
      personEmail,
      indexEmail,
      accountEmail,
      pendingRows,
    };
  });

const failureTag = (exit: Exit.Exit<unknown, { readonly _tag: string }>): string => {
  if (Exit.isSuccess(exit)) {
    return "Success";
  }

  const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");

  return failure === undefined ? "Defect" : failure.error._tag;
};

const NEW = "ada.lovelace@example.com";

describe("rectifying a Person's email (GDPR 309)", () => {
  it.effect(
    "moves the account, every linked index row, and the Person in each Organization, and leaves everyone else",
    () =>
      Effect.gen(function* () {
        const w = yield* world();
        const before = w.snapshots();

        assert.strictEqual(failureTag(yield* w.request(w.ada, ` ${NEW.toUpperCase()} `)), "Success");
        assert.deepStrictEqual(w.sentChangeCodes, [NEW]);

        const exit = yield* w.confirm(w.ada, NEW, w.changeCodes.get(NEW) ?? "");

        assert.strictEqual(failureTag(exit), "Success");
        assert.isTrue(Exit.isSuccess(exit) && Option.isSome(exit.value));

        assert.strictEqual(w.accountEmail(w.adaId), NEW);
        assert.strictEqual(
          w.sqlite.prepare("SELECT emailVerified FROM auth_user WHERE id = ?").get(w.adaId)?.emailVerified,
          1,
        );
        assert.strictEqual(w.accountEmail(w.bobId), "bob@example.com");

        for (const [organizationId, personId] of [
          ["acme", "acme-ada"],
          ["globex", "globex-ada"],
          ["initech", "initech-ada"],
        ] as const) {
          assert.strictEqual(w.indexEmail(organizationId, personId), NEW, `${personId} in the index`);
          assert.strictEqual(w.personEmail(OrganizationId.make(organizationId), personId), NEW, personId);
        }

        assert.strictEqual(
          w.sqlite.prepare("SELECT removed_at FROM person_index WHERE person_id = 'initech-ada'").get()
            ?.removed_at,
          5,
        );
        assert.strictEqual(
          w.organizations
            .get(INITECH)
            ?.prepare("SELECT removed_at FROM person WHERE id = 'initech-ada'")
            .get()?.removed_at,
          5,
        );

        for (const [organizationId, personId, address] of [
          ["acme", "acme-admin", "admin@example.com"],
          ["acme", "acme-bob", "bob@example.com"],
          ["acme", "acme-pat", "pat@example.com"],
          ["acme", "acme-quinn", "quinn@example.com"],
          ["acme", "acme-gone", "erased-acme-gone@erased.invalid"],
          ["globex", "globex-pat", "pat@example.com"],
          ["initech", "initech-lone", "lone@example.com"],
        ] as const) {
          assert.strictEqual(w.personEmail(OrganizationId.make(organizationId), personId), address, personId);
        }

        assert.strictEqual(w.indexEmail("acme", "acme-bob"), "bob@example.com");
        assert.strictEqual(w.indexEmail("acme", "acme-pat"), "pat@example.com");
        assert.strictEqual(w.pendingRows(), 0);

        const delivered = w.sqlite.prepare("SELECT * FROM email_message").all();
        const sends = w.organizations.get(ACME)?.prepare("SELECT recipient FROM email_send").all();

        assert.deepStrictEqual(delivered, [
          { message_id: "captured-ada", organization_id: "acme", send_id: "ada-welcome" },
        ]);
        assert.deepStrictEqual(sends, [{ recipient: "ada@example.com" }]);
        assert.notStrictEqual(w.snapshots().d1, before.d1);
      }),
  );

  it.effect("never touches an erased Person's tombstone, even one that still names the account", () =>
    Effect.gen(function* () {
      const w = yield* world();

      yield* w.directory.rectifyEmail(HOOLI, w.adaId, EmailAddress.make(NEW));

      assert.strictEqual(w.personEmail(HOOLI, "hooli-gone"), "erased-hooli-gone@erased.invalid");
    }),
  );

  it.effect("is deleted with the account, so no pending address outlives an erasure", () =>
    Effect.gen(function* () {
      const w = yield* world();

      yield* w.run(
        EmailRectification.use((rectification) =>
          rectification.begin(w.strangerId, {
            oldEmail: EmailAddress.make("stranger@example.com"),
            newEmail: EmailAddress.make("moved@example.com"),
          }),
        ),
      );
      assert.strictEqual(w.pendingRows(), 1);

      const erased = yield* w.run(PeopleIndex.use((index) => index.eraseAccount(w.strangerId)));

      assert.isTrue(erased);
      assert.strictEqual(w.pendingRows(), 0);
      assert.notInclude(dump(w.sqlite), "moved@example.com");
      assert.notInclude(dump(w.sqlite), "stranger@example.com");
    }),
  );

  it.effect("hands back the session cookie, which now reads the new address", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* w.request(w.ada, NEW);
      const exit = yield* w.confirm(w.ada, NEW, w.changeCodes.get(NEW) ?? "");
      const token = Exit.isSuccess(exit) ? Option.getOrElse(exit.value, () => "") : "";
      const session = yield* w.provider.authenticate(Redacted.make(token));

      assert.isTrue(token.length > 0);
      assert.strictEqual(session.identity.email, NEW);
      assert.isTrue(session.identity.emailVerified);
    }),
  );

  it.effect("finishes a change that stopped after the account moved, without a second code", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* w.request(w.ada, NEW);
      const code = w.changeCodes.get(NEW) ?? "";
      w.crash.rectify = GLOBEX;

      const stopped = yield* w.confirm(w.ada, NEW, code);

      assert.strictEqual(failureTag(stopped), "Defect");
      assert.strictEqual(w.accountEmail(w.adaId), NEW);
      assert.strictEqual(w.pendingRows(), 1);
      assert.strictEqual(w.personEmail(ACME, "acme-ada"), NEW);
      assert.strictEqual(w.personEmail(GLOBEX, "globex-ada"), "ada@example.com");

      const other = yield* w.request(w.ada, "other@example.com");

      assert.strictEqual(failureTag(other), "EmailChangePending");
      assert.strictEqual(w.accountEmail(w.adaId), NEW);

      const resumed = yield* w.confirm(w.ada, NEW, "000000");

      assert.strictEqual(failureTag(resumed), "Success");
      assert.isTrue(Exit.isSuccess(resumed) && Option.isNone(resumed.value));
      assert.deepStrictEqual(w.sentChangeCodes, [NEW]);
      assert.strictEqual(w.personEmail(GLOBEX, "globex-ada"), NEW);
      assert.strictEqual(w.personEmail(INITECH, "initech-ada"), NEW);
      assert.strictEqual(w.indexEmail("globex", "globex-ada"), NEW);
      assert.strictEqual(w.pendingRows(), 0);
    }),
  );

  it.effect("finishes a change that stopped before the index followed the account", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* w.request(w.ada, NEW);
      w.crash.moveIndex = true;

      const stopped = yield* w.confirm(w.ada, NEW, w.changeCodes.get(NEW) ?? "");

      assert.strictEqual(failureTag(stopped), "Defect");
      assert.strictEqual(w.accountEmail(w.adaId), NEW);
      assert.strictEqual(w.indexEmail("acme", "acme-ada"), "ada@example.com");
      assert.strictEqual(w.personEmail(ACME, "acme-ada"), "ada@example.com");

      const resumed = yield* w.confirm(w.ada, NEW, "000000");

      assert.strictEqual(failureTag(resumed), "Success");

      for (const [organizationId, personId] of [
        ["acme", "acme-ada"],
        ["globex", "globex-ada"],
        ["initech", "initech-ada"],
      ] as const) {
        assert.strictEqual(w.indexEmail(organizationId, personId), NEW);
        assert.strictEqual(w.personEmail(OrganizationId.make(organizationId), personId), NEW);
      }

      assert.strictEqual(w.pendingRows(), 0);
    }),
  );

  it.effect("writes nothing when the address belongs to another account or to an unlinked Person", () =>
    Effect.gen(function* () {
      const w = yield* world();
      const before = w.snapshots();

      for (const taken of [
        "bob@example.com",
        "Stranger@Example.com",
        "admin@example.com",
        "pat@example.com",
        "quinn@example.com",
        "lone@example.com",
      ]) {
        assert.strictEqual(failureTag(yield* w.request(w.ada, taken)), "EmailTaken", taken);
        assert.strictEqual(failureTag(yield* w.confirm(w.ada, taken, "123456")), "EmailTaken", taken);
      }

      assert.strictEqual(failureTag(yield* w.request(w.ada, "ada@example.com")), "EmailUnchanged");
      assert.strictEqual(failureTag(yield* w.request(w.ada, "ädä@example.com")), "EmailUnusable");
      assert.deepStrictEqual(w.sentChangeCodes, []);
      assert.deepStrictEqual(w.snapshots(), before);
    }),
  );

  it.effect("writes nothing when the code is wrong, and leaves no pending change", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* w.request(w.ada, NEW);
      const before = w.snapshots();
      const code = w.changeCodes.get(NEW) ?? "";

      const wrong = yield* w.confirm(w.ada, NEW, code === "000000" ? "111111" : "000000");
      const after = w.snapshots();

      assert.strictEqual(failureTag(wrong), "WrongEmailCode");
      assert.strictEqual(w.pendingRows(), 0);
      assert.strictEqual(w.accountEmail(w.adaId), "ada@example.com");
      assert.deepStrictEqual(after.organizations, before.organizations);

      for (const table of ["auth_user", "person_index", "email_rectification", "email_message"]) {
        assert.deepStrictEqual(JSON.parse(after.d1)[table], JSON.parse(before.d1)[table], table);
      }

      const right = yield* w.confirm(w.ada, NEW, code);

      assert.strictEqual(failureTag(right), "Success");
    }),
  );

  it.effect("asks the Person to sign in again when Better Auth refuses the session, and writes nothing", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* w.request(w.ada, NEW);
      const session = yield* w.provider.authenticate(w.ada);
      w.sqlite.prepare("DELETE FROM auth_session WHERE userId = ?").run(w.adaId);
      const before = w.snapshots();

      const asked = yield* w.run(requestEmailChange(w.ada, session, "another@example.com").pipe(Effect.exit));

      const confirmed = yield* w.run(
        confirmEmailChange(w.ada, session, NEW, w.changeCodes.get(NEW) ?? "").pipe(Effect.exit),
      );

      assert.strictEqual(failureTag(asked), "SignInAgainRequired");
      assert.strictEqual(failureTag(confirmed), "SignInAgainRequired");
      assert.strictEqual(w.pendingRows(), 0);
      assert.deepStrictEqual(w.snapshots(), before);
      assert.strictEqual(w.accountEmail(w.adaId), "ada@example.com");
    }),
  );
});

describe("an Organization admin correcting an unlinked Person's email (GDPR 309)", () => {
  it.effect("updates that Person and that index row only, and keeps a removed Person removed", () =>
    Effect.gen(function* () {
      const w = yield* world();
      const admin = w.adminMember(true);

      assert.strictEqual(
        failureTag(yield* w.correct(admin, PersonId.make("acme-pat"), " Pat.New@Example.com ")),
        "Success",
      );
      assert.strictEqual(w.personEmail(ACME, "acme-pat"), "pat.new@example.com");
      assert.strictEqual(w.indexEmail("acme", "acme-pat"), "pat.new@example.com");
      assert.strictEqual(w.personEmail(GLOBEX, "globex-pat"), "pat@example.com");
      assert.strictEqual(w.indexEmail("globex", "globex-pat"), "pat@example.com");

      assert.strictEqual(
        failureTag(yield* w.correct(admin, PersonId.make("acme-quinn"), "quinn.new@example.com")),
        "Success",
      );
      assert.strictEqual(w.personEmail(ACME, "acme-quinn"), "quinn.new@example.com");
      assert.strictEqual(w.indexEmail("acme", "acme-quinn"), "quinn.new@example.com");
      assert.strictEqual(
        w.sqlite.prepare("SELECT removed_at FROM person_index WHERE person_id = 'acme-quinn'").get()
          ?.removed_at,
        7,
      );
      assert.strictEqual(
        w.organizations.get(ACME)?.prepare("SELECT removed_at FROM person WHERE id = 'acme-quinn'").get()
          ?.removed_at,
        7,
      );

      assert.strictEqual(w.personEmail(ACME, "acme-ada"), "ada@example.com");
      assert.strictEqual(w.accountEmail(w.adaId), "ada@example.com");
      assert.strictEqual(w.personEmail(ACME, "acme-gone"), "erased-acme-gone@erased.invalid");
    }),
  );

  it.effect("refuses a Person who has signed in", () =>
    Effect.gen(function* () {
      const w = yield* world();
      const before = w.snapshots();

      const exit = yield* w.correct(w.adminMember(true), PersonId.make("acme-ada"), "ada.new@example.com");

      assert.strictEqual(failureTag(exit), "PersonHasAccount");
      assert.deepStrictEqual(w.snapshots(), before);
    }),
  );

  it.effect("refuses an address that any account or any signed-in Person has, or another Person here", () =>
    Effect.gen(function* () {
      const w = yield* world();
      const before = w.snapshots();
      const admin = w.adminMember(true);

      for (const taken of [
        "bob@example.com",
        "stranger@example.com",
        "admin@example.com",
        "quinn@example.com",
      ]) {
        assert.strictEqual(
          failureTag(yield* w.correct(admin, PersonId.make("acme-pat"), taken)),
          "EmailTaken",
          taken,
        );
      }

      assert.deepStrictEqual(w.snapshots(), before);
    }),
  );

  it.effect("allows an address another Organization's unlinked Person has: one human added twice", () =>
    Effect.gen(function* () {
      const w = yield* world();

      const exit = yield* w.correct(w.adminMember(true), PersonId.make("acme-pat"), "lone@example.com");

      assert.strictEqual(failureTag(exit), "Success");
      assert.strictEqual(w.personEmail(ACME, "acme-pat"), "lone@example.com");
      assert.strictEqual(w.personEmail(INITECH, "initech-lone"), "lone@example.com");
    }),
  );

  it.effect("is for an Organization admin only", () =>
    Effect.gen(function* () {
      const w = yield* world();
      const before = w.snapshots();

      const exit = yield* w.correct(w.adminMember(false), PersonId.make("acme-pat"), "pat.new@example.com");

      assert.strictEqual(failureTag(exit), "Forbidden");
      assert.deepStrictEqual(w.snapshots(), before);
    }),
  );
});
