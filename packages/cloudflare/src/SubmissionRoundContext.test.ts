import { SqliteClient } from "@effect/sql-sqlite-do";
import { assert, describe, it } from "@effect/vitest";
import { RoundId } from "@surveybeat/domain";
import { SqliteStorage, Unlinkability } from "@surveybeat/testing";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { makeSqlRounds } from "./SqlRounds.ts";

const migrationsDir = new URL("../migrations/", import.meta.url);

const roundId = RoundId.make("round-1");

/** The Organization object's storage on the real migrations, with one open Round. */
const openRounds = (aiProcessing: 0 | 1) =>
  Effect.gen(function* () {
    const db = new DatabaseSync(":memory:");
    for (const file of readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      db.exec(readFileSync(new URL(file, migrationsDir), "utf8"));
    }
    db.prepare("INSERT INTO organization (id, name, ai_processing) VALUES ('org-1', 'Org 1', ?)").run(
      aiProcessing,
    );
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
    return makeSqlRounds(sql, yield* Unlinkability.seededRandomBytes);
  });

describe("Submission round context", () => {
  it.effect("tells the answer page that AI processing is on when the Organization has it on", () =>
    Effect.gen(function* () {
      const rounds = yield* openRounds(1);
      const context = yield* rounds.getSubmissionRoundContext(roundId, null, 4);
      assert.strictEqual(context?.aiProcessing, true);
    }),
  );

  it.effect("tells the answer page that AI processing is off by default", () =>
    Effect.gen(function* () {
      const rounds = yield* openRounds(0);
      const context = yield* rounds.getSubmissionRoundContext(roundId, null, 4);
      assert.strictEqual(context?.aiProcessing, false);
    }),
  );
});
