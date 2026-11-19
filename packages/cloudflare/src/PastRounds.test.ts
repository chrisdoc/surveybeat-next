// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import { SqliteClient } from "@effect/sql-sqlite-do";
import { assert, describe, it } from "@effect/vitest";
import { calculateRoundResult, PulseId, QuestionVersionId, RoundId, TeamId } from "@surveybeat/domain";
import { SqliteStorage } from "@surveybeat/testing";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { makeSqlRounds, secureRandomBytes } from "./SqlRounds.ts";

const migrationsDir = new URL("../migrations/", import.meta.url);
const weekMs = 7 * 24 * 3_600_000;
const start = DateTime.toEpochMillis(DateTime.makeUnsafe({ year: 2026, month: 1, day: 5 }));
const qv = QuestionVersionId.make("qv-1");

/** 14 weekly shared Rounds with stored Results, ids round-0 (oldest) to round-13 (latest). */
const seed = (db: DatabaseSync): void => {
  db.prepare("INSERT INTO organization (id, name) VALUES ('org-1', 'Org 1')").run();
  db.prepare("INSERT INTO team (id, name, time_zone) VALUES ('team-1', 'Team 1', 'UTC')").run();
  db.prepare(
    `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
     VALUES ('pulse-1', 'team-1', 'Pulse 1', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
  ).run();
  for (let i = 0; i < 14; i++) {
    const openAt = start + i * weekMs;
    const date = DateTime.formatIsoDateUtc(DateTime.makeUnsafe(openAt));
    db.prepare(
      `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, effective_minimum_group_size, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
       VALUES (?, 'pulse-1', 'team-1', 'shared', ?, ?, ?, 4, 'Pulse 1', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
    ).run(`round-${i}`, date, openAt, openAt + 3 * 24 * 3_600_000);
    const result = calculateRoundResult({
      roundId: RoundId.make(`round-${i}`),
      pulseId: PulseId.make("pulse-1"),
      teamId: TeamId.make("team-1"),
      status: "shared",
      plannedOpenDate: date,
      anonymityMode: "anonymous",
      closedAt: openAt,
      effectiveMinimumGroupSize: 4,
      eligibleMembersCount: 4,
      questions: [
        {
          id: qv,
          position: 0,
          text: "How manageable was your workload this week?",
          type: { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: false },
          dimension: "workload",
        },
      ],
      submissions: [1, 2, 3, 4].map((n) => ({
        id: `sub-${i}-${n}`,
        answers: [{ questionVersionId: qv, value: 3, comment: null }],
      })),
      pastRoundsHistory: [],
    });
    db.prepare("INSERT INTO round_result (round_id, computed_at, payload) VALUES (?, ?, ?)").run(
      `round-${i}`,
      openAt,
      JSON.stringify(result),
    );
  }
  db.prepare(
    `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
     VALUES ('pulse-2', 'team-1', 'Pulse 2', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
  ).run();
  db.prepare(
    `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
     VALUES ('other-round', 'pulse-2', 'team-1', 'open', '2026-01-05', ?, ?, 'Pulse 2', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
  ).run(start, start + 3 * 24 * 3_600_000);
  for (const person of ["p-1", "p-2", "p-3"]) {
    db.prepare("INSERT INTO person (id, email) VALUES (?, ?)").run(person, `${person}@example.com`);
  }
  const invite = db.prepare(
    `INSERT INTO invitation (round_id, person_id, token_hash, send_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1000, 1000)`,
  );
  invite.run("round-13", "p-1", "hash-13-1", "send-13-1", "sent");
  invite.run("round-13", "p-2", "hash-13-2", "send-13-2", "revoked");
  invite.run("round-12", "p-1", "hash-12-1", "send-12-1", "failed");
  invite.run("other-round", "p-3", "hash-other-3", "send-other-3", "sent");
};

const openRounds = Effect.gen(function* () {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(new URL(file, migrationsDir), "utf8"));
  }
  seed(db);
  const sql = yield* SqliteClient.make({
    storage: SqliteStorage.makeSqliteStorage(db) as unknown as NonNullable<
      Parameters<typeof SqliteClient.make>[0]["storage"]
    >,
  }).pipe(Effect.provideService(Scope.Scope, yield* Scope.make()), Effect.provide(Reactivity.layer));
  return makeSqlRounds(sql, secureRandomBytes);
});

describe("getPastRoundsResultsForPulse", () => {
  it.effect("returns the latest Rounds, oldest first, when there are more than the limit", () =>
    Effect.gen(function* () {
      const rounds = yield* openRounds;
      const history = yield* rounds.getPastRoundsResultsForPulse(PulseId.make("pulse-1"), 12);
      assert.deepStrictEqual(
        history.map((h) => h.roundId),
        Array.from({ length: 12 }, (_, i) => `round-${i + 2}`),
      );
    }),
  );

  it.effect("before a date, returns the Rounds right before it, oldest first", () =>
    Effect.gen(function* () {
      const rounds = yield* openRounds;
      const before = DateTime.formatIsoDateUtc(DateTime.makeUnsafe(start + 13 * weekMs));
      const history = yield* rounds.getPastRoundsResultsForPulse(PulseId.make("pulse-1"), 11, before);
      assert.deepStrictEqual(
        history.map((h) => h.roundId),
        Array.from({ length: 11 }, (_, i) => `round-${i + 2}`),
      );
    }),
  );
});

describe("getInvitedPersonIdsForPulse", () => {
  it.effect("groups every Invitation of the Pulse's Rounds by Round, whatever its status", () =>
    Effect.gen(function* () {
      const rounds = yield* openRounds;
      const invited = yield* rounds.getInvitedPersonIdsForPulse(PulseId.make("pulse-1"));
      assert.deepStrictEqual(
        new Map([...invited.entries()].map(([roundId, people]) => [roundId, new Set(people)])),
        new Map([
          [RoundId.make("round-12"), new Set(["p-1"])],
          [RoundId.make("round-13"), new Set(["p-1", "p-2"])],
        ]),
      );
    }),
  );
});
