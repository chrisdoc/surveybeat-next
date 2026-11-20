import { SqliteClient } from "@effect/sql-sqlite-do";
import type * as Cloudflare from "@alchemy.run/cloudflare";
import { assert, describe, it } from "@effect/vitest";
import type { PersonalDataSource } from "@surveybeat/domain";
import { AuthUserId } from "@surveybeat/domain";
import { migratedDatabase, SqliteStorage } from "@surveybeat/testing";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { personalDataSource } from "./auth/PersonalDataSource.ts";
import type { PersonalDataOrganizations } from "./auth/PersonalDataSource.ts";
import { organizationPersonalData } from "./organization/PersonalData.ts";

type Database = ReturnType<typeof migratedDatabase>;

const migrations = new URL("../migrations/", import.meta.url);

const d1Migrations = new URL("../d1-migrations/", import.meta.url);

const NOW = Date.UTC(2026, 10, 20, 12);

const FUTURE = "2026-12-20T12:00:00.000Z";

const PAST = "2026-11-01T12:00:00.000Z";

const d1 = () => migratedDatabase(d1Migrations);

const d1Client = (sqlite: Database) => {
  const statement = (sql: string, binds: readonly unknown[]) => ({
    bind: (...values: readonly unknown[]) => statement(sql, values),
    all: () =>
      Effect.sync(() => ({ results: sqlite.prepare(sql).all(...(binds as (null | string | number)[])) })),
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

const seedOrganization = (
  id: string,
  name: string,
  people: readonly (readonly [string, string, string | null])[],
) => {
  const db = migratedDatabase(migrations);
  db.prepare("INSERT INTO organization (id, name) VALUES (?, ?)").run(id, name);
  db.prepare("INSERT INTO team (id, name, time_zone) VALUES (?, ?, 'UTC')").run(
    `${id}-team`,
    `${name} Platform`,
  );

  for (const [personId, email, userId] of people) {
    db.prepare(
      "INSERT INTO person (id, email, auth_user_id, organization_admin, time_zone, locale) VALUES (?, ?, ?, 0, 'Europe/Berlin', 'en')",
    ).run(personId, email, userId);
    db.prepare(
      "INSERT INTO membership (id, team_id, person_id, role, started_at, ended_at) VALUES (?, ?, ?, 'member', 1000, NULL)",
    ).run(`${personId}-m`, `${id}-team`, personId);
  }

  db.prepare(
    `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
     VALUES (?, ?, ?, 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
  ).run(`${id}-pulse`, `${id}-team`, `${name} Pulse`);
  db.prepare(
    `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
     VALUES (?, ?, ?, 'open', '2026-11-16', 1000, 9999999, ?, 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
  ).run(`${id}-round`, `${id}-pulse`, `${id}-team`, `${name} Pulse`);

  for (const [personId, email] of people) {
    db.prepare(
      "INSERT INTO round_member (round_id, person_id, time_zone, send_at) VALUES (?, ?, 'Europe/Berlin', 5000)",
    ).run(`${id}-round`, personId);
    db.prepare("INSERT INTO participation (round_id, person_id) VALUES (?, ?)").run(`${id}-round`, personId);
    db.prepare(
      `INSERT INTO invitation (round_id, person_id, token_hash, send_id, status, resend_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'sent', 2, 2000, 3000)`,
    ).run(`${id}-round`, personId, `token-hash-${personId}`, `${personId}-send`);
    db.prepare(
      "INSERT INTO pulse_reminder_opt_out (pulse_id, person_id, opted_out_at) VALUES (?, ?, 4000)",
    ).run(`${id}-pulse`, personId);
    db.prepare(
      `INSERT INTO action (id, team_id, round_id, title, owner_id, due_date, dimension, status, created_at, updated_at, done_at)
       VALUES (?, ?, ?, ?, ?, '2026-12-01', 'clarity', 'committed', 6000, 7000, NULL)`,
    ).run(`${personId}-action`, `${id}-team`, `${id}-round`, `Action of ${personId}`, personId);
    db.prepare(
      "INSERT INTO email_send (id, recipient, content, status, state) VALUES (?, ?, ?, 'Sent', ?)",
    ).run(
      `${personId}-send`,
      email,
      JSON.stringify({ _tag: "InvitationEmail", token: `raw-token-${personId}`, pulseName: "Body text" }),
      JSON.stringify({ _tag: "Sent", messageId: "msg-1", sentAt: 8000 }),
    );
    db.prepare(
      "INSERT INTO test_send (send_id, person_id, pulse_id, token_hash, sent_at) VALUES (?, ?, ?, ?, 9000)",
    ).run(`${personId}-test`, personId, `${id}-pulse`, `test-hash-${personId}`);
  }

  db.prepare("INSERT INTO submission (id, round_id, edit_key_hash) VALUES (?, ?, 'edit-key-hash-1')").run(
    `${id}-submission`,
    `${id}-round`,
  );
  db.prepare(
    "INSERT INTO answer (submission_id, question_version_id, value, comment) VALUES (?, 'qv', 4, 'a comment')",
  ).run(`${id}-submission`);
  db.prepare(
    'INSERT INTO round_result (round_id, computed_at, payload) VALUES (?, 1, \'{"team":"results"}\')',
  ).run(`${id}-round`);

  return db;
};

const seedD1 = () => {
  const sqlite = d1();
  sqlite.exec(`
    INSERT INTO organization_index (organization_id, name) VALUES ('acme', 'Acme'), ('globex', 'Globex');
    INSERT INTO auth_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES
      ('user_ada', 'Ada', 'ada@example.com', 1, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
      ('user_bob', 'Bob', 'bob@example.com', 1, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
      ('user_cy', 'Cy', 'cy@example.com', 1, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    INSERT INTO auth_session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES
      ('s-ada-live', '${FUTURE}', 'secret-session-token-ada', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', '203.0.113.7', 'Firefox', 'user_ada'),
      ('s-ada-old', '${PAST}', 'secret-session-token-old', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '203.0.113.8', 'Chrome', 'user_ada'),
      ('s-bob', '${FUTURE}', 'secret-session-token-bob', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', '198.51.100.1', 'Safari', 'user_bob');
    INSERT INTO auth_account (id, accountId, providerId, userId, accessToken, refreshToken, idToken, password, scope, createdAt, updatedAt) VALUES
      ('acc-ada', 'user_ada', 'email-otp', 'user_ada', 'secret-access-token', 'secret-refresh-token', 'secret-id-token', 'secret-password-hash', 'openid', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    INSERT INTO auth_passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, transports, createdAt, aaguid) VALUES
      ('pk-ada', 'Laptop', 'secret-public-key', 'user_ada', 'secret-credential-id', 5, 'multiDevice', 1, 'internal', '2026-03-01T00:00:00.000Z', 'secret-aaguid');
    INSERT INTO person_index (organization_id, person_id, email, auth_user_id) VALUES
      ('acme', 'acme-ada', 'ada@example.com', 'user_ada'),
      ('globex', 'globex-ada', 'ada@example.com', 'user_ada'),
      ('acme', 'acme-bob', 'bob@example.com', 'user_bob');
    INSERT INTO organization_claim (auth_user_id, organization_id, name, admin_person_id, completed_at) VALUES
      ('user_ada', 'acme', 'Acme', 'acme-ada', 1700000000000);
  `);

  return sqlite;
};

interface World {
  readonly source: Effect.Effect<PersonalDataSource["Service"], never, RuntimeContext>;
  readonly queried: string[];
}

const world = (): World => {
  const databases = new Map([
    [
      "acme",
      seedOrganization("acme", "Acme", [
        ["acme-ada", "ada@example.com", "user_ada"],
        ["acme-bob", "bob@example.com", "user_bob"],
      ]),
    ],
    ["globex", seedOrganization("globex", "Globex", [["globex-ada", "ada@example.com", "user_ada"]])],
  ]);

  const queried: string[] = [];

  const organizations: PersonalDataOrganizations = {
    getByName: (id) => ({
      exportPersonalData: (userId) =>
        Effect.gen(function* () {
          queried.push(id);
          const db = databases.get(id);

          if (db === undefined) {
            return null;
          }

          return yield* organizationPersonalData(yield* organizationSql(db)).exportPersonalData(userId);
        }),
    }),
  };

  return { source: personalDataSource(d1Client(seedD1()), organizations), queried };
};

const run = (userId: string) => {
  const { source, queried } = world();

  return Effect.gen(function* () {
    const gathered = yield* (yield* source).gather(AuthUserId.make(userId), NOW);

    return { gathered, queried };
  }).pipe(Effect.provideService(RuntimeContext, {} as RuntimeContext["Service"]));
};

const exportOf = (userId: string) => run(userId).pipe(Effect.map(({ gathered }) => JSON.stringify(gathered)));

const SECRETS = [
  "secret-session-token-ada",
  "secret-access-token",
  "secret-refresh-token",
  "secret-id-token",
  "secret-password-hash",
  "secret-public-key",
  "secret-credential-id",
  "secret-aaguid",
  "token-hash-acme-ada",
  "token-hash-globex-ada",
  "test-hash-acme-ada",
  "raw-token-acme-ada",
  "edit-key-hash-1",
];

describe("personal data export privacy", () => {
  it.effect("gives caller A nothing that belongs to Person B", () =>
    Effect.gen(function* () {
      const ada = yield* exportOf("user_ada");
      const bob = yield* exportOf("user_bob");

      for (const marker of [
        "user_bob",
        "bob@example.com",
        "acme-bob",
        "s-bob",
        "198.51.100.1",
        "Action of acme-bob",
      ]) {
        assert.notInclude(ada, marker);
      }

      for (const marker of [
        "user_ada",
        "ada@example.com",
        "acme-ada",
        "globex",
        "s-ada-live",
        "203.0.113.7",
        "Action of acme-ada",
      ]) {
        assert.notInclude(bob, marker);
      }
    }),
  );

  it.effect("exports only the rows of the caller's own Person in a shared Organization", () =>
    Effect.gen(function* () {
      const { gathered } = yield* run("user_bob");
      const acme = gathered.organizations[0];

      assert.strictEqual(gathered.organizations.length, 1);
      assert.strictEqual(acme?.person.id, "acme-bob");
      assert.deepStrictEqual(
        acme?.actions.map((each) => each.id),
        ["acme-bob-action"],
      );
      assert.deepStrictEqual(
        acme?.emailSends.map((each) => each.id),
        ["acme-bob-send"],
      );
      assert.deepStrictEqual(
        acme?.testSends.map((each) => each.id),
        ["acme-bob-test"],
      );
      assert.deepStrictEqual(acme?.invitations.length, 1);
      assert.deepStrictEqual(acme?.participation.length, 1);
    }),
  );

  it.effect("returns a stranger an export with no Organization and no other human's account", () =>
    Effect.gen(function* () {
      const stranger = yield* exportOf("user_nobody");

      for (const marker of ["ada@example.com", "bob@example.com", "acme-ada", "acme-bob", "Acme"]) {
        assert.notInclude(stranger, marker);
      }
    }),
  );

  it.effect("holds no Submission, Answer, Invitation token, Edit key hash or Team Result", () =>
    Effect.gen(function* () {
      const ada = yield* exportOf("user_ada");
      const parsed: unknown = JSON.parse(ada);

      for (const secret of SECRETS) {
        assert.notInclude(ada, secret);
      }

      for (const planted of ["acme-submission", "globex-submission", "a comment", "results", "Body text"]) {
        assert.notInclude(ada, planted);
      }

      const keys = new Set<string>();

      const collect = (value: unknown): void => {
        if (Array.isArray(value)) {
          value.forEach(collect);
        } else if (typeof value === "object" && value !== null) {
          for (const [key, inner] of Object.entries(value)) {
            keys.add(key);
            collect(inner);
          }
        }
      };

      collect(parsed);

      for (const forbidden of [
        "submission",
        "submissions",
        "answer",
        "answers",
        "comment",
        "comments",
        "token",
        "tokenHash",
        "token_hash",
        "editKeyHash",
        "edit_key_hash",
        "result",
        "results",
        "payload",
        "content",
        "password",
        "accessToken",
        "refreshToken",
        "idToken",
        "publicKey",
        "credentialID",
      ]) {
        assert.isFalse(keys.has(forbidden), `${forbidden} is a key in the export`);
      }
    }),
  );
});
