import { SqliteClient } from "@effect/sql-sqlite-do";
import type * as Cloudflare from "@alchemy.run/cloudflare";
import { assert, describe, it } from "@effect/vitest";
import {
  AuthUserId,
  defaultSendPolicy,
  EmailAddress,
  makeSendStore,
  OrganizationDirectory,
  OrganizationId,
  PeopleIndex,
  PersonId,
  runDirectoryCommand,
} from "@surveybeat/domain";
import type { Member } from "@surveybeat/domain";
import { migratedDatabase, SqliteStorage } from "@surveybeat/testing";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { d1PeopleIndex } from "./auth/D1PeopleIndex.ts";
import { organizationDirectory } from "./organization/Directory.ts";
import { organizationPersonalData } from "./organization/PersonalData.ts";
import { makeSqlDirectory } from "./SqlDirectory.ts";
import { makeSqlRounds, secureRandomBytes } from "./SqlRounds.ts";
import { makeSqlSendRepository } from "./SqlSendRepository.ts";

type Database = ReturnType<typeof migratedDatabase>;

const migrations = new URL("../migrations/", import.meta.url);

const d1Migrations = new URL("../d1-migrations/", import.meta.url);

const FUTURE = "2026-12-20T12:00:00.000Z";

const ACME = OrganizationId.make("acme");

const GLOBEX = OrganizationId.make("globex");

const ADMIN = PersonId.make("acme-admin");

const ADA = PersonId.make("acme-ada");

const BOB = PersonId.make("acme-bob");

const d1Client = (sqlite: Database) => {
  const statement = (sql: string, binds: readonly unknown[]) => {
    const values = binds as (null | string | number)[];

    return {
      bind: (...next: readonly unknown[]) => statement(sql, next),
      all: () => Effect.sync(() => ({ results: sqlite.prepare(sql).all(...values) })),
      run: () => Effect.sync(() => sqlite.prepare(sql).run(...values)),
    };
  };

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

const seedOrganization = () => {
  const db = migratedDatabase(migrations);
  db.prepare("INSERT INTO organization (id, name) VALUES ('acme', 'Acme')").run();
  db.prepare("INSERT INTO team (id, name, time_zone) VALUES ('team', 'Platform', 'UTC')").run();

  const people: readonly (readonly [string, string, string, number])[] = [
    [ADMIN, "admin@example.com", "user_admin", 1],
    [ADA, "ada@example.com", "user_ada", 1],
    [BOB, "bob@example.com", "user_bob", 0],
  ];

  for (const [id, email, userId, admin] of people) {
    db.prepare(
      `INSERT INTO person (id, email, auth_user_id, organization_admin, time_zone, locale, detected_locale)
       VALUES (?, ?, ?, ?, 'Europe/Berlin', 'en', 'en')`,
    ).run(id, email, userId, admin);
    db.prepare(
      "INSERT INTO membership (id, team_id, person_id, role, started_at, ended_at) VALUES (?, 'team', ?, ?, 0, NULL)",
    ).run(`${id}-m`, id, id === BOB ? "member" : "lead");
  }

  db.prepare(
    `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
     VALUES ('pulse', 'team', 'Pulse', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
  ).run();
  db.prepare(
    `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
     VALUES ('round', 'pulse', 'team', 'open', '2026-11-16', 1000, 9999999, 'Pulse', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
  ).run();

  for (const [id, email] of people) {
    db.prepare(
      "INSERT INTO round_member (round_id, person_id, time_zone, send_at) VALUES ('round', ?, 'Europe/Berlin', 5000)",
    ).run(id);
    db.prepare("INSERT INTO participation (round_id, person_id) VALUES ('round', ?)").run(id);
    db.prepare(
      `INSERT INTO invitation (round_id, person_id, token_hash, send_id, status, resend_count, created_at, updated_at)
       VALUES ('round', ?, ?, ?, 'sent', 0, 2000, 3000)`,
    ).run(id, `token-hash-${id}`, `${id}-send`);
    db.prepare(
      "INSERT INTO pulse_reminder_opt_out (pulse_id, person_id, opted_out_at) VALUES ('pulse', ?, 4000)",
    ).run(id);
    db.prepare(
      "INSERT INTO email_send (id, recipient, content, status, state) VALUES (?, ?, ?, 'Sent', ?)",
    ).run(
      `${id}-send`,
      email,
      JSON.stringify({ _tag: "InvitationEmail", token: `raw-token-${id}`, pulseName: "Body text" }),
      JSON.stringify({ _tag: "Sent", messageId: `captured-${id}`, sentAt: 8000 }),
    );
    db.prepare(
      "INSERT INTO test_send (send_id, person_id, pulse_id, token_hash, sent_at) VALUES (?, ?, 'pulse', ?, 9000)",
    ).run(`${id}-test`, id, `test-hash-${id}`);
    db.prepare(
      `INSERT INTO action (id, team_id, round_id, title, owner_id, due_date, dimension, status, created_at, updated_at, done_at)
       VALUES (?, 'team', 'round', 'Fewer meetings', ?, '2026-12-01', 'clarity', 'committed', 6000, 7000, NULL)`,
    ).run(`${id}-action`, id);
  }

  db.prepare(
    "INSERT INTO email_send (id, recipient, content, status, state) VALUES ('ada-pending', 'ada@example.com', ?, 'Pending', ?)",
  ).run(
    JSON.stringify({ _tag: "ReminderEmail", token: "raw-token-pending-ada", pulseName: "Body text" }),
    JSON.stringify({ _tag: "Pending", attempts: 0, lastCode: null }),
  );
  db.prepare("INSERT INTO email_outbox (send_id) VALUES ('ada-pending')").run();
  db.prepare(
    "INSERT INTO email_send (id, recipient, content, status, state) VALUES ('bob-added', 'bob@example.com', ?, 'Sent', ?)",
  ).run(
    JSON.stringify({
      _tag: "AddedToTeam",
      teamName: "Platform",
      leadName: "ada@example.com",
      signInUrl: "https://app.example.com/",
    }),
    JSON.stringify({ _tag: "Sent", messageId: "captured-bob-added", sentAt: 8100 }),
  );

  db.prepare(
    "INSERT INTO submission (id, round_id, edit_key_hash) VALUES ('submission', 'round', 'edit-key-hash-1')",
  ).run();
  db.prepare(
    "INSERT INTO answer (submission_id, question_version_id, value, comment) VALUES ('submission', 'qv', 4, 'a comment')",
  ).run();
  db.prepare(
    "INSERT INTO round_result (round_id, computed_at, payload) VALUES ('round', 1, '{\"team\":\"results\"}')",
  ).run();

  return db;
};

const seedD1 = (options: { readonly adaInGlobex: boolean }) => {
  const sqlite = migratedDatabase(d1Migrations);
  sqlite.exec(`
    INSERT INTO organization_index (organization_id, name) VALUES ('acme', 'Acme'), ('globex', 'Globex');
    INSERT INTO auth_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES
      ('user_admin', 'Admin', 'admin@example.com', 1, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
      ('user_ada', 'Ada', 'ada@example.com', 1, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
      ('user_bob', 'Bob', 'bob@example.com', 1, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
      ('user_stranger', 'Stranger', 'stranger@example.com', 1, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    INSERT INTO auth_session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES
      ('s-ada', '${FUTURE}', 'secret-session-token-ada', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', '203.0.113.7', 'Firefox-ada', 'user_ada'),
      ('s-bob', '${FUTURE}', 'secret-session-token-bob', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', '198.51.100.1', 'Safari-bob', 'user_bob'),
      ('s-stranger', '${FUTURE}', 'secret-session-token-stranger', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', '198.51.100.2', 'Safari-stranger', 'user_stranger');
    INSERT INTO auth_session_organization (session_id, organization_id) VALUES ('s-ada', 'acme'), ('s-bob', 'acme');
    INSERT INTO auth_account (id, accountId, providerId, userId, accessToken, refreshToken, idToken, password, scope, createdAt, updatedAt) VALUES
      ('acc-ada', 'user_ada', 'email-otp', 'user_ada', 'secret-access-token-ada', 'secret-refresh-token', 'secret-id-token', 'secret-password-hash', 'openid', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      ('acc-bob', 'user_bob', 'email-otp', 'user_bob', 'secret-access-token-bob', NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    INSERT INTO auth_passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, transports, createdAt, aaguid) VALUES
      ('pk-ada', 'Laptop', 'secret-public-key-ada', 'user_ada', 'secret-credential-id-ada', 5, 'multiDevice', 1, 'internal', '2026-03-01T00:00:00.000Z', 'secret-aaguid');
    INSERT INTO auth_verification (id, identifier, value, expiresAt, createdAt, updatedAt) VALUES
      ('v-ada', 'sign-in-otp-ada@example.com', 'secret-otp-ada:0', '${FUTURE}', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'),
      ('v-bob', 'sign-in-otp-bob@example.com', 'secret-otp-bob:0', '${FUTURE}', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z');
    INSERT INTO person_index (organization_id, person_id, email, auth_user_id) VALUES
      ('acme', 'acme-admin', 'admin@example.com', 'user_admin'),
      ('acme', 'acme-ada', 'ada@example.com', 'user_ada'),
      ('acme', 'acme-bob', 'bob@example.com', 'user_bob');
    INSERT INTO organization_claim (auth_user_id, organization_id, name, admin_person_id, completed_at) VALUES
      ('user_ada', 'acme', 'Acme', 'acme-ada', 1700000000000);
    INSERT INTO invitation_index (token_hash, organization_id, round_id, person_id, pulse_id) VALUES
      ('token-hash-acme-ada', 'acme', 'round', 'acme-ada', 'pulse'),
      ('token-hash-acme-bob', 'acme', 'round', 'acme-bob', 'pulse');
    INSERT INTO test_invitation_index (token_hash, organization_id, pulse_id, expires_at) VALUES
      ('test-hash-acme-ada', 'acme', 'pulse', 99999999999),
      ('test-hash-acme-bob', 'acme', 'pulse', 99999999999);
    INSERT INTO email_message (message_id, organization_id, send_id) VALUES
      ('captured-acme-ada', 'acme', 'acme-ada-send'),
      ('captured-acme-bob', 'acme', 'acme-bob-send');
    INSERT INTO captured_email (message_id, recipient, subject, html, text, captured_at) VALUES
      ('captured-acme-ada', 'ada@example.com', 'Subject', '<p>Body text for ada</p>', 'Body text for ada', 1),
      ('captured-acme-bob', 'bob@example.com', 'Subject', '<p>Body text for bob</p>', 'Body text for bob', 1);
    INSERT INTO submission_index (edit_key_hash, organization_id, round_id) VALUES ('edit-key-hash-1', 'acme', 'round');
  `);

  if (options.adaInGlobex) {
    sqlite.exec(`
      INSERT INTO person_index (organization_id, person_id, email, auth_user_id) VALUES
        ('globex', 'globex-ada', 'ada@example.com', 'user_ada');
      INSERT INTO invitation_index (token_hash, organization_id, round_id, person_id, pulse_id) VALUES
        ('token-hash-globex-ada', 'globex', 'round', 'globex-ada', 'pulse');
      INSERT INTO auth_session_organization (session_id, organization_id) VALUES ('s-ada', 'globex')
        ON CONFLICT (session_id) DO UPDATE SET organization_id = 'globex';
    `);
  }

  return sqlite;
};

const dump = (db: Database): string => {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name));

  return JSON.stringify(
    Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])),
  );
};

const tableOf = (db: Database, table: string): string =>
  JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());

const bobSnapshot = (db: Database): string =>
  JSON.stringify(
    [
      ["person", "id"],
      ["membership", "person_id"],
      ["participation", "person_id"],
      ["invitation", "person_id"],
      ["test_send", "person_id"],
    ].map(([table, column]) => db.prepare(`SELECT * FROM ${table} WHERE ${column} = ?`).all(BOB)),
  ) +
  JSON.stringify(
    db
      .prepare("SELECT id, recipient, status, state FROM email_send WHERE recipient = 'bob@example.com'")
      .all(),
  );

const memberOf = (id: PersonId): Member => ({
  organization: { id: ACME, name: "Acme" },
  personId: id,
  organizationAdmin: id !== BOB,
  locale: null,
  detectedLocale: null,
  organizationLocale: "en",
});

const world = (options: { readonly adaInGlobex?: boolean } = {}) => {
  const organization = seedOrganization();
  const index = seedD1({ adaInGlobex: options.adaInGlobex ?? false });

  const run = <A, E>(effect: Effect.Effect<A, E, OrganizationDirectory | PeopleIndex | RuntimeContext>) =>
    Effect.gen(function* () {
      const sql = yield* organizationSql(organization);
      const sends = makeSendStore(makeSqlSendRepository(sql), defaultSendPolicy);
      const directory = makeSqlDirectory(sql, sends);

      const durable = organizationDirectory({
        sql,
        rounds: makeSqlRounds(sql, secureRandomBytes),
        directory,
      });

      const people = yield* d1PeopleIndex(d1Client(index));

      const directoryRun: OrganizationDirectory["Service"]["run"] = (
        _organizationId,
        actorId,
        command,
        now,
      ) => durable.runDirectoryCommand(actorId, command, now);

      return yield* effect.pipe(
        Effect.provideService(OrganizationDirectory, {
          run: directoryRun,
        } as unknown as OrganizationDirectory["Service"]),
        Effect.provideService(PeopleIndex, people),
      );
    }).pipe(Effect.provideService(RuntimeContext, {} as RuntimeContext["Service"]));

  const erase = (actor: PersonId, target: PersonId, confirmation: string) =>
    run(
      runDirectoryCommand(memberOf(actor), {
        _tag: "ErasePerson",
        personId: target,
        confirmation: EmailAddress.make(confirmation),
      }).pipe(Effect.exit),
    );

  return { organization, index, run, erase };
};

const FORBIDDEN = [
  "ada@example.com",
  "user_ada",
  "acme-ada-send",
  "raw-token-acme-ada",
  "raw-token-pending-ada",
  "token-hash-acme-ada",
  "test-hash-acme-ada",
  "secret-session-token-ada",
  "secret-access-token-ada",
  "secret-refresh-token",
  "secret-id-token",
  "secret-password-hash",
  "secret-public-key-ada",
  "secret-credential-id-ada",
  "secret-otp-ada",
  "203.0.113.7",
  "Firefox-ada",
  "Body text for ada",
  "captured-acme-ada",
];

const ANONYMOUS_TABLES = ["submission", "answer", "round_result"];

describe("erasing a Person leaves no personal data behind (GDPR 307)", () => {
  it.effect(
    "removes the Person everywhere while the anonymous Submissions and Results stay as they were",
    () =>
      Effect.gen(function* () {
        const { organization, index, erase } = world();
        const anonymousBefore = ANONYMOUS_TABLES.map((table) => tableOf(organization, table));
        const indexBefore = tableOf(index, "submission_index");

        const exit = yield* erase(ADMIN, ADA, "ada@example.com");

        assert.strictEqual(exit._tag, "Success");

        const durable = dump(organization);
        const global = dump(index);

        for (const marker of FORBIDDEN) {
          assert.notInclude(durable, marker, `${marker} in the Organization database`);
          assert.notInclude(global, marker, `${marker} in D1`);
        }

        assert.deepStrictEqual(
          ANONYMOUS_TABLES.map((table) => tableOf(organization, table)),
          anonymousBefore,
        );
        assert.strictEqual(tableOf(index, "submission_index"), indexBefore);
        assert.include(durable, "erased-acme-ada@erased.invalid");
      }),
  );

  it.effect("scrubs the Person row, ends the Memberships and keeps the history rows", () =>
    Effect.gen(function* () {
      const { organization, erase } = world();

      yield* erase(ADMIN, ADA, "ada@example.com");

      const person = organization.prepare("SELECT * FROM person WHERE id = ?").get(ADA);

      assert.strictEqual(person?.email, "erased-acme-ada@erased.invalid");

      for (const column of ["auth_user_id", "time_zone", "locale", "detected_locale"]) {
        assert.isNull(person?.[column], column);
      }

      assert.strictEqual(person?.organization_admin, 0);

      const row = organization.prepare("SELECT removed_at, erased_at FROM person WHERE id = ?").get(ADA);

      assert.isNumber(row?.removed_at);
      assert.strictEqual(row?.removed_at, row?.erased_at);
      assert.isNumber(
        organization.prepare("SELECT ended_at FROM membership WHERE person_id = ?").get(ADA)?.ended_at,
      );
      assert.strictEqual(
        organization.prepare("SELECT count(*) AS n FROM action WHERE owner_id = ?").get(ADA)?.n,
        1,
      );

      for (const table of [
        "participation",
        "round_member",
        "invitation",
        "pulse_reminder_opt_out",
        "test_send",
      ]) {
        assert.strictEqual(
          organization.prepare(`SELECT count(*) AS n FROM ${table} WHERE person_id = ?`).get(ADA)?.n,
          0,
          table,
        );
      }

      assert.strictEqual(
        organization.prepare("SELECT count(*) AS n FROM email_send WHERE id = 'ada-pending'").get()?.n,
        0,
      );
      assert.strictEqual(organization.prepare("SELECT count(*) AS n FROM email_outbox").get()?.n, 0);
    }),
  );

  it.effect("leaves every other Person's rows untouched", () =>
    Effect.gen(function* () {
      const { organization, index, erase } = world();
      const bobRows = bobSnapshot(organization);

      yield* erase(ADMIN, ADA, "ada@example.com");

      assert.strictEqual(bobSnapshot(organization), bobRows);
      assert.strictEqual(
        index.prepare("SELECT count(*) AS n FROM auth_user WHERE id = 'user_bob'").get()?.n,
        1,
      );
      assert.strictEqual(
        index.prepare("SELECT count(*) AS n FROM invitation_index WHERE person_id = 'acme-bob'").get()?.n,
        1,
      );
      assert.strictEqual(
        index.prepare("SELECT count(*) AS n FROM captured_email WHERE message_id = 'captured-acme-bob'").get()
          ?.n,
        1,
      );
    }),
  );

  it.effect("replaces the erased Person's address in an email they sent to someone else", () =>
    Effect.gen(function* () {
      const { organization, erase } = world();

      yield* erase(ADA, ADA, "ada@example.com");

      const content = String(
        organization.prepare("SELECT content FROM email_send WHERE id = 'bob-added'").get()?.content,
      );

      assert.notInclude(content, "ada@example.com");
      assert.include(content, "erased-acme-ada@erased.invalid");
    }),
  );

  it.effect("keeps the sign-in account while another Organization still holds a Person, then drops it", () =>
    Effect.gen(function* () {
      const { index, erase, run } = world({ adaInGlobex: true });

      assert.strictEqual((yield* erase(ADA, ADA, "ada@example.com"))._tag, "Success");

      const kept = dump(index);

      assert.include(kept, "user_ada");
      assert.include(kept, "secret-session-token-ada");
      assert.include(kept, "globex-ada");
      assert.include(kept, "token-hash-globex-ada");
      assert.notInclude(kept, "acme-ada");
      assert.notInclude(kept, "token-hash-acme-ada");
      assert.strictEqual(
        index.prepare("SELECT count(*) AS n FROM organization_claim WHERE auth_user_id = 'user_ada'").get()
          ?.n,
        0,
      );
      assert.strictEqual(
        index
          .prepare("SELECT count(*) AS n FROM auth_session_organization WHERE organization_id = 'acme'")
          .get()?.n,
        1,
      );

      yield* run(
        Effect.flatMap(PeopleIndex, (people) =>
          people.erasePerson({
            organizationId: GLOBEX,
            personId: PersonId.make("globex-ada"),
            userId: Option.some(AuthUserId.make("user_ada")),
            sendIds: [],
            testTokenHashes: [],
          }),
        ),
      );

      const gone = dump(index);

      for (const marker of FORBIDDEN) {
        assert.notInclude(gone, marker, marker);
      }

      assert.notInclude(gone, "globex-ada");
      assert.include(gone, "user_bob");
    }),
  );

  it.effect("refuses the only Lead and the only Organization admin, and changes nothing", () =>
    Effect.gen(function* () {
      const { organization, index, erase } = world();
      yield* erase(ADMIN, ADA, "ada@example.com");
      const before = [dump(organization), dump(index)];

      const lead = yield* erase(ADMIN, ADMIN, "admin@example.com");

      assert.strictEqual(lead._tag, "Failure");
      assert.deepStrictEqual([dump(organization), dump(index)], before);
    }),
  );

  it.effect("changes nothing when the address typed is not the Person's", () =>
    Effect.gen(function* () {
      const { organization, index, erase } = world();
      const before = [dump(organization), dump(index)];

      const exit = yield* erase(ADMIN, ADA, "someone-else@example.com");

      assert.strictEqual(exit._tag, "Failure");
      assert.deepStrictEqual([dump(organization), dump(index)], before);
    }),
  );

  it.effect("does not let a stranger or a member erase someone else", () =>
    Effect.gen(function* () {
      const { organization, index, erase } = world();
      const before = [dump(organization), dump(index)];

      const exit = yield* erase(BOB, ADA, "ada@example.com");

      assert.strictEqual(exit._tag, "Failure");
      assert.deepStrictEqual([dump(organization), dump(index)], before);
    }),
  );

  it.effect("does not reconnect a later sign-in with the same address to the erased Person", () =>
    Effect.gen(function* () {
      const { organization, run, erase } = world();

      yield* erase(ADMIN, ADA, "ada@example.com");

      const sql = yield* organizationSql(organization);

      const durable = organizationDirectory({
        sql,
        rounds: makeSqlRounds(sql, secureRandomBytes),
        directory: makeSqlDirectory(sql, makeSendStore(makeSqlSendRepository(sql), defaultSendPolicy)),
      });

      const found = yield* run(
        Effect.gen(function* () {
          const people = yield* PeopleIndex;

          return {
            linked: yield* people.linkedPersons(AuthUserId.make("user_ada")),
            unlinked: yield* people.unlinkedPersons(EmailAddress.make("ada@example.com")),
          };
        }),
      );

      assert.deepStrictEqual(found, { linked: [], unlinked: [] });
      assert.isNull(yield* durable.activePerson("user_ada"));
      assert.isFalse(yield* durable.linkPerson(ADA, "user_new", "ada@example.com"));
      assert.isFalse(yield* durable.linkPerson(ADA, "user_new", "erased-acme-ada@erased.invalid"));
      assert.isNull(yield* organizationPersonalData(sql).exportPersonalData("user_ada"));
      assert.isNull(yield* organizationPersonalData(sql).exportPersonalData("user_new"));
    }),
  );

  it.effect("erases a sign-in account that belongs to no Organization, and refuses one that still does", () =>
    Effect.gen(function* () {
      const { index, run } = world();

      const attempt = (userId: string) =>
        run(Effect.flatMap(PeopleIndex, (people) => people.eraseAccount(AuthUserId.make(userId))));

      assert.isFalse(yield* attempt("user_ada"));
      assert.include(dump(index), "user_ada");

      assert.isTrue(yield* attempt("user_stranger"));

      const after = dump(index);

      assert.notInclude(after, "user_stranger");
      assert.notInclude(after, "stranger@example.com");
      assert.notInclude(after, "secret-session-token-stranger");
      assert.include(after, "user_bob");

      assert.isTrue(yield* attempt("user_stranger"));
    }),
  );
});
