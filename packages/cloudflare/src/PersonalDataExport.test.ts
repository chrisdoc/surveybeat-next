import { SqliteClient } from "@effect/sql-sqlite-do";
import type * as Cloudflare from "@alchemy.run/cloudflare";
import { assert, describe, it } from "@effect/vitest";
import type { PersonalDataSource } from "@surveybeat/domain";
import { AuthUserId, PERSONAL_DATA_EXPORT_SCHEMA_VERSION, PersonalDataExport } from "@surveybeat/domain";
import { migratedDatabase, SqliteStorage } from "@surveybeat/testing";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Schema from "effect/Schema";
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

describe("personal data export", () => {
  it.effect("gathers D1 and every Organization the human belongs to", () =>
    Effect.gen(function* () {
      const { gathered, queried } = yield* run("user_ada");

      assert.strictEqual(gathered.schemaVersion, PERSONAL_DATA_EXPORT_SCHEMA_VERSION);
      assert.strictEqual(gathered.exportedAt, "2026-11-20T12:00:00.000Z");
      assert.deepStrictEqual(gathered.account.user, {
        id: "user_ada",
        name: "Ada",
        email: "ada@example.com",
        emailVerified: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      });
      assert.deepStrictEqual(
        gathered.account.activeSessions.map((session) => session.id),
        ["s-ada-live"],
      );
      assert.strictEqual(gathered.account.activeSessions[0]?.ipAddress, "203.0.113.7");
      assert.deepStrictEqual(
        gathered.account.providerLinks.map((link) => link.providerId),
        ["email-otp"],
      );
      assert.deepStrictEqual(gathered.account.passkeys, [
        { id: "pk-ada", name: "Laptop", deviceType: "multiDevice", createdAt: "2026-03-01T00:00:00.000Z" },
      ]);
      assert.deepStrictEqual(
        gathered.account.personIndex.map((entry) => [entry.organizationId, entry.personId]),
        [
          ["acme", "acme-ada"],
          ["globex", "globex-ada"],
        ],
      );
      assert.deepStrictEqual(
        gathered.account.organizationClaims.map((claim) => claim.organizationId),
        ["acme"],
      );
      assert.deepStrictEqual([...new Set(queried)].sort(), ["acme", "globex"]);
      assert.deepStrictEqual(
        gathered.organizations.map((each) => [each.organization.id, each.organization.name, each.person.id]),
        [
          ["acme", "Acme", "acme-ada"],
          ["globex", "Globex", "globex-ada"],
        ],
      );
    }),
  );

  it.effect("carries each Organization's rows for the Person, and only those", () =>
    Effect.gen(function* () {
      const { gathered } = yield* run("user_ada");
      const acme = gathered.organizations[0];

      assert.deepStrictEqual(acme?.person, {
        id: "acme-ada",
        email: "ada@example.com",
        timeZone: "Europe/Berlin",
        locale: "en",
        detectedLocale: null,
        organizationAdmin: false,
        removedAt: null,
      });
      assert.deepStrictEqual(acme?.memberships, [
        {
          id: "acme-ada-m",
          teamId: "acme-team",
          teamName: "Acme Platform",
          role: "member",
          startedAt: "1970-01-01T00:00:01.000Z",
          endedAt: null,
        },
      ]);
      assert.deepStrictEqual(acme?.participation, [
        { roundId: "acme-round", plannedOpenDate: "2026-11-16", pulseName: "Acme Pulse", participated: true },
      ]);
      assert.deepStrictEqual(
        acme?.roundMembers.map((each) => [each.roundId, each.timeZone]),
        [["acme-round", "Europe/Berlin"]],
      );
      assert.deepStrictEqual(
        acme?.invitations.map((each) => [each.status, each.resendCount]),
        [["sent", 2]],
      );
      assert.deepStrictEqual(
        acme?.reminderOptOuts.map((each) => each.pulseId),
        ["acme-pulse"],
      );
      assert.deepStrictEqual(
        acme?.actions.map((each) => each.id),
        ["acme-ada-action"],
      );
      assert.deepStrictEqual(acme?.emailSends, [
        {
          id: "acme-ada-send",
          kind: "InvitationEmail",
          status: "Sent",
          sentAt: "1970-01-01T00:00:08.000Z",
          failedAt: null,
        },
      ]);
      assert.deepStrictEqual(
        acme?.testSends.map((each) => each.id),
        ["acme-ada-test"],
      );
    }),
  );

  it.effect("exports a signed-in human who belongs to no Organization", () =>
    Effect.gen(function* () {
      const { gathered, queried } = yield* run("user_cy");

      assert.strictEqual(gathered.account.user?.email, "cy@example.com");
      assert.deepStrictEqual(gathered.organizations, []);
      assert.deepStrictEqual(queried, []);
    }),
  );

  it.effect("produces a document that decodes against the export schema", () =>
    Effect.gen(function* () {
      const { gathered } = yield* run("user_ada");

      yield* Schema.decodeEffect(PersonalDataExport)(structuredClone(gathered));
    }),
  );

  it.effect("states the Art. 15 transparency facts", () =>
    Effect.gen(function* () {
      const { gathered } = yield* run("user_ada");
      const text = JSON.stringify(gathered.transparency);

      assert.isTrue(gathered.transparency.processingPurposes.length > 0);
      assert.isTrue(gathered.transparency.processingPurposes.every((each) => each.legalBasis.length > 0));
      assert.isTrue(gathered.transparency.processingPurposes.every((each) => each.retention.length > 0));
      assert.isTrue(gathered.transparency.subProcessors.some((each) => each.name === "Cloudflare, Inc."));
      assert.include(text, "ADR 0005");
      assert.include(text, "/history");
      assert.include(text, "ADR 0017");
      assert.notInclude(text, "not personal data");
    }),
  );
});
