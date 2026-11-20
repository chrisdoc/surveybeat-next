import { SqliteClient } from "@effect/sql-sqlite-do";
import type * as Cloudflare from "@alchemy.run/cloudflare";
import { assert, describe, it } from "@effect/vitest";
import {
  AuthUserId,
  defaultSendPolicy,
  identityOf,
  makeSendStore,
  offboardOrganization,
  OFFBOARDING_EXPORT_FILENAME,
  OrganizationDirectory,
  OrganizationId,
  OrganizationOffboarding,
  OrganizationOffboardingExport,
  PeopleIndex,
  PersonId,
  SessionId,
} from "@surveybeat/domain";
import type { CheckedSession, Member } from "@surveybeat/domain";
import { migratedDatabase, SqliteStorage } from "@surveybeat/testing";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { d1OrganizationOffboarding } from "./auth/D1OrganizationOffboarding.ts";
import { d1PeopleIndex } from "./auth/D1PeopleIndex.ts";
import { activePersonUnlessWiped, organizationOffboarding } from "./organization/Offboarding.ts";
import { makeSqlDirectory } from "./SqlDirectory.ts";
import { makeSqlPulses } from "./SqlPulses.ts";
import { makeSqlSendRepository } from "./SqlSendRepository.ts";

type Database = ReturnType<typeof migratedDatabase>;

const migrations = new URL("../migrations/", import.meta.url);

const d1Migrations = new URL("../d1-migrations/", import.meta.url);

const FUTURE = "2026-12-20T12:00:00.000Z";

const ACME = OrganizationId.make("acme");

const ADMIN = PersonId.make("acme-admin");

const ADA = PersonId.make("acme-ada");

const BOB = PersonId.make("acme-bob");

const ORGANIZATION_NAME = "Acme Inc";

const USER_ADMIN = AuthUserId.make("user_admin");

const USER_ADA = AuthUserId.make("user_ada");

const USER_BOB = AuthUserId.make("user_bob");

const d1Client = (sqlite: Database) => {
  const statement = (sql: string, binds: readonly unknown[]) => {
    const values = binds as (null | string | number)[];

    return {
      bind: (...next: readonly unknown[]) => statement(sql, next),
      all: () => Effect.sync(() => ({ results: sqlite.prepare(sql).all(...values) })),
      run: () => Effect.sync(() => sqlite.prepare(sql).run(...values)),
      sql,
      values,
    };
  };

  const batch = (statements: readonly ReturnType<typeof statement>[]) =>
    Effect.sync(() => {
      sqlite.exec("BEGIN");

      try {
        const results = statements.map((each) => sqlite.prepare(each.sql).run(...each.values));
        sqlite.exec("COMMIT");

        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    });

  return {
    prepare: (sql: string) => statement(sql, []),
    batch,
  } as unknown as Cloudflare.D1.QueryDatabaseClient;
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
  db.prepare(
    "INSERT INTO organization (id, name, minimum_group_size, ai_processing, default_locale) VALUES ('acme', ?, 5, 1, 'en')",
  ).run(ORGANIZATION_NAME);
  db.prepare(
    "INSERT INTO team (id, name, time_zone) VALUES ('team', 'Platform Team', 'Europe/Berlin')",
  ).run();

  const people: readonly (readonly [string, string, string, number])[] = [
    [ADMIN, "admin@example.com", "user_admin", 1],
    [ADA, "ada@example.com", "user_ada", 0],
    [BOB, "bob@example.com", "user_bob", 0],
  ];

  for (const [id, email, userId, admin] of people) {
    db.prepare(
      `INSERT INTO person (id, email, auth_user_id, organization_admin, time_zone, locale, detected_locale)
       VALUES (?, ?, ?, ?, 'Europe/Berlin', 'en', 'en')`,
    ).run(id, email, userId, admin);
    db.prepare(
      "INSERT INTO membership (id, team_id, person_id, role, started_at, ended_at) VALUES (?, 'team', ?, ?, 1000, NULL)",
    ).run(`${id}-m`, id, id === ADA ? "lead" : "member");
  }

  db.prepare("INSERT INTO question (id, template_key, created_at) VALUES ('question', NULL, 1000)").run();
  db.prepare(
    `INSERT INTO question_version (id, question_id, number, text, dimension, type)
     VALUES ('question.1', 'question', 1, 'Do you know what is expected of you?', 'clarity',
             '{"_tag":"Rating","lowLabel":"Never","highLabel":"Always","comment":true}')`,
  ).run();
  db.prepare(
    `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
     VALUES ('pulse', 'team', 'Weekly check-in', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
  ).run();
  db.prepare(
    "INSERT INTO pulse_question (pulse_id, position, question_version_id) VALUES ('pulse', 0, 'question.1')",
  ).run();
  db.prepare(
    `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
     VALUES ('round', 'pulse', 'team', 'closed', '2026-11-16', 1000, 9999999, 'Weekly check-in', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
  ).run();
  db.prepare(
    `INSERT INTO invitation (round_id, person_id, token_hash, send_id, status, resend_count, created_at, updated_at)
     VALUES ('round', ?, 'token-hash-secret-ada', 'ada-send', 'sent', 0, 2000, 3000)`,
  ).run(ADA);
  db.prepare(
    "INSERT INTO email_send (id, recipient, content, status, state) VALUES ('ada-send', 'ada@example.com', ?, 'Sent', ?)",
  ).run(
    JSON.stringify({
      _tag: "InvitationEmail",
      token: "raw-token-secret-ada",
      pulseName: "Email body secret",
    }),
    JSON.stringify({ _tag: "Sent", messageId: "captured-acme-ada", sentAt: 8000 }),
  );
  db.prepare(
    `INSERT INTO action (id, team_id, round_id, title, owner_id, due_date, dimension, status, created_at, updated_at, done_at)
     VALUES ('action', 'team', 'round', 'ACTION-TITLE-MARKER', ?, '2026-12-01', 'clarity', 'committed', 6000, 7000, NULL)`,
  ).run(ADA);
  db.prepare(
    "INSERT INTO round_note (round_id, team_id, text, updated_at) VALUES ('round', 'team', 'NOTE-TEXT-MARKER', 1)",
  ).run();
  db.prepare(
    "INSERT INTO submission (id, round_id, edit_key_hash) VALUES ('submission', 'round', 'edit-key-hash-secret')",
  ).run();
  db.prepare(
    "INSERT INTO answer (submission_id, question_version_id, value, comment) VALUES ('submission', 'question.1', 4713, 'COMMENT-TEXT-MARKER')",
  ).run();
  db.prepare(
    "INSERT INTO round_result (round_id, computed_at, payload) VALUES ('round', 1, '{\"average\":\"RESULT-NUMBER-MARKER-8123\"}')",
  ).run();

  return db;
};

const seedD1 = (options: { readonly adaRemovedInGlobex: boolean }) => {
  const sqlite = migratedDatabase(d1Migrations);
  sqlite.exec(`
    INSERT INTO organization_index (organization_id, name) VALUES ('acme', '${ORGANIZATION_NAME}'), ('globex', 'Globex');
    INSERT INTO auth_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES
      ('user_admin', 'Admin', 'admin@example.com', 1, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
      ('user_ada', 'Ada', 'ada@example.com', 1, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
      ('user_bob', 'Bob', 'bob@example.com', 1, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
      ('user_globex', 'Gina', 'gina@example.com', 1, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    INSERT INTO auth_session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES
      ('s-admin', '${FUTURE}', 'session-token-admin', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', '203.0.113.7', 'Firefox', 'user_admin'),
      ('s-ada', '${FUTURE}', 'session-token-ada', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', '203.0.113.8', 'Firefox', 'user_ada'),
      ('s-globex', '${FUTURE}', 'session-token-globex', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', '203.0.113.9', 'Firefox', 'user_globex');
    INSERT INTO auth_session_organization (session_id, organization_id) VALUES
      ('s-admin', 'acme'), ('s-ada', 'acme'), ('s-globex', 'globex');
    INSERT INTO auth_account (id, accountId, providerId, userId, accessToken, createdAt, updatedAt) VALUES
      ('acc-admin', 'user_admin', 'email-otp', 'user_admin', 'access-admin', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      ('acc-ada', 'user_ada', 'email-otp', 'user_ada', 'access-ada', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      ('acc-bob', 'user_bob', 'email-otp', 'user_bob', 'access-bob', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    INSERT INTO person_index (organization_id, person_id, email, auth_user_id) VALUES
      ('acme', 'acme-admin', 'admin@example.com', 'user_admin'),
      ('acme', 'acme-ada', 'ada@example.com', 'user_ada'),
      ('acme', 'acme-bob', 'bob@example.com', 'user_bob'),
      ('globex', 'globex-gina', 'gina@example.com', 'user_globex');
    INSERT INTO organization_claim (auth_user_id, organization_id, name, admin_person_id, completed_at) VALUES
      ('user_admin', 'acme', '${ORGANIZATION_NAME}', 'acme-admin', 1700000000000),
      ('user_globex', 'globex', 'Globex', 'globex-gina', 1700000000000);
    INSERT INTO invitation_index (token_hash, organization_id, round_id, person_id, pulse_id) VALUES
      ('token-hash-secret-ada', 'acme', 'round', 'acme-ada', 'pulse'),
      ('token-hash-globex', 'globex', 'round', 'globex-gina', 'pulse');
    INSERT INTO test_invitation_index (token_hash, organization_id, pulse_id, expires_at) VALUES
      ('test-hash-acme', 'acme', 'pulse', 99999999999),
      ('test-hash-globex', 'globex', 'pulse', 99999999999);
    INSERT INTO test_submission_index (edit_key_hash, organization_id, pulse_id, expires_at) VALUES
      ('test-edit-acme', 'acme', 'pulse', 99999999999),
      ('test-edit-globex', 'globex', 'pulse', 99999999999);
    INSERT INTO submission_index (edit_key_hash, organization_id, round_id) VALUES
      ('edit-key-hash-secret', 'acme', 'round'),
      ('edit-key-hash-globex', 'globex', 'round');
    INSERT INTO email_message (message_id, organization_id, send_id) VALUES
      ('captured-acme-ada', 'acme', 'ada-send'),
      ('captured-globex-gina', 'globex', 'gina-send');
    INSERT INTO captured_email (message_id, recipient, subject, html, text, captured_at) VALUES
      ('captured-acme-ada', 'ada@example.com', 'Subject', '<p>Acme body</p>', 'Acme body', 1),
      ('captured-globex-gina', 'gina@example.com', 'Subject', '<p>Globex body</p>', 'Globex body', 1),
      ('captured-sign-in', 'ada@example.com', 'Your sign-in code', '<p>Code</p>', 'Code', 1);
  `);

  sqlite.exec(`
    INSERT INTO person_index (organization_id, person_id, email, auth_user_id, removed_at) VALUES
      ('globex', 'globex-ada', 'ada@example.com', 'user_ada', ${options.adaRemovedInGlobex ? "5000" : "NULL"});
  `);

  return sqlite;
};

const rowsOf = (db: Database, table: string, column: string, value: string): number => {
  const row = db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`).get(value);

  return Number(row?.n);
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

const ORGANIZATION_TABLES: readonly (readonly [string, string])[] = [
  ["invitation_index", "organization_id"],
  ["test_invitation_index", "organization_id"],
  ["test_submission_index", "organization_id"],
  ["submission_index", "organization_id"],
  ["auth_session_organization", "organization_id"],
  ["person_index", "organization_id"],
  ["organization_claim", "organization_id"],
  ["organization_offboarding", "organization_id"],
  ["organization_index", "organization_id"],
  ["email_message", "organization_id"],
];

const memberOf = (id: PersonId, organizationAdmin: boolean): Member => ({
  organization: { id: ACME, name: ORGANIZATION_NAME },
  personId: id,
  organizationAdmin,
  locale: null,
  detectedLocale: null,
  organizationLocale: "en",
});

const checkedAs = (userId: AuthUserId, member: Option.Option<Member>): CheckedSession => ({
  session: {
    identity: identityOf(userId, `${userId}@example.com`, true),
    sessionId: SessionId.make(`session-of-${userId}`),
  },
  member,
});

interface StorageCall {
  readonly name: "markWiped" | "deleteAlarm" | "deleteAll";
}

const world = (options: { readonly adaRemovedInGlobex?: boolean } = {}) => {
  const organization = seedOrganization();
  const index = seedD1({ adaRemovedInGlobex: options.adaRemovedInGlobex ?? false });
  const calls: StorageCall[] = [];
  const confirmations: string[] = [];

  const storage = {
    deleteAlarm: () => {
      calls.push({ name: "deleteAlarm" });

      return Promise.resolve();
    },
    deleteAll: () => {
      calls.push({ name: "deleteAll" });

      return Promise.resolve();
    },
  };

  const durable = Effect.gen(function* () {
    const sql = yield* organizationSql(organization);
    const sends = makeSendStore(makeSqlSendRepository(sql), defaultSendPolicy);

    return organizationOffboarding({
      sql,
      directory: makeSqlDirectory(sql, sends),
      pulses: makeSqlPulses(sql),
      storage,
      onWipe: () => {
        calls.push({ name: "markWiped" });
      },
    });
  });

  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      OrganizationDirectory | OrganizationOffboarding | PeopleIndex | RuntimeContext
    >,
  ) =>
    Effect.gen(function* () {
      const offboarding = yield* durable;

      const directory = {
        confirmOffboarding: (_organizationId: OrganizationId, actorId: PersonId, confirmation: string) => {
          confirmations.push(confirmation);

          return offboarding.confirmOffboarding(actorId, confirmation);
        },
        offboardingExport: (_organizationId: OrganizationId, actorId: PersonId, now: number) =>
          offboarding.viewOffboardingExport(actorId, now),
      } as unknown as OrganizationDirectory["Service"];

      const people = yield* d1PeopleIndex(d1Client(index));

      const offboardingIndex = yield* d1OrganizationOffboarding(d1Client(index), () =>
        offboarding.wipeOrganization(),
      );

      return yield* effect.pipe(
        Effect.provideService(OrganizationDirectory, directory),
        Effect.provideService(PeopleIndex, people),
        Effect.provideService(OrganizationOffboarding, offboardingIndex),
      );
    }).pipe(Effect.provideService(RuntimeContext, {} as RuntimeContext["Service"]));

  const offboard = (checked: CheckedSession, confirmation: string) =>
    run(offboardOrganization(checked, confirmation).pipe(Effect.exit));

  return { organization, index, calls, confirmations, run, durable, offboard };
};

const FORBIDDEN_IN_EXPORT = [
  "RESULT-NUMBER-MARKER-8123",
  "COMMENT-TEXT-MARKER",
  "ACTION-TITLE-MARKER",
  "NOTE-TEXT-MARKER",
  "4713",
  "token-hash-secret-ada",
  "raw-token-secret-ada",
  "edit-key-hash-secret",
  "Email body secret",
  "user_ada",
  "user_admin",
  "session-token-admin",
];

describe("the offboarding export hands over only what an Organization admin can administer (ADR 0028)", () => {
  it.effect("holds the admin-visible records and no Result, comment, Action, Note, Answer or token", () =>
    Effect.gen(function* () {
      const { durable } = world();
      const offboarding = yield* durable;

      const viewed = yield* offboarding.viewOffboardingExport(ADMIN, 1_760_000_000_000);

      assert.strictEqual(viewed._tag, "Viewed");

      if (viewed._tag !== "Viewed") {
        return;
      }

      const json = JSON.stringify(viewed.value);

      for (const wanted of [
        "ada@example.com",
        "Platform Team",
        "Do you know what is expected of you?",
        "Weekly check-in",
        ORGANIZATION_NAME,
        "Europe/Berlin",
      ]) {
        assert.include(json, wanted);
      }

      for (const secret of FORBIDDEN_IN_EXPORT) {
        assert.notInclude(json, secret);
      }

      assert.strictEqual(viewed.value.memberships.length, 3);
      assert.strictEqual(viewed.value.organization.minimumGroupSize, 5);
      assert.strictEqual(OFFBOARDING_EXPORT_FILENAME, "surveybeat-organization.json");
      yield* Schema.decodeUnknownEffect(OrganizationOffboardingExport)(JSON.parse(json));
    }),
  );

  it.effect("refuses a Team Lead and a member", () =>
    Effect.gen(function* () {
      const { durable } = world();
      const offboarding = yield* durable;

      for (const person of [ADA, BOB]) {
        const viewed = yield* offboarding.viewOffboardingExport(person, 1);

        assert.deepStrictEqual(viewed, { _tag: "Rejected", rejection: { _tag: "Forbidden" } });
      }
    }),
  );
});

describe("offboarding an Organization removes it everywhere and nothing else (GDPR 308)", () => {
  it.effect("leaves this Organization with no D1 rows and the other Organization untouched", () =>
    Effect.gen(function* () {
      const { index, calls, offboard } = world();

      const exit = yield* offboard(
        checkedAs(USER_ADMIN, Option.some(memberOf(ADMIN, true))),
        ORGANIZATION_NAME,
      );

      assert.strictEqual(exit._tag, "Success");

      for (const [table, column] of ORGANIZATION_TABLES) {
        assert.strictEqual(rowsOf(index, table, column, "acme"), 0, table);
      }

      assert.strictEqual(
        Number(
          index
            .prepare("SELECT count(*) AS n FROM captured_email WHERE message_id = 'captured-acme-ada'")
            .get()?.n,
        ),
        0,
      );

      assert.strictEqual(rowsOf(index, "person_index", "organization_id", "globex"), 2);
      assert.strictEqual(rowsOf(index, "invitation_index", "organization_id", "globex"), 1);
      assert.strictEqual(rowsOf(index, "submission_index", "organization_id", "globex"), 1);
      assert.strictEqual(rowsOf(index, "organization_index", "organization_id", "globex"), 1);
      assert.strictEqual(rowsOf(index, "captured_email", "message_id", "captured-globex-gina"), 1);
      assert.strictEqual(rowsOf(index, "captured_email", "message_id", "captured-sign-in"), 1);
      assert.deepStrictEqual(
        calls.map((call) => call.name),
        ["markWiped", "deleteAlarm", "deleteAll"],
      );
    }),
  );

  it.effect("deletes an account that only belonged here and keeps one with a Person elsewhere", () =>
    Effect.gen(function* () {
      const { index, offboard } = world();

      yield* offboard(checkedAs(USER_ADMIN, Option.some(memberOf(ADMIN, true))), ORGANIZATION_NAME);

      assert.strictEqual(rowsOf(index, "auth_user", "id", "user_admin"), 0);
      assert.strictEqual(rowsOf(index, "auth_user", "id", "user_bob"), 0);
      assert.strictEqual(rowsOf(index, "auth_session", "userId", "user_admin"), 0);
      assert.strictEqual(rowsOf(index, "auth_account", "userId", "user_bob"), 0);
      assert.strictEqual(rowsOf(index, "auth_user", "id", "user_ada"), 1);
      assert.strictEqual(rowsOf(index, "auth_account", "userId", "user_ada"), 1);
      assert.strictEqual(rowsOf(index, "person_index", "person_id", "globex-ada"), 1);
      assert.strictEqual(rowsOf(index, "auth_user", "id", "user_globex"), 1);
    }),
  );

  it.effect("keeps an account whose Person in another Organization was only removed", () =>
    Effect.gen(function* () {
      const { index, offboard } = world({ adaRemovedInGlobex: true });

      yield* offboard(checkedAs(USER_ADMIN, Option.some(memberOf(ADMIN, true))), ORGANIZATION_NAME);

      assert.strictEqual(rowsOf(index, "auth_user", "id", "user_ada"), 1);
      assert.strictEqual(
        Number(
          index.prepare("SELECT removed_at AS n FROM person_index WHERE person_id = 'globex-ada'").get()?.n,
        ),
        5000,
      );
    }),
  );

  it.effect("changes nothing on a wrong confirmation and writes no offboarding row", () =>
    Effect.gen(function* () {
      const { organization, index, calls, offboard } = world();
      const before = [dump(organization), dump(index)];

      for (const wrong of ["", "acme inc", "Acme Inc ", "Acme", "Globex"]) {
        const exit = yield* offboard(checkedAs(USER_ADMIN, Option.some(memberOf(ADMIN, true))), wrong);

        assert.strictEqual(exit._tag, "Failure", wrong);
        assert.include(JSON.stringify(exit), "ErasureNotConfirmed");
      }

      assert.deepStrictEqual([dump(organization), dump(index)], before);
      assert.strictEqual(
        Number(index.prepare("SELECT count(*) AS n FROM organization_offboarding").get()?.n),
        0,
      );
      assert.deepStrictEqual(calls, []);
    }),
  );

  it.effect("refuses a member and a Team Lead even with the right name", () =>
    Effect.gen(function* () {
      const { organization, index, calls, offboard } = world();
      const before = [dump(organization), dump(index)];

      for (const [user, person] of [
        [USER_BOB, BOB],
        [USER_ADA, ADA],
      ] as const) {
        const exit = yield* offboard(
          checkedAs(user, Option.some(memberOf(person, false))),
          ORGANIZATION_NAME,
        );

        assert.strictEqual(exit._tag, "Failure");
        assert.include(JSON.stringify(exit), "Forbidden");
      }

      assert.deepStrictEqual([dump(organization), dump(index)], before);
      assert.deepStrictEqual(calls, []);
    }),
  );

  it.effect("refuses an account that is not in the Organization and has no pending offboarding", () =>
    Effect.gen(function* () {
      const { organization, index, calls, offboard } = world();
      const before = [dump(organization), dump(index)];

      const exit = yield* offboard(checkedAs(USER_ADA, Option.none()), ORGANIZATION_NAME);

      assert.strictEqual(exit._tag, "Failure");
      assert.include(JSON.stringify(exit), "Forbidden");
      assert.deepStrictEqual([dump(organization), dump(index)], before);
      assert.deepStrictEqual(calls, []);
    }),
  );

  it.effect("makes Invitation tokens and Edit keys find nothing", () =>
    Effect.gen(function* () {
      const { index, offboard } = world();

      const invitation = () =>
        index
          .prepare(
            "SELECT organization_id, round_id, person_id, pulse_id FROM invitation_index WHERE token_hash = ?",
          )
          .get("token-hash-secret-ada");

      const edit = () =>
        index
          .prepare("SELECT organization_id, round_id FROM submission_index WHERE edit_key_hash = ?")
          .get("edit-key-hash-secret");

      assert.isDefined(invitation());
      assert.isDefined(edit());

      yield* offboard(checkedAs(USER_ADMIN, Option.some(memberOf(ADMIN, true))), ORGANIZATION_NAME);

      assert.isUndefined(invitation());
      assert.isUndefined(edit());
    }),
  );

  it.effect("does nothing when the D1 deletes run again after success", () =>
    Effect.gen(function* () {
      const { organization, index, run, offboard } = world();

      yield* offboard(checkedAs(USER_ADMIN, Option.some(memberOf(ADMIN, true))), ORGANIZATION_NAME);

      const settled = [dump(organization), dump(index)];

      const accounts = yield* run(
        Effect.gen(function* () {
          const offboarding = yield* OrganizationOffboarding;
          yield* offboarding.revokeAccess(ACME);
          yield* offboarding.wipe(ACME);

          return yield* offboarding.removeIndex(ACME);
        }),
      );

      assert.deepStrictEqual(accounts, []);
      assert.deepStrictEqual([dump(organization), dump(index)], settled);
    }),
  );

  it.effect("lets the same admin finish after a crash that followed the wipe", () =>
    Effect.gen(function* () {
      const { index, calls, run, offboard } = world();

      yield* run(
        Effect.gen(function* () {
          const offboarding = yield* OrganizationOffboarding;
          yield* offboarding.begin(ACME, USER_ADMIN, 1);
          yield* offboarding.revokeAccess(ACME);
          yield* offboarding.wipe(ACME);
        }),
      );

      const stranger = yield* offboard(checkedAs(USER_ADA, Option.none()), ORGANIZATION_NAME);

      assert.strictEqual(stranger._tag, "Failure");
      assert.strictEqual(rowsOf(index, "person_index", "organization_id", "acme"), 3);

      const exit = yield* offboard(checkedAs(USER_ADMIN, Option.none()), "");

      assert.strictEqual(exit._tag, "Success");

      for (const [table, column] of ORGANIZATION_TABLES) {
        assert.strictEqual(rowsOf(index, table, column, "acme"), 0, table);
      }

      assert.strictEqual(rowsOf(index, "auth_user", "id", "user_admin"), 0);
      assert.strictEqual(rowsOf(index, "person_index", "organization_id", "globex"), 2);
      assert.strictEqual(calls.filter((call) => call.name === "deleteAll").length, 2);
    }),
  );

  it.effect(
    "finishes the pending Organization when the session is a member of another one with the same name",
    () =>
      Effect.gen(function* () {
        const { index, confirmations, run, offboard } = world();

        yield* run(
          Effect.gen(function* () {
            yield* (yield* OrganizationOffboarding).begin(ACME, USER_ADMIN, 1);
          }),
        );

        const exit = yield* offboard(
          {
            ...checkedAs(USER_ADMIN, Option.none()),
            member: Option.some({
              organization: { id: OrganizationId.make("globex"), name: ORGANIZATION_NAME },
              personId: ADMIN,
              organizationAdmin: true,
              locale: null,
              detectedLocale: null,
              organizationLocale: "en",
            }),
          },
          ORGANIZATION_NAME,
        );

        assert.strictEqual(exit._tag, "Success");
        assert.deepStrictEqual(confirmations, []);

        for (const [table, column] of ORGANIZATION_TABLES) {
          assert.strictEqual(rowsOf(index, table, column, "acme"), 0, table);
        }

        assert.strictEqual(rowsOf(index, "person_index", "organization_id", "globex"), 2);
        assert.strictEqual(rowsOf(index, "organization_index", "organization_id", "globex"), 1);
        assert.strictEqual(rowsOf(index, "invitation_index", "organization_id", "globex"), 1);
        assert.strictEqual(rowsOf(index, "submission_index", "organization_id", "globex"), 1);
      }),
  );

  it.effect("finds no pending offboarding and writes nothing for an account that never confirmed", () =>
    Effect.gen(function* () {
      const { organization, index, run } = world();
      const before = [dump(organization), dump(index)];

      const pending = yield* run(
        Effect.gen(function* () {
          return yield* (yield* OrganizationOffboarding).pending(USER_ADMIN);
        }),
      );

      assert.isTrue(Option.isNone(pending));
      assert.deepStrictEqual([dump(organization), dump(index)], before);
    }),
  );

  it.effect("refuses to begin when another account's offboarding row is there", () =>
    Effect.gen(function* () {
      const { index, run, offboard } = world();

      yield* run(
        Effect.gen(function* () {
          yield* (yield* OrganizationOffboarding).begin(ACME, USER_ADA, 1);
        }),
      );

      const exit = yield* offboard(
        checkedAs(USER_ADMIN, Option.some(memberOf(ADMIN, true))),
        ORGANIZATION_NAME,
      );

      assert.strictEqual(exit._tag, "Failure");
      assert.include(JSON.stringify(exit), "Forbidden");
      assert.strictEqual(rowsOf(index, "person_index", "organization_id", "acme"), 3);
    }),
  );
});

describe("wiping the Durable Object", () => {
  it.effect("deletes the alarm and then everything, and is safe to repeat", () =>
    Effect.gen(function* () {
      const { durable, calls } = world();
      const offboarding = yield* durable;

      yield* offboarding.wipeOrganization();
      yield* offboarding.wipeOrganization();

      assert.deepStrictEqual(
        calls.map((call) => call.name),
        ["markWiped", "deleteAlarm", "deleteAll", "markWiped", "deleteAlarm", "deleteAll"],
      );
    }),
  );

  it.effect("returns no Person and does not read storage after the wipe has started", () =>
    Effect.gen(function* () {
      let reads = 0;

      const absent = yield* activePersonUnlessWiped(
        true,
        Effect.sync(() => {
          reads += 1;

          return { id: "still-there" };
        }),
      );

      assert.isNull(absent);
      assert.strictEqual(reads, 0);

      const kept = yield* activePersonUnlessWiped(false, Effect.succeed({ id: "kept" }));

      assert.deepStrictEqual(kept, { id: "kept" });
    }),
  );
});
