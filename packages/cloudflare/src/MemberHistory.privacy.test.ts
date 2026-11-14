// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import { SqliteClient } from "@effect/sql-sqlite-do";
import { assert, describe, it } from "@effect/vitest";
import {
  buildMemberHistory,
  calculateRoundResult,
  PersonId,
  PulseId,
  QuestionVersionId,
  type Roster,
  RoundId,
  TeamId,
} from "@surveybeat/domain";
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

const ROUND_A = RoundId.make("round-a");
const ROUND_B = RoundId.make("round-b");
const RATING = QuestionVersionId.make("qv-rating");
const TEXT = QuestionVersionId.make("qv-text");

/**
 * The product's own `makeSqlRounds` on the real migrations, over an in-memory `node:sqlite` database
 * that stands in for the Organization object's storage. Two open Rounds of one Team, each with the
 * same two Questions: a Rating and a long text.
 */
const openRounds = () =>
  Effect.gen(function* () {
    const db = initDatabase();
    db.prepare("INSERT INTO organization (id, name) VALUES ('org-1', 'Org 1')").run();
    db.prepare("INSERT INTO team (id, name, time_zone) VALUES ('team-1', 'Team 1', 'UTC')").run();
    db.prepare(
      `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
       VALUES ('pulse-1', 'team-1', 'Pulse 1', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
    ).run();
    const insertRound = (id: RoundId, plannedOpenDate: string) =>
      db
        .prepare(
          `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
           VALUES (?, 'pulse-1', 'team-1', 'open', ?, 1000, 9999999, 'Pulse 1', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
        )
        .run(id, plannedOpenDate);
    insertRound(ROUND_A, "2026-11-09");
    insertRound(ROUND_B, "2026-11-02");
    db.prepare("INSERT INTO question (id, created_at) VALUES ('q-rating', 1000), ('q-text', 1000)").run();
    db.prepare(
      `INSERT INTO question_version (id, question_id, number, text, dimension, type) VALUES
         ('qv-rating', 'q-rating', 1, 'How clear is the plan?', 'clarity', '{"_tag":"Rating","lowLabel":"Low","highLabel":"High","comment":false}'),
         ('qv-text', 'q-text', 1, 'Anything else?', NULL, '{"_tag":"LongText"}')`,
    ).run();
    for (const roundId of [ROUND_A, ROUND_B]) {
      db.prepare(
        "INSERT INTO round_question (round_id, position, question_version_id) VALUES (?, 0, 'qv-rating'), (?, 1, 'qv-text')",
      ).run(roundId, roundId);
    }
    const sql = yield* SqliteClient.make({
      storage: SqliteStorage.makeSqliteStorage(db) as unknown as NonNullable<
        Parameters<typeof SqliteClient.make>[0]["storage"]
      >,
    }).pipe(Effect.provideService(Scope.Scope, yield* Scope.make()), Effect.provide(Reactivity.layer));
    return { db, rounds: makeSqlRounds(sql, yield* Unlinkability.seededRandomBytes) };
  });

describe("Member history privacy (ADR 0017, ADR 0005, ADR 0004)", () => {
  it.effect(
    "shows a member their Rounds and Team scores, and no Submission, answer, comment, or Person",
    () =>
      Effect.gen(function* () {
        const { db, rounds } = yield* openRounds();
        const answers = (comment: string | null) => [
          { questionVersionId: RATING, value: 4, comment: null },
          { questionVersionId: TEXT, value: null, comment },
        ];
        // Four Persons answer Round A; person-other answers only Round B.
        const roundAPersons = ["person-1", "person-2", "person-3", "person-4"];
        for (const person of [...roundAPersons, "person-other"]) {
          db.prepare("INSERT INTO person (id, email) VALUES (?, ?)").run(person, `${person}@example.com`);
        }
        const roster: Roster = [];
        for (const [index, person] of roundAPersons.entries()) {
          yield* rounds
            .recordFirstAnswer(
              ROUND_A,
              PersonId.make(person),
              `editkeyhash-a-${index}`,
              answers(index === 0 ? "secret comment" : null),
              roster,
            )
            .pipe(Effect.orDie);
        }
        yield* rounds
          .recordFirstAnswer(
            ROUND_B,
            PersonId.make("person-other"),
            "editkeyhash-b-0",
            answers("another secret"),
            roster,
          )
          .pipe(Effect.orDie);

        // Round A is shared: store its Result as the product computes it.
        db.prepare("UPDATE round SET status = 'shared' WHERE id = ?").run(ROUND_A);
        const submissions = yield* rounds.getSubmissionsForRound(ROUND_A);
        const questions = yield* rounds.getRoundQuestionsDetailed(ROUND_A);
        const result = calculateRoundResult({
          roundId: ROUND_A,
          pulseId: PulseId.make("pulse-1"),
          teamId: TeamId.make("team-1"),
          status: "shared",
          plannedOpenDate: "2026-11-09",
          anonymityMode: "anonymous",
          closedAt: 1_731_000_000_000,
          effectiveMinimumGroupSize: 2,
          eligibleMembersCount: 4,
          questions,
          submissions,
          pastRoundsHistory: [],
        });
        yield* rounds.saveRoundResult(ROUND_A, result, 1_731_000_000_000);

        // The Result the product stores does hold the comment, so the check below is not vacuous.
        const stored = db.prepare("SELECT payload FROM round_result WHERE round_id = ?").get(ROUND_A) as {
          payload: string;
        };
        assert.include(stored.payload, "secret comment");

        const participated = yield* rounds.getParticipatedRounds(PersonId.make("person-1"));
        assert.deepStrictEqual(
          participated.map((row) => row.roundId),
          [ROUND_A],
          "only the Round the Person took part in is listed",
        );
        const history = buildMemberHistory({
          rounds: yield* Effect.forEach(participated, (row) =>
            Effect.map(rounds.getRoundQuestionsDetailed(row.roundId), (roundQuestions) => ({
              ...row,
              questions: roundQuestions,
              canViewResults: true,
            })),
          ),
          minimumGroupSize: 2,
        });

        const [round] = history.rounds;
        assert.strictEqual(round?.teamResult, "shown");
        assert.deepStrictEqual(
          round?.questions.map((question) => [question.questionVersionId, question.teamScore]),
          [
            [RATING, 4],
            [TEXT, null],
          ],
        );

        const json = JSON.stringify(history);
        const submissionIds = (db.prepare("SELECT id FROM submission").all() as Array<{ id: string }>).map(
          (row) => row.id,
        );
        assert.strictEqual(submissionIds.length, 5);
        for (const id of submissionIds) assert.notInclude(json, id);
        const editKeyHashes = (
          db.prepare("SELECT edit_key_hash FROM submission").all() as Array<{ edit_key_hash: string }>
        ).map((row) => row.edit_key_hash);
        for (const hash of editKeyHashes) assert.notInclude(json, hash);
        assert.notInclude(json, "secret comment");
        assert.notInclude(json, "another secret");
        for (const person of ["person-1", "person-2", "person-other"]) {
          assert.notInclude(json, person);
        }
      }),
  );
});
