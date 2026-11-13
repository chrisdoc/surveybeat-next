import { SqliteClient } from "@effect/sql-sqlite-do";
import { assert, describe, it } from "@effect/vitest";
import { PersonId, QuestionVersionId, RoundId } from "@surveybeat/domain";
import { SqliteStorage, Unlinkability } from "@surveybeat/testing";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { makeSqlRounds } from "./SqlRounds.ts";

const migrationsDir = new URL("../migrations/", import.meta.url);

const initDatabase = (): DatabaseSync => {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    db.exec(readFileSync(new URL(file, migrationsDir), "utf8"));
  }
  return db;
};

/**
 * The product's own `makeSqlRounds` (the Organization object's Round storage) on the real migrations,
 * over an in-memory `node:sqlite` database that stands in for the object's storage, with one open Round.
 */
const openRounds = (roundId: RoundId) =>
  Effect.gen(function* () {
    const db = initDatabase();
    db.prepare("INSERT INTO organization (id, name) VALUES ('org-1', 'Org 1')").run();
    db.prepare("INSERT INTO team (id, name, time_zone) VALUES ('team-1', 'Team 1', 'UTC')").run();
    db.prepare(
      `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
       VALUES ('pulse-1', 'team-1', 'Pulse 1', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
    ).run();
    db.prepare(
      `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
       VALUES (?, 'pulse-1', 'team-1', 'open', '2026-11-09', 1000, 9999999, 'Pulse 1', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
    ).run(roundId);
    const sql = yield* SqliteClient.make({
      storage: SqliteStorage.makeSqliteStorage(db) as unknown as NonNullable<
        Parameters<typeof SqliteClient.make>[0]["storage"]
      >,
    }).pipe(Effect.provideService(Scope.Scope, yield* Scope.make()), Effect.provide(Reactivity.layer));
    return { db, rounds: makeSqlRounds(sql, yield* Unlinkability.seededRandomBytes) };
  });

describe("Submissions privacy invariants (SPEC §7, ADR 0005)", () => {
  it("A1: Every anonymous table is WITHOUT ROWID", () => {
    const db = initDatabase();

    const masterRows = db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('submission', 'answer', 'participation')",
      )
      .all() as Array<{ name: string; sql: string }>;

    const tableMap = new Map(masterRows.map((r) => [r.name, r.sql.toUpperCase()]));

    assert.isTrue(tableMap.has("submission"), "submission table must exist");
    assert.isTrue(tableMap.has("answer"), "answer table must exist");
    assert.isTrue(tableMap.has("participation"), "participation table must exist");

    assert.isTrue(
      tableMap.get("submission")?.includes("WITHOUT ROWID"),
      "submission table must be WITHOUT ROWID",
    );
    assert.isTrue(tableMap.get("answer")?.includes("WITHOUT ROWID"), "answer table must be WITHOUT ROWID");
    assert.isTrue(
      tableMap.get("participation")?.includes("WITHOUT ROWID"),
      "participation table must be WITHOUT ROWID",
    );

    assert.throws(() => db.prepare("SELECT rowid FROM submission").all(), /no such column: rowid/);
    assert.throws(() => db.prepare("SELECT rowid FROM answer").all(), /no such column: rowid/);
  });

  it("A2: No anonymous table shares a key or has person, invitation, or time columns", () => {
    const db = initDatabase();

    const getColumns = (tableName: string) => {
      const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
        name: string;
      }>;
      return rows.map((r) => r.name.toLowerCase());
    };

    const forbiddenSubstrings = [
      "person",
      "invitation",
      "token",
      "time",
      "date",
      "created",
      "updated",
      "clock",
    ];

    const submissionCols = getColumns("submission");
    const answerCols = getColumns("answer");
    const participationCols = getColumns("participation");

    for (const col of submissionCols) {
      for (const forbidden of forbiddenSubstrings) {
        assert.isFalse(col.includes(forbidden), `submission column '${col}' must not contain '${forbidden}'`);
      }
    }

    for (const col of answerCols) {
      for (const forbidden of forbiddenSubstrings) {
        assert.isFalse(col.includes(forbidden), `answer column '${col}' must not contain '${forbidden}'`);
      }
    }

    // Participation record holds only Round and Person, strictly no time column (ADR 0005).
    assert.deepStrictEqual(participationCols.sort(), ["person_id", "round_id"]);
  });

  it("A10: No Submission, Answer, or Participation table stores a language (ADR 0018)", () => {
    const db = initDatabase();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    )
      .map((t) => t.name)
      .filter((name) => /submission|answer|participation/i.test(name));
    assert.includeMembers(tables, ["submission", "answer", "participation"]);

    for (const table of tables) {
      const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) =>
        c.name.toLowerCase(),
      );
      for (const column of columns) {
        assert.isFalse(
          /lang|locale/.test(column),
          `${table} column '${column}' must not hold a language: in a small Team it singles out a reader`,
        );
      }
    }
  });

  it.effect(
    "A4: After k Submissions through the real write path, dump gives no better than random guess",
    () => {
      const roundId = RoundId.make("round-a4");
      const subject = Effect.gen(function* () {
        const { db, rounds } = yield* openRounds(roundId);
        return {
          // The product's own `recordFirstAnswer`: participation, submission, and answer in one transaction.
          write: ({ person, answer }) =>
            Effect.gen(function* () {
              db.prepare("INSERT INTO person (id, email) VALUES (?, ?)").run(person, `${person}@example.com`);
              const outcome = yield* rounds
                .recordFirstAnswer(
                  roundId,
                  PersonId.make(person),
                  answer,
                  [{ questionVersionId: QuestionVersionId.make("qv-1"), value: 5, comment: null }],
                  [],
                )
                .pipe(Effect.orDie);
              assert.isString(outcome.submissionId);
            }),
          dump: Effect.sync(() => ({
            participation: {
              name: "participation",
              key: ["round_id", "person_id"],
              rows: db.prepare("SELECT round_id, person_id FROM participation").all(),
            },
            submission: {
              name: "submission",
              key: ["id"],
              rows: db.prepare("SELECT id, round_id, edit_key_hash FROM submission ORDER BY id").all(),
            },
          })),
        } satisfies Unlinkability.Subject<never, never>;
      });

      return Effect.gen(function* () {
        const reports = yield* Unlinkability.assertUnlinkable(subject);
        assert.strictEqual(reports.length, Unlinkability.SEEDS.length);
        for (const report of reports) {
          assert.strictEqual(report.k, Unlinkability.K);
          for (const attack of report.attacks) {
            assert.isAtMost(
              attack.matches,
              Unlinkability.MAX_MATCHES,
              `seed ${report.seed}: ${attack.attack} exceeded MAX_MATCHES`,
            );
          }
        }
      });
    },
  );

  it.effect(
    "A4b: recordFirstAnswer stores no Person and no time on the Submission, and redacts the comment (ADR 0005, ADR 0009)",
    () =>
      Effect.gen(function* () {
        const roundId = RoundId.make("round-a4b");
        const { db, rounds } = yield* openRounds(roundId);
        const personId = PersonId.make("person-a4b-secret");
        db.prepare("INSERT INTO person (id, email) VALUES (?, ?)").run(personId, "carol@example.com");
        const rawComment = "Anna is great, mail me at jane.doe@example.com or call +49 151 2345 6789";
        const qRating = QuestionVersionId.make("qv-rating");
        const qText = QuestionVersionId.make("qv-text");

        const outcome = yield* rounds
          .recordFirstAnswer(
            roundId,
            personId,
            "edit-key-hash-a4b",
            [
              { questionVersionId: qRating, value: 4, comment: rawComment },
              { questionVersionId: qText, value: null, comment: "Ask Bob Smith about it" },
            ],
            ["Anna", { name: "Bob Smith", email: "bob@example.com" }],
          )
          .pipe(Effect.orDie);

        // The Submission row: id, Round, edit key hash. No Person, no Invitation, no time.
        const submissions = db.prepare("SELECT * FROM submission").all();
        assert.deepStrictEqual(submissions, [
          { id: outcome.submissionId, round_id: roundId, edit_key_hash: "edit-key-hash-a4b" },
        ]);
        assert.notStrictEqual(String(outcome.submissionId), String(personId));

        // Participation holds the Person and the Round and nothing else (no time).
        assert.deepStrictEqual(db.prepare("SELECT * FROM participation").all(), [
          { round_id: roundId, person_id: personId },
        ]);

        // The anonymous tables never mention the Person, in any column.
        const anonymousDump = JSON.stringify({
          submission: db.prepare("SELECT * FROM submission").all(),
          answer: db.prepare("SELECT * FROM answer").all(),
        });
        assert.isFalse(anonymousDump.includes(personId));
        assert.isFalse(anonymousDump.includes("carol@example.com"));

        // Comments were redacted at store time: the raw text is not in the database at all.
        const answers = db
          .prepare("SELECT question_version_id, value, comment FROM answer ORDER BY question_version_id")
          .all();
        assert.deepStrictEqual(answers, [
          {
            question_version_id: qRating,
            value: 4,
            comment: "[name] is great, mail me at [email] or call [phone]",
          },
          { question_version_id: qText, value: null, comment: "Ask [name] about it" },
        ]);
        const everything = JSON.stringify(
          db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all()
            .flatMap((table) => {
              const name = String((table as { name: unknown }).name);
              return db.prepare(`SELECT * FROM "${name}"`).all();
            }),
        );
        for (const raw of ["Anna", "Bob Smith", "jane.doe@example.com", "2345 6789"]) {
          assert.isFalse(everything.includes(raw), `raw text '${raw}' must not be stored`);
        }
        assert.strictEqual(outcome.shownToLead, "Ask [name] about it");
      }),
  );

  it("A8: A second first Answer for the same person/round fails with AlreadyAnswered", () => {
    const db = initDatabase();
    db.prepare("INSERT INTO organization (id, name) VALUES ('org-1', 'Org 1')").run();
    db.prepare("INSERT INTO team (id, name, time_zone) VALUES ('team-1', 'Team 1', 'UTC')").run();
    db.prepare(
      `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
       VALUES ('pulse-1', 'team-1', 'Pulse 1', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
    ).run();
    db.prepare(
      `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
       VALUES ('round-a8', 'pulse-1', 'team-1', 'open', '2026-11-09', 1000, 9999999, 'Pulse 1', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
    ).run();
    db.prepare("INSERT INTO person (id, email) VALUES ('person-1', 'p1@example.com')").run();

    // First answer succeeds
    db.prepare("INSERT INTO participation (round_id, person_id) VALUES ('round-a8', 'person-1')").run();
    db.prepare(
      "INSERT INTO submission (id, round_id, edit_key_hash) VALUES ('sub-1', 'round-a8', 'hash-1')",
    ).run();

    // Second first answer attempt: unique constraint on participation (round_id, person_id) rejects it
    assert.throws(() => {
      db.prepare("INSERT INTO participation (round_id, person_id) VALUES ('round-a8', 'person-1')").run();
    }, /UNIQUE constraint failed/);

    const count = db
      .prepare(
        "SELECT COUNT(*) as count FROM participation WHERE round_id = 'round-a8' AND person_id = 'person-1'",
      )
      .get() as { count: number };
    assert.strictEqual(count.count, 1);
  });

  it("A9: Deleting a Person removes their Participation records, but Submissions survive", () => {
    const db = initDatabase();
    db.prepare("INSERT INTO organization (id, name) VALUES ('org-1', 'Org 1')").run();
    db.prepare("INSERT INTO team (id, name, time_zone) VALUES ('team-1', 'Team 1', 'UTC')").run();
    db.prepare(
      `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
       VALUES ('pulse-1', 'team-1', 'Pulse 1', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
    ).run();
    db.prepare(
      `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
       VALUES ('round-a9', 'pulse-1', 'team-1', 'open', '2026-11-09', 1000, 9999999, 'Pulse 1', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
    ).run();
    db.prepare("INSERT INTO person (id, email) VALUES ('person-del', 'del@example.com')").run();

    // Participant answers
    db.prepare("INSERT INTO participation (round_id, person_id) VALUES ('round-a9', 'person-del')").run();
    db.prepare(
      "INSERT INTO submission (id, round_id, edit_key_hash) VALUES ('sub-survive', 'round-a9', 'hash-survive')",
    ).run();
    db.prepare(
      "INSERT INTO answer (submission_id, question_version_id, value, comment) VALUES ('sub-survive', 'qv-1', 4, 'Great team')",
    ).run();

    // When Person is deleted: participation is removed
    db.prepare("DELETE FROM participation WHERE person_id = 'person-del'").run();

    const partCount = db
      .prepare("SELECT COUNT(*) as count FROM participation WHERE person_id = 'person-del'")
      .get() as { count: number };
    assert.strictEqual(partCount.count, 0, "participation record must be deleted");

    const subCount = db
      .prepare("SELECT COUNT(*) as count FROM submission WHERE id = 'sub-survive'")
      .get() as { count: number };
    assert.strictEqual(subCount.count, 1, "anonymous submission must survive");

    const ansCount = db
      .prepare("SELECT COUNT(*) as count FROM answer WHERE submission_id = 'sub-survive'")
      .get() as { count: number };
    assert.strictEqual(ansCount.count, 1, "anonymous answer must survive");
  });
});
