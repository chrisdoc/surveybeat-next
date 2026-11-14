// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import { SqliteClient } from "@effect/sql-sqlite-do";
import { assert, describe, it } from "@effect/vitest";
import { RoundId, TeamId } from "@surveybeat/domain";
import { SqliteStorage } from "@surveybeat/testing";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { makeSqlNotes } from "./SqlNotes.ts";

const migrationsDir = new URL("../migrations/", import.meta.url);
const roundId = RoundId.make("round-1");
const teamId = TeamId.make("team-1");

/** The Organization's migrations in order, with one Team, one Pulse, and one Round to hold a Note. */
const openNotes = Effect.gen(function* () {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(new URL(file, migrationsDir), "utf8"));
  }
  db.prepare("INSERT INTO team (id, name, time_zone) VALUES ('team-1', 'Team 1', 'UTC')").run();
  db.prepare(
    `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
     VALUES ('pulse-1', 'team-1', 'Pulse 1', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
  ).run();
  db.prepare(
    `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, effective_minimum_group_size, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
     VALUES ('round-1', 'pulse-1', 'team-1', 'shared', '2026-01-05', 1000, 2000, 4, 'Pulse 1', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
  ).run();
  const sql = yield* SqliteClient.make({
    storage: SqliteStorage.makeSqliteStorage(db) as unknown as NonNullable<
      Parameters<typeof SqliteClient.make>[0]["storage"]
    >,
  }).pipe(Effect.provideService(Scope.Scope, yield* Scope.make()), Effect.provide(Reactivity.layer));
  return { db, notes: makeSqlNotes(sql) };
});

describe("makeSqlNotes", () => {
  it.effect("reads null when the Round has no Note", () =>
    Effect.gen(function* () {
      const { notes } = yield* openNotes;
      assert.isNull(yield* notes.getNote(roundId));
    }),
  );

  it.effect("stores a Note on upsert and reads it back", () =>
    Effect.gen(function* () {
      const { notes } = yield* openNotes;
      yield* notes.upsertNote({ roundId, teamId, text: "First", updatedAt: 10 });
      assert.deepStrictEqual(yield* notes.getNote(roundId), { roundId, text: "First", updatedAt: 10 });
    }),
  );

  it.effect("a second upsert replaces the text and the updatedAt, keeping one row", () =>
    Effect.gen(function* () {
      const { db, notes } = yield* openNotes;
      yield* notes.upsertNote({ roundId, teamId, text: "First", updatedAt: 10 });
      yield* notes.upsertNote({ roundId, teamId, text: "Second", updatedAt: 20 });
      assert.deepStrictEqual(yield* notes.getNote(roundId), { roundId, text: "Second", updatedAt: 20 });
      const count = db.prepare("SELECT COUNT(*) AS n FROM round_note").get() as { n: number };
      assert.strictEqual(count.n, 1);
    }),
  );

  it.effect("deleteNote removes the Note", () =>
    Effect.gen(function* () {
      const { notes } = yield* openNotes;
      yield* notes.upsertNote({ roundId, teamId, text: "First", updatedAt: 10 });
      yield* notes.deleteNote(roundId);
      assert.isNull(yield* notes.getNote(roundId));
    }),
  );

  it.effect("deleting the Round cascades its Note away", () =>
    Effect.gen(function* () {
      const { db, notes } = yield* openNotes;
      yield* notes.upsertNote({ roundId, teamId, text: "First", updatedAt: 10 });
      db.prepare("DELETE FROM round WHERE id = 'round-1'").run();
      assert.isNull(yield* notes.getNote(roundId));
    }),
  );
});
