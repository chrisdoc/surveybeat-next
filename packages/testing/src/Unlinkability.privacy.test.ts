import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { DatabaseSync } from "node:sqlite";
import * as Unlinkability from "./Unlinkability.ts";

// Proves the A4 harness on SQLite fixtures. The real Submission tables are measured in their own slice.

const ROUND = "round-1";

interface Fixture {
  /** Participation and Submission DDL. */
  readonly schema: string;
  /** The Submission id for the n-th write. */
  readonly submissionId: (n: number) => Effect.Effect<string>;
  /** Extra columns written to both tables, simulating a clock or a batch id. */
  readonly sharedClock?: boolean;
  readonly dumpSubmission: string;
  readonly submissionKey: ReadonlyArray<string>;
}

const randomId = () => Unlinkability.randomHex();

const PARTICIPATION = (clock: boolean) => `
  CREATE TABLE participation (round_id TEXT NOT NULL, person_id TEXT NOT NULL${clock ? ", written_at INTEGER NOT NULL" : ""},
    UNIQUE (round_id, person_id));`;

const subject = (fixture: Fixture) =>
  Effect.sync((): Unlinkability.Subject<never, never> => {
    const db = new DatabaseSync(":memory:");
    db.exec(PARTICIPATION(fixture.sharedClock === true) + fixture.schema);
    let n = 0;
    return {
      write: ({ person, answer }) =>
        Effect.gen(function* () {
          const id = yield* fixture.submissionId(n);
          const clock = 1_794_000_000 + n;
          n++;
          if (fixture.sharedClock === true) {
            db.prepare("INSERT INTO participation VALUES (?, ?, ?)").run(ROUND, person, clock);
            db.prepare("INSERT INTO submission VALUES (?, ?, ?, ?)").run(id, ROUND, answer, clock);
          } else {
            db.prepare("INSERT INTO participation VALUES (?, ?)").run(ROUND, person);
            db.prepare("INSERT INTO submission VALUES (?, ?, ?)").run(id, ROUND, answer);
          }
        }),
      dump: Effect.sync(() => ({
        participation: {
          name: "participation",
          key: ["rowid"],
          rows: db.prepare("SELECT rowid, * FROM participation ORDER BY rowid").all(),
        },
        submission: {
          name: "submission",
          key: fixture.submissionKey,
          rows: db.prepare(fixture.dumpSubmission).all(),
        },
      })),
    };
  });

/** The ADR 0005 shape: WITHOUT ROWID, a random 128-bit key, no time, dumped in key order. */
const safe: Fixture = {
  schema:
    "CREATE TABLE submission (id TEXT PRIMARY KEY, round_id TEXT NOT NULL, answer TEXT NOT NULL) WITHOUT ROWID;",
  submissionId: randomId,
  dumpSubmission: "SELECT id, round_id, answer FROM submission ORDER BY id",
  submissionKey: ["id"],
};

const rowidTable =
  "CREATE TABLE submission (id TEXT NOT NULL UNIQUE, round_id TEXT NOT NULL, answer TEXT NOT NULL);";

const leaky: ReadonlyArray<{
  readonly name: string;
  readonly caughtBy: Unlinkability.AttackName;
  readonly fixture: Fixture;
}> = [
  {
    name: "a rowid table dumped in default order",
    caughtBy: "rank",
    fixture: {
      ...safe,
      schema: rowidTable,
      dumpSubmission: "SELECT id, round_id, answer FROM submission",
    },
  },
  {
    name: "a rowid table whose dump includes the rowid",
    caughtBy: "rowid",
    fixture: {
      ...safe,
      schema: rowidTable,
      dumpSubmission: "SELECT rowid, id, round_id, answer FROM submission ORDER BY id",
    },
  },
  {
    name: "WITHOUT ROWID with sequential keys",
    caughtBy: "keyOrder",
    fixture: { ...safe, submissionId: (n) => Effect.succeed(String(n).padStart(8, "0")) },
  },
  {
    name: "WITHOUT ROWID with random keys and a shared write time",
    caughtBy: "sharedColumns",
    fixture: {
      ...safe,
      sharedClock: true,
      schema:
        "CREATE TABLE submission (id TEXT PRIMARY KEY, round_id TEXT NOT NULL, answer TEXT NOT NULL, written_at INTEGER NOT NULL) WITHOUT ROWID;",
      dumpSubmission: "SELECT id, round_id, answer, written_at FROM submission ORDER BY id",
    },
  },
];

describe("A4 unlinkability harness", () => {
  it.effect("passes a WITHOUT ROWID table with random keys, for every seed", () =>
    Effect.gen(function* () {
      const reports = yield* Unlinkability.assertUnlinkable(subject(safe));
      assert.deepStrictEqual(
        reports.map((r) => r.seed),
        [...Unlinkability.SEEDS],
      );
      for (const report of reports) {
        assert.strictEqual(report.k, Unlinkability.K);
        assert.deepStrictEqual(
          report.attacks.map((a) => a.attack),
          ["rank", "keyOrder", "rowid", "sharedColumns"],
        );
      }
    }),
  );

  for (const { name, caughtBy, fixture } of leaky) {
    it.effect(`fails ${name} (caught by ${caughtBy})`, () =>
      Effect.gen(function* () {
        const reports = yield* Unlinkability.measure(subject(fixture));
        for (const report of reports) {
          const attack = report.attacks.find((a) => a.attack === caughtBy);
          assert.isDefined(attack);
          assert.isAbove(attack?.matches ?? 0, Unlinkability.MAX_MATCHES, `seed ${report.seed}`);
        }
        const error = yield* Unlinkability.assertUnlinkable(subject(fixture)).pipe(Effect.flip);
        assert.strictEqual(error._tag, "LinkableDump");
      }),
    );
  }

  it.effect("gives the same result on every run", () =>
    Effect.gen(function* () {
      const first = yield* Unlinkability.measure(subject(safe));
      const second = yield* Unlinkability.measure(subject(safe));
      assert.deepStrictEqual(first, second);
    }),
  );
});
