import { assert, describe, it } from "@effect/vitest";
import {
  calculateRoundResult,
  enforceEffectiveNOnResult,
  PulseId,
  type QuestionInput,
  QuestionVersionId,
  RoundId,
  RoundResult,
  TeamId,
} from "@surveybeat/domain";
import { Schema } from "effect";
import * as Option from "effect/Option";
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

describe("RoundResult storage and performance (Issue #45, ADR 0004)", () => {
  it("0009_results migration creates round_result table WITHOUT ROWID", () => {
    const db = initDatabase();

    const masterRows = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = 'round_result'")
      .all() as Array<{ name: string; sql: string }>;

    assert.strictEqual(masterRows.length, 1, "round_result table must exist");
    const sql = masterRows[0]?.sql.toUpperCase() ?? "";
    assert.isTrue(sql.includes("WITHOUT ROWID"), "round_result must be WITHOUT ROWID");
    assert.isTrue(sql.includes("PRIMARY KEY"), "round_result must have PRIMARY KEY");

    assert.throws(() => db.prepare("SELECT rowid FROM round_result").all(), /no such column: rowid/);
  });

  it("round_result cascades on round deletion", () => {
    const db = initDatabase();

    db.prepare("INSERT INTO organization (id, name) VALUES ('org-1', 'Acme')").run();
    db.prepare("INSERT INTO team (id, name, time_zone) VALUES ('team-1', 'Team 1', 'UTC')").run();
    db.prepare(
      `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
       VALUES ('pulse-1', 'team-1', 'Pulse 1', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
    ).run();

    const roundId = "round-cascade-test";
    db.prepare(
      `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
       VALUES (?, 'pulse-1', 'team-1', 'shared', '2026-11-02', 1000, 2000, 'Pulse 1', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
    ).run(roundId);

    db.prepare("INSERT INTO round_result (round_id, computed_at, payload) VALUES (?, ?, ?)").run(
      roundId,
      2000,
      JSON.stringify({ dummy: true }),
    );

    const countBefore = db
      .prepare("SELECT count(*) as c FROM round_result WHERE round_id = ?")
      .get(roundId) as { c: number };
    assert.strictEqual(countBefore.c, 1);

    // Delete round
    db.prepare("DELETE FROM round WHERE id = ?").run(roundId);

    const countAfter = db
      .prepare("SELECT count(*) as c FROM round_result WHERE round_id = ?")
      .get(roundId) as { c: number };
    assert.strictEqual(countAfter.c, 0, "round_result must be deleted when round is deleted");
  });

  it("replaces Result in place on recompute", () => {
    const db = initDatabase();

    db.prepare("INSERT INTO organization (id, name) VALUES ('org-1', 'Acme')").run();
    db.prepare("INSERT INTO team (id, name, time_zone) VALUES ('team-1', 'Team 1', 'UTC')").run();
    db.prepare(
      `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
       VALUES ('pulse-1', 'team-1', 'Pulse 1', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
    ).run();

    const roundId = "round-recompute-test";
    db.prepare(
      `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
       VALUES (?, 'pulse-1', 'team-1', 'shared', '2026-11-02', 1000, 2000, 'Pulse 1', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
    ).run(roundId);

    const insertOrReplace = (payload: string, computedAt: number) => {
      db.prepare(
        `INSERT INTO round_result (round_id, computed_at, payload)
         VALUES (?, ?, ?)
         ON CONFLICT (round_id) DO UPDATE SET computed_at = excluded.computed_at, payload = excluded.payload`,
      ).run(roundId, computedAt, payload);
    };

    insertOrReplace(JSON.stringify({ version: 1 }), 1000);
    const row1 = db
      .prepare("SELECT computed_at, payload FROM round_result WHERE round_id = ?")
      .get(roundId) as { computed_at: number; payload: string };
    assert.strictEqual(row1.computed_at, 1000);
    assert.strictEqual(JSON.parse(row1.payload).version, 1);

    // Recompute: replaces in place
    insertOrReplace(JSON.stringify({ version: 2 }), 2000);
    const row2 = db
      .prepare("SELECT computed_at, payload FROM round_result WHERE round_id = ?")
      .get(roundId) as { computed_at: number; payload: string };
    assert.strictEqual(row2.computed_at, 2000);
    assert.strictEqual(JSON.parse(row2.payload).version, 2);

    const totalRows = db
      .prepare("SELECT count(*) as c FROM round_result WHERE round_id = ?")
      .get(roundId) as { c: number };
    assert.strictEqual(totalRows.c, 1, "Must remain exactly one row");
  });

  it("Performance: 104 weekly Rounds (2 years) query renders in under 1.5 seconds", () => {
    const db = initDatabase();

    db.prepare("INSERT INTO organization (id, name) VALUES ('org-perf', 'Perf Org')").run();
    db.prepare("INSERT INTO team (id, name, time_zone) VALUES ('team-perf', 'Team Perf', 'UTC')").run();
    db.prepare(
      `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
       VALUES ('pulse-perf', 'team-perf', 'Pulse Perf', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
    ).run();

    const insertRoundStmt = db.prepare(
      `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, effective_minimum_group_size, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
       VALUES (?, 'pulse-perf', 'team-perf', 'shared', ?, ?, ?, 4, 'Pulse Perf', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
    );

    const insertResultStmt = db.prepare(
      "INSERT INTO round_result (round_id, computed_at, payload) VALUES (?, ?, ?)",
    );

    const qv1 = QuestionVersionId.make("qv-1.1");
    const qv2 = QuestionVersionId.make("qv-2.1");
    const pulsePerfId = PulseId.make("pulse-perf");
    const teamPerfId = TeamId.make("team-perf");

    const questions: ReadonlyArray<QuestionInput> = [
      {
        id: qv1,
        position: 0,
        text: "How manageable is your workload?",
        type: { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: true },
        dimension: "workload",
      },
      {
        id: qv2,
        position: 1,
        text: "How safe do you feel speaking up?",
        type: { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: true },
        dimension: "psychologicalSafety",
      },
    ];

    // Insert 104 rounds (2 years of weekly rounds)
    const baseInstant = 1700000000000;
    const weekMs = 7 * 24 * 3600_000;

    for (let i = 0; i < 104; i++) {
      const roundIdStr = `round-${i}`;
      const openAt = baseInstant + i * weekMs;
      const closeAt = openAt + 3 * 24 * 3600_000;
      const dateStr = `2024-${String(Math.floor(i / 4) + 1).padStart(2, "0")}-${String((i % 4) * 7 + 1).padStart(2, "0")}`;

      insertRoundStmt.run(roundIdStr, dateStr, openAt, closeAt);

      const fakeResult = calculateRoundResult({
        roundId: RoundId.make(roundIdStr),
        pulseId: pulsePerfId,
        teamId: teamPerfId,
        status: "shared",
        plannedOpenDate: dateStr,
        closedAt: closeAt,
        effectiveMinimumGroupSize: 4,
        eligibleMembersCount: 8,
        questions,
        submissions: [
          {
            id: `sub-${i}-1`,
            answers: [
              { questionVersionId: qv1, value: 4, comment: "Good" },
              { questionVersionId: qv2, value: 5, comment: null },
            ],
          },
          {
            id: `sub-${i}-2`,
            answers: [
              { questionVersionId: qv1, value: 3, comment: null },
              { questionVersionId: qv2, value: 4, comment: null },
            ],
          },
          {
            id: `sub-${i}-3`,
            answers: [
              { questionVersionId: qv1, value: 4, comment: null },
              { questionVersionId: qv2, value: 4, comment: null },
            ],
          },
          {
            id: `sub-${i}-4`,
            answers: [
              { questionVersionId: qv1, value: 5, comment: "Awesome" },
              { questionVersionId: qv2, value: 5, comment: null },
            ],
          },
        ],
        pastRoundsHistory: [],
      });

      insertResultStmt.run(roundIdStr, closeAt, JSON.stringify(fakeResult));
    }

    // Benchmark reading and decoding a Result for round 103 (latest round with 104 rounds in DB)
    const startTime = performance.now();

    const queryStmt = db.prepare("SELECT payload FROM round_result WHERE round_id = ?");
    for (let q = 0; q < 50; q++) {
      const roundIdStr = `round-${103 - (q % 10)}`;
      const row = queryStmt.get(roundIdStr) as { payload: string };
      assert.isDefined(row);
      const parsed: unknown = JSON.parse(row.payload);
      const decoded = Schema.decodeUnknownOption(RoundResult)(parsed);
      const result = Option.getOrNull(decoded);
      assert.isNotNull(result);
      if (result !== null) {
        const enforced = enforceEffectiveNOnResult(result, 4);
        assert.isTrue(enforced.meetsMinimumGroupSize);
      }
    }

    const elapsed = performance.now() - startTime;
    // 50 queries + decodes must execute in well under 1500 ms!
    assert.isBelow(elapsed, 1500, `Expected elapsed < 1500ms, got ${elapsed}ms`);
  });
});
