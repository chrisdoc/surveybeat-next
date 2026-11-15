// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import { SqliteClient } from "@effect/sql-sqlite-do";
import { assert, describe, it } from "@effect/vitest";
import { PersonId, QuestionVersionId, RoundId } from "@surveybeat/domain";
import { SqliteStorage } from "@surveybeat/testing";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { makeSqlRounds, secureRandomBytes } from "./SqlRounds.ts";

const doMigrationsDir = new URL("../migrations/", import.meta.url);

describe("SubmissionWorker first answer privacy (ADR 0005, ADR 0009)", () => {
  it.effect("first answer atomically records participation and submission, and redacts the comment", () =>
    Effect.gen(function* () {
      const roundId = RoundId.make("round-1");
      const personId = PersonId.make("person-1");
      const qVersionId = QuestionVersionId.make("qv-1");
      const editKeyHash = "hash-of-the-browser-secret";

      const db = new DatabaseSync(":memory:");
      for (const file of readdirSync(doMigrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort()) {
        db.exec(readFileSync(new URL(file, doMigrationsDir), "utf8"));
      }
      db.prepare("INSERT INTO organization (id, name) VALUES ('org-1', 'Acme')").run();
      db.prepare("INSERT INTO team (id, name, time_zone) VALUES ('team-1', 'Platform', 'UTC')").run();
      db.prepare(
        `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
         VALUES ('pulse-1', 'team-1', 'Pulse 1', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
      ).run();
      db.prepare(
        `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
         VALUES (?, 'pulse-1', 'team-1', 'open', '2026-11-09', 1000, 9999999, 'Pulse 1', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
      ).run(roundId);
      db.prepare("INSERT INTO person (id, email) VALUES (?, 'member@example.com')").run(personId);

      const sql = yield* SqliteClient.make({
        storage: SqliteStorage.makeSqliteStorage(db) as unknown as NonNullable<
          Parameters<typeof SqliteClient.make>[0]["storage"]
        >,
      }).pipe(Effect.provideService(Scope.Scope, yield* Scope.make()), Effect.provide(Reactivity.layer));
      const rounds = makeSqlRounds(sql, secureRandomBytes);

      // The real write path behind the Submission Worker's first-answer route.
      const { submissionId } = yield* rounds
        .recordFirstAnswer(
          roundId,
          personId,
          editKeyHash,
          [
            {
              questionVersionId: qVersionId,
              value: 5,
              comment: "Anna and Bob did great, contact me at test@example.com or 555-123-4567",
            },
          ],
          ["Anna", "Bob"],
        )
        .pipe(Effect.orDie);

      assert.deepStrictEqual(db.prepare("SELECT * FROM participation").all(), [
        { round_id: roundId, person_id: personId },
      ]);
      assert.deepStrictEqual(db.prepare("SELECT * FROM submission").all(), [
        { id: submissionId, round_id: roundId, edit_key_hash: editKeyHash },
      ]);

      const answer = db
        .prepare("SELECT value, comment FROM answer WHERE submission_id = ?")
        .get(submissionId);
      assert.deepStrictEqual(answer, {
        value: 5,
        comment: "[name] and [name] did great, contact me at [email] or [phone]",
      });

      // A second first answer by the same Person is refused and writes nothing.
      const again = yield* rounds
        .recordFirstAnswer(roundId, personId, "another-hash", [], [])
        .pipe(Effect.flip);
      assert.strictEqual(again._tag, "AlreadyAnswered");
      assert.strictEqual(db.prepare("SELECT count(*) AS c FROM submission").get()?.["c"], 1);
    }),
  );
});
