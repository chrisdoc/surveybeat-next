import { assert, describe, it } from "@effect/vitest";
import { Unlinkability } from "@surveybeat/testing";
import * as Effect from "effect/Effect";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

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

  it.effect("A4: After k Submissions in random order, dump gives no better than random guess", () => {
    const roundId = "round-a4";
    const qVersionId = "qv-1";

    const subject = Effect.sync((): Unlinkability.Subject<never, never> => {
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

      return {
        write: ({ person, answer }) =>
          Effect.gen(function* () {
            const submissionId = yield* Unlinkability.randomHex(16);
            // Atomically write participation and submission in one transaction
            db.exec("BEGIN");
            db.prepare("INSERT INTO person (id, email) VALUES (?, ?)").run(person, `${person}@example.com`);
            db.prepare("INSERT INTO participation (round_id, person_id) VALUES (?, ?)").run(roundId, person);
            db.prepare("INSERT INTO submission (id, round_id, edit_key_hash) VALUES (?, ?, ?)").run(
              submissionId,
              roundId,
              answer,
            );
            db.prepare(
              "INSERT INTO answer (submission_id, question_version_id, value, comment) VALUES (?, ?, ?, ?)",
            ).run(submissionId, qVersionId, 5, null);
            db.exec("COMMIT");
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
      };
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
  });

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
