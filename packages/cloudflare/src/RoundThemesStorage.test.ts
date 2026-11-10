import { SqliteClient } from "@effect/sql-sqlite-do";
import { assert, describe, it } from "@effect/vitest";
import { JobId, RoundId, type StoredThemes } from "@surveybeat/domain";
import { SqliteStorage, Unlinkability } from "@surveybeat/testing";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { makeSqlRounds } from "./SqlRounds.ts";

const migrationsDir = new URL("../migrations/", import.meta.url);

/** Migration files in order, optionally only those before `exclusive` (for piecewise application). */
const migrationFiles = (exclusive?: string): ReadonlyArray<string> =>
  readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && (exclusive === undefined || f < exclusive))
    .sort();

const applyMigrations = (db: DatabaseSync, files: ReadonlyArray<string>) => {
  for (const file of files) {
    db.exec(readFileSync(new URL(file, migrationsDir), "utf8"));
  }
};

/** Organization, Team, Pulse, and one closed Round, as the ResultsStorage tests seed them. */
const seedRound = (db: DatabaseSync, roundId: string, plannedOpenDate = "2026-11-02") => {
  db.prepare("INSERT OR IGNORE INTO organization (id, name) VALUES ('org-1', 'Acme')").run();
  db.prepare("INSERT OR IGNORE INTO team (id, name, time_zone) VALUES ('team-1', 'Team 1', 'UTC')").run();
  db.prepare(
    `INSERT OR IGNORE INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
     VALUES ('pulse-1', 'team-1', 'Pulse 1', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
  ).run();
  db.prepare(
    `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
     VALUES (?, 'pulse-1', 'team-1', 'closed', ?, 1000, 2000, 'Pulse 1', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
  ).run(roundId, plannedOpenDate);
};

/** The Round storage on this database, through the real SQL client (as the Organization object uses it). */
const makeRounds = (db: DatabaseSync) =>
  Effect.gen(function* () {
    const sql = yield* SqliteClient.make({
      storage: SqliteStorage.makeSqliteStorage(db) as unknown as NonNullable<
        Parameters<typeof SqliteClient.make>[0]["storage"]
      >,
    }).pipe(Effect.provideService(Scope.Scope, yield* Scope.make()), Effect.provide(Reactivity.layer));
    return makeSqlRounds(sql, yield* Unlinkability.seededRandomBytes);
  });

const withGuide: StoredThemes = {
  themes: [
    { label: "Workload", sentence: "Several people feel stretched.", supportingComments: 2 },
    { label: "Tooling", sentence: "Build times came up.", supportingComments: 3 },
  ],
  guide: {
    whatStoodOut: ["Recognition fell"],
    whatPeopleRaised: ["Meetings run long"],
    actionsToCheckOn: ["Shorten standups"],
    questions: ["What would make the week lighter?"],
  },
};

const withoutGuide: StoredThemes = {
  themes: [{ label: "Tooling", sentence: "Build times came up.", supportingComments: 2 }],
  guide: null,
};

describe("Comment themes storage (ADR 0016, ADR 0019)", () => {
  it("0013 keeps existing schedule_job rows, accepts the themes type, and rebuilds both indexes", () => {
    const db = new DatabaseSync(":memory:");
    // Everything before 0013, then one existing job row written against the old CHECK.
    applyMigrations(db, migrationFiles("0013_"));
    seedRound(db, "round-1");
    db.prepare(
      `INSERT INTO schedule_job (id, round_id, type, due_at, status, payload, created_at, completed_at)
         VALUES ('job-1', 'round-1', 'close', 5000, 'pending', '{"attempts":1}', 1000, NULL)`,
    ).run();
    const before = db.prepare("SELECT * FROM schedule_job").all();

    applyMigrations(
      db,
      migrationFiles().filter((f) => f.startsWith("0013_")),
    );

    assert.deepStrictEqual(db.prepare("SELECT * FROM schedule_job").all(), before);
    db.prepare(
      `INSERT INTO schedule_job (id, round_id, type, due_at, status, payload, created_at, completed_at)
         VALUES ('job-themes', 'round-1', 'themes', 6000, 'pending', NULL, 2000, NULL)`,
    ).run();
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO schedule_job (id, round_id, type, due_at, status, payload, created_at, completed_at)
             VALUES ('job-bogus', 'round-1', 'bogus', 6000, 'pending', NULL, 2000, NULL)`,
        )
        .run(),
    );
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'schedule_job' ORDER BY name",
      )
      .all()
      .map((row) => row["name"]);
    assert.deepStrictEqual(indexes, ["schedule_job_due", "schedule_job_round"]);
  });

  it.effect(
    "requestThemes inserts once; the record starts pending with zero attempts; failed attempts count",
    () =>
      Effect.gen(function* () {
        const db = new DatabaseSync(":memory:");
        applyMigrations(db, migrationFiles());
        seedRound(db, "round-1");
        const rounds = yield* makeRounds(db);
        const roundId = RoundId.make("round-1");

        assert.strictEqual(yield* rounds.requestThemes(roundId, 100), true);
        assert.strictEqual(yield* rounds.requestThemes(roundId, 200), false);
        assert.deepStrictEqual(yield* rounds.getRoundThemes(roundId), {
          status: "pending",
          requestedAt: 100,
          attempts: 0,
        });

        yield* rounds.recordThemesAttemptFailed(roundId, 2);
        assert.deepStrictEqual(yield* rounds.getRoundThemes(roundId), {
          status: "pending",
          requestedAt: 100,
          attempts: 2,
        });
      }),
  );

  it.effect("storeThemes round-trips the JSON, with a null guide and with a guide, and is store-once", () =>
    Effect.gen(function* () {
      const db = new DatabaseSync(":memory:");
      applyMigrations(db, migrationFiles());
      seedRound(db, "round-1");
      seedRound(db, "round-2", "2026-11-09");
      const rounds = yield* makeRounds(db);

      // A Round whose themes come back with a guide.
      const first = RoundId.make("round-1");
      yield* rounds.requestThemes(first, 100);
      yield* rounds.storeThemes(first, withGuide, 300);
      assert.deepStrictEqual(yield* rounds.getRoundThemes(first), { status: "ready", themes: withGuide });
      // Store-once: a later store or give-up changes nothing.
      yield* rounds.storeThemes(first, withoutGuide, 400);
      yield* rounds.giveUpThemes(first, 500);
      assert.deepStrictEqual(yield* rounds.getRoundThemes(first), { status: "ready", themes: withGuide });

      // A Round whose themes come back with a null guide.
      const second = RoundId.make("round-2");
      yield* rounds.requestThemes(second, 100);
      yield* rounds.storeThemes(second, withoutGuide, 300);
      assert.deepStrictEqual(yield* rounds.getRoundThemes(second), { status: "ready", themes: withoutGuide });
    }),
  );

  it.effect("a ready payload that does not decode is a fixed-message defect, never the stored text", () =>
    Effect.gen(function* () {
      const db = new DatabaseSync(":memory:");
      applyMigrations(db, migrationFiles());
      seedRound(db, "round-1");
      const rounds = yield* makeRounds(db);
      const roundId = RoundId.make("round-1");
      yield* rounds.requestThemes(roundId, 100);
      db.prepare(
        "UPDATE round_themes SET status = 'ready', payload = '{\"secret\":\"Meetings run long\"' WHERE round_id = 'round-1'",
      ).run();

      const exit = yield* Effect.exit(rounds.getRoundThemes(roundId));
      assert.strictEqual(exit._tag, "Failure");
      const reported = String(exit);
      assert.include(reported, "round_themes payload invalid");
      assert.notInclude(reported, "Meetings run long");
    }),
  );

  it.effect("giveUpThemes on a pending row makes it failed", () =>
    Effect.gen(function* () {
      const db = new DatabaseSync(":memory:");
      applyMigrations(db, migrationFiles());
      seedRound(db, "round-1");
      const rounds = yield* makeRounds(db);
      const roundId = RoundId.make("round-1");

      yield* rounds.requestThemes(roundId, 100);
      yield* rounds.giveUpThemes(roundId, 300);
      assert.deepStrictEqual(yield* rounds.getRoundThemes(roundId), { status: "failed" });
      // A failed row is not revived by a later store.
      yield* rounds.storeThemes(roundId, withGuide, 400);
      assert.deepStrictEqual(yield* rounds.getRoundThemes(roundId), { status: "failed" });
    }),
  );

  it.effect("updateJobDueAtById moves only a pending job", () =>
    Effect.gen(function* () {
      const db = new DatabaseSync(":memory:");
      applyMigrations(db, migrationFiles());
      seedRound(db, "round-1");
      db.prepare(
        `INSERT INTO schedule_job (id, round_id, type, due_at, status, payload, created_at, completed_at)
         VALUES ('job-pending', 'round-1', 'themes', 1000, 'pending', NULL, 900, NULL),
                ('job-done', 'round-1', 'themes', 1000, 'completed', NULL, 900, 950)`,
      ).run();
      const rounds = yield* makeRounds(db);

      yield* rounds.updateJobDueAtById(JobId.make("job-pending"), 7000);
      yield* rounds.updateJobDueAtById(JobId.make("job-done"), 7000);

      const dueAt = (id: string) =>
        db.prepare("SELECT due_at FROM schedule_job WHERE id = ?").get(id)?.["due_at"];
      assert.strictEqual(dueAt("job-pending"), 7000);
      assert.strictEqual(dueAt("job-done"), 1000);
    }),
  );
});
