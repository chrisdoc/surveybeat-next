// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import { assert, describe, it } from "@effect/vitest";
import {
  buildTeamOverview,
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

const perfBaseInstant = 1700000000000;
const perfWeekMs = 7 * 24 * 3600_000;
const perfQv1 = QuestionVersionId.make("qv-1.1");
const perfQv2 = QuestionVersionId.make("qv-2.1");
const perfQuestions: ReadonlyArray<QuestionInput> = [
  {
    id: perfQv1,
    position: 0,
    text: "How manageable is your workload?",
    type: { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: true },
    dimension: "workload",
  },
  {
    id: perfQv2,
    position: 1,
    text: "How safe do you feel speaking up?",
    type: { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: true },
    dimension: "psychologicalSafety",
  },
];

interface PerfRound {
  readonly id: string;
  readonly teamId: TeamId;
  readonly pulseId: PulseId;
  readonly status: "shared" | "closed";
  readonly plannedOpenDate: string;
  readonly openAt: number;
  readonly closeAt: number;
}

/** Inserts one Round with its stored Result (4 submissions, effective N 4, 8 eligible Members). */
const insertPerfRound = (db: DatabaseSync, round: PerfRound): void => {
  db.prepare(
    `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, effective_minimum_group_size, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 4, 'Pulse Perf', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
  ).run(
    round.id,
    round.pulseId,
    round.teamId,
    round.status,
    round.plannedOpenDate,
    round.openAt,
    round.closeAt,
  );

  const submission = (suffix: number, v1: number, v2: number) => ({
    id: `sub-${round.id}-${suffix}`,
    answers: [
      { questionVersionId: perfQv1, value: v1, comment: suffix % 2 === 0 ? "Good" : null },
      { questionVersionId: perfQv2, value: v2, comment: null },
    ],
  });

  const result = calculateRoundResult({
    roundId: RoundId.make(round.id),
    pulseId: round.pulseId,
    teamId: round.teamId,
    status: round.status,
    plannedOpenDate: round.plannedOpenDate,
    anonymityMode: "anonymous",
    closedAt: round.closeAt,
    effectiveMinimumGroupSize: 4,
    eligibleMembersCount: 8,
    questions: perfQuestions,
    submissions: [submission(1, 4, 5), submission(2, 3, 4), submission(3, 4, 4), submission(4, 5, 5)],
    pastRoundsHistory: [],
  });

  db.prepare("INSERT INTO round_result (round_id, computed_at, payload) VALUES (?, ?, ?)").run(
    round.id,
    round.closeAt,
    JSON.stringify(result),
  );
};

/** Seeds the perf organization, its Team and Pulse, and 104 weekly shared Rounds with stored Results. */
const seedPerfTeam = (db: DatabaseSync): void => {
  db.prepare("INSERT INTO organization (id, name) VALUES ('org-perf', 'Perf Org')").run();
  db.prepare("INSERT INTO team (id, name, time_zone) VALUES ('team-perf', 'Team Perf', 'UTC')").run();
  db.prepare(
    `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
     VALUES ('pulse-perf', 'team-perf', 'Pulse Perf', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
  ).run();

  // Insert 104 rounds (2 years of weekly rounds)
  for (let i = 0; i < 104; i++) {
    const openAt = perfBaseInstant + i * perfWeekMs;
    const dateStr = `2024-${String(Math.floor(i / 4) + 1).padStart(2, "0")}-${String((i % 4) * 7 + 1).padStart(2, "0")}`;
    insertPerfRound(db, {
      id: `round-${i}`,
      teamId: TeamId.make("team-perf"),
      pulseId: PulseId.make("pulse-perf"),
      status: "shared",
      plannedOpenDate: dateStr,
      openAt,
      closeAt: openAt + 3 * 24 * 3600_000,
    });
  }
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

  it("decodes a stored Result written before Dimension contributors were kept", () => {
    const result = calculateRoundResult({
      roundId: RoundId.make("round-legacy"),
      pulseId: PulseId.make("pulse-legacy"),
      teamId: TeamId.make("team-legacy"),
      status: "closed",
      plannedOpenDate: "2026-11-02",
      anonymityMode: "anonymous",
      closedAt: 1730592000000,
      effectiveMinimumGroupSize: 4,
      eligibleMembersCount: 8,
      questions: perfQuestions,
      submissions: [1, 2, 3, 4].map((n) => ({
        id: `sub-legacy-${n}`,
        answers: [
          { questionVersionId: perfQv1, value: 4, comment: null },
          { questionVersionId: perfQv2, value: 4, comment: null },
        ],
      })),
      pastRoundsHistory: [],
    });

    const legacy: unknown = JSON.parse(JSON.stringify(result));
    const dimensions = (legacy as { dimensions: Array<Record<string, unknown>> }).dimensions;
    const first = dimensions[0];
    if (first === undefined) throw new Error("the Result has no Dimension to strip");
    delete first.contributors;

    const decoded = Option.getOrNull(Schema.decodeUnknownOption(RoundResult)(legacy));
    assert.isNotNull(decoded);
    assert.strictEqual(decoded.dimensions[0]?.contributors, undefined);
  });

  it("Performance: 104 weekly Rounds (2 years) query renders in under 1.5 seconds", () => {
    const db = initDatabase();
    seedPerfTeam(db);

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

  it("Performance: Team overview over 104 weekly shared Rounds builds in under 1.5 seconds", () => {
    const db = initDatabase();
    seedPerfTeam(db);

    // Excluded by the query: same Team but not shared
    insertPerfRound(db, {
      id: "round-closed",
      teamId: TeamId.make("team-perf"),
      pulseId: PulseId.make("pulse-perf"),
      status: "closed",
      plannedOpenDate: "2025-06-02",
      openAt: perfBaseInstant + 104 * perfWeekMs,
      closeAt: perfBaseInstant + 104 * perfWeekMs + 3 * 24 * 3600_000,
    });

    // Excluded by the query: shared, but another Team's Round
    db.prepare("INSERT INTO team (id, name, time_zone) VALUES ('team-other', 'Team Other', 'UTC')").run();
    db.prepare(
      `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
       VALUES ('pulse-other', 'team-other', 'Pulse Other', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
    ).run();
    insertPerfRound(db, {
      id: "round-other-team",
      teamId: TeamId.make("team-other"),
      pulseId: PulseId.make("pulse-other"),
      status: "shared",
      plannedOpenDate: "2025-06-09",
      openAt: perfBaseInstant + 105 * perfWeekMs,
      closeAt: perfBaseInstant + 105 * perfWeekMs + 3 * 24 * 3600_000,
    });

    // A copy of `getSharedRoundResultsForTeam`'s SQL: this measures query, decode and build time.
    const overviewSql = `SELECT rr.payload FROM round_result rr JOIN round r ON r.id = rr.round_id WHERE r.team_id = ? AND r.status = 'shared' ORDER BY r.planned_open_at ASC, r.id ASC`;
    const teamId = TeamId.make("team-perf");

    const startTime = performance.now();

    const rows = db.prepare(overviewSql).all("team-perf") as Array<{ payload: string }>;
    const results = rows.map((row) => {
      const parsed: unknown = JSON.parse(row.payload);
      return Schema.decodeUnknownSync(RoundResult)(parsed);
    });
    const overview = buildTeamOverview({ teamId, results, minimumGroupSize: 4, actions: [] });

    const elapsed = performance.now() - startTime;

    assert.isBelow(elapsed, 1500, `Expected elapsed < 1500ms, got ${elapsed}ms`);
    assert.strictEqual(overview.rounds.length, 104);
    assert.strictEqual(overview.dimensions.length, 2);
    for (const dimension of overview.dimensions) {
      assert.strictEqual(
        dimension.points.length,
        104,
        `${dimension.dimension} must have one point per Round`,
      );
    }
    const dates = overview.rounds.map((round) => round.plannedOpenDate);
    assert.deepStrictEqual(dates, [...dates].sort(), "Rounds must be in ascending plannedOpenDate order");
  });
});
