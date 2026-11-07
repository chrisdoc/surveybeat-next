/**
 * The deterministic A4 harness (ADR 0005, invariant A4): after k Submissions written in a known
 * order, nothing in a dump predicts which Participation record goes with which Submission.
 *
 * A subject writes one Participant at a time through its own storage and then dumps two tables.
 * Every key the subject mints must come from Effect's `Random`, which the harness seeds, so each
 * run is identical. The harness then runs the known attacks against the dump and measures how many
 * pairs each one recovers. Chance is one correct pair, so the bar is at most `MAX_MATCHES` (2/k).
 */
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";

/** k from the privacy suite design (issue #25, section 2). */
export const K = 200;

/** Three fixed seeds. A run is the same on every machine, so a failure is never a flake. */
export const SEEDS: ReadonlyArray<string> = ["a4-alpha", "a4-bravo", "a4-charlie"];

/** At most 2 of k pairs may be recovered by any attack (match rate ≤ 2/k). */
export const MAX_MATCHES = 2;

export type Row = Readonly<Record<string, unknown>>;

export interface Table {
  readonly name: string;
  /** The primary key columns, most significant first. A rowid table without one uses `["rowid"]`. */
  readonly key: ReadonlyArray<string>;
  /** Every row, in the order the dump returned it. Include a `rowid` column when the table has one. */
  readonly rows: ReadonlyArray<Row>;
}

export interface Dump {
  readonly participation: Table;
  readonly submission: Table;
}

/** One Person answering. Both values are random and unique, so the harness can find the true pairs. */
export interface Participant {
  /** Must be stored verbatim in the Participation record, for example as the Person id. */
  readonly person: string;
  /** Must be stored verbatim in the Submission row, for example as an Answer value. */
  readonly answer: string;
}

export interface Subject<E, R> {
  /** Writes the Participation record and the Submission of one Participant, as the product does. */
  readonly write: (participant: Participant) => Effect.Effect<void, E, R>;
  /** Reads both tables back the way an operator would dump them. */
  readonly dump: Effect.Effect<Dump, E, R>;
}

export type AttackName = "rank" | "keyOrder" | "sharedColumns" | "rowid";

export interface AttackResult {
  readonly attack: AttackName;
  /** Expected number of correctly recovered pairs. Ties count as a uniform guess among them. */
  readonly matches: number;
  readonly detail: string;
}

export interface SeedReport {
  readonly seed: string;
  readonly k: number;
  readonly attacks: ReadonlyArray<AttackResult>;
}

export class LinkableDump extends Data.TaggedError("LinkableDump")<{
  readonly violations: ReadonlyArray<{ readonly seed: string } & AttackResult>;
}> {
  override get message() {
    return this.violations
      .map((v) => `seed ${v.seed}: ${v.attack} recovered ${v.matches.toFixed(2)} pairs (${v.detail})`)
      .join("; ");
  }
}

/** A random 128-bit value as hex, from the seeded `Random`. */
export const randomHex = (bytes = 16): Effect.Effect<string> =>
  Effect.gen(function* () {
    let hex = "";
    for (let i = 0; i < bytes; i++) {
      hex += (yield* Random.nextIntBetween(0, 255)).toString(16).padStart(2, "0");
    }
    return hex;
  });

/**
 * Writes k Participants in index order into a fresh subject and runs every attack, once per seed.
 * `makeSubject` runs inside the seeded `Random`, so it must create fresh, empty storage each time.
 */
export const measure = <E, R>(
  makeSubject: Effect.Effect<Subject<E, R>, E, R>,
  options: { readonly k?: number; readonly seeds?: ReadonlyArray<string> } = {},
): Effect.Effect<ReadonlyArray<SeedReport>, E, R> => {
  const k = options.k ?? K;
  return Effect.forEach(options.seeds ?? SEEDS, (seed) =>
    Effect.gen(function* () {
      const subject = yield* makeSubject;
      const participants: Array<Participant> = [];
      for (let i = 0; i < k; i++) {
        participants.push({ person: `person-${yield* randomHex()}`, answer: `answer-${yield* randomHex()}` });
      }
      for (const participant of participants) yield* subject.write(participant);
      const dump = yield* subject.dump;
      return { seed, k, attacks: runAttacks(dump, participants) };
    }).pipe(Random.withSeed(seed)),
  );
};

/** Fails with `LinkableDump` when any attack recovers more than `MAX_MATCHES` pairs for any seed. */
export const assertUnlinkable = <E, R>(
  makeSubject: Effect.Effect<Subject<E, R>, E, R>,
  options: { readonly k?: number; readonly seeds?: ReadonlyArray<string> } = {},
): Effect.Effect<ReadonlyArray<SeedReport>, E | LinkableDump, R> =>
  measure(makeSubject, options).pipe(
    Effect.flatMap((reports) => {
      const violations = reports.flatMap((report) =>
        report.attacks.filter((a) => a.matches > MAX_MATCHES).map((a) => ({ seed: report.seed, ...a })),
      );
      return violations.length === 0
        ? Effect.succeed(reports)
        : Effect.fail(new LinkableDump({ violations }));
    }),
  );

/**
 * For each Participation row, the Submission rows an attack considers equally likely. The expected
 * number of correct pairs is the sum, over Participation rows, of 1/|candidates| when the true
 * Submission is among them.
 */
type Guess = ReadonlyArray<ReadonlyArray<number>>;

export const runAttacks = (
  dump: Dump,
  participants: ReadonlyArray<Participant>,
): ReadonlyArray<AttackResult> => {
  const truth = trueSubmissionOf(dump, participants);
  const score = (guess: Guess) =>
    guess.reduce(
      (sum, candidates, p) => sum + (candidates.includes(truth[p] ?? -1) ? 1 / candidates.length : 0),
      0,
    );
  const { participation, submission } = dump;
  const byRank = (pOrder: ReadonlyArray<number>, sOrder: ReadonlyArray<number>): Guess => {
    const guess: Array<Array<number>> = participation.rows.map(() => []);
    pOrder.forEach((p, rank) => {
      const s = sOrder[rank];
      if (s !== undefined) guess[p] = [s];
    });
    return guess;
  };

  const results: Array<AttackResult> = [
    {
      attack: "rank",
      matches: score(byRank(indices(participation.rows), indices(submission.rows))),
      detail: "i-th row of each dump paired",
    },
    {
      attack: "keyOrder",
      matches: score(byRank(sortBy(participation, participation.key), sortBy(submission, submission.key))),
      detail: `${participation.name}(${participation.key.join(", ")}) vs ${submission.name}(${submission.key.join(", ")})`,
    },
  ];

  const hasRowid = (table: Table) => table.rows.some((row) => "rowid" in row);
  if (hasRowid(participation) || hasRowid(submission)) {
    const order = (table: Table) => sortBy(table, hasRowid(table) ? ["rowid"] : table.key);
    results.push({
      attack: "rowid",
      matches: score(byRank(order(participation), order(submission))),
      detail: "both dumps sorted by rowid where present",
    });
  }

  // Any column of one table against any column of the other: rows with an equal value are candidates.
  let best: AttackResult = { attack: "sharedColumns", matches: 0, detail: "no column pairs" };
  for (const pColumn of columns(participation)) {
    for (const sColumn of columns(submission)) {
      const bySValue = new Map<string, Array<number>>();
      submission.rows.forEach((row, s) => {
        const value = valueKey(row[sColumn]);
        bySValue.set(value, [...(bySValue.get(value) ?? []), s]);
      });
      const guess = participation.rows.map((row) => bySValue.get(valueKey(row[pColumn])) ?? []);
      const matches = score(guess);
      if (matches > best.matches) {
        best = {
          attack: "sharedColumns",
          matches,
          detail: `${participation.name}.${pColumn} = ${submission.name}.${sColumn}`,
        };
      }
    }
  }
  results.push(best);
  return results;
};

/** truth[p] is the index of the Submission row that belongs with Participation row p. */
const trueSubmissionOf = (dump: Dump, participants: ReadonlyArray<Participant>): ReadonlyArray<number> => {
  const locate = (table: Table, values: ReadonlyArray<string>): ReadonlyArray<number> => {
    if (table.rows.length !== values.length) {
      throw new Error(`${table.name} has ${table.rows.length} rows, expected ${values.length}`);
    }
    const index = new Map(values.map((value, i) => [value, i]));
    return table.rows.map((row, r) => {
      const found = Object.values(row).flatMap((value) =>
        typeof value === "string" && index.has(value) ? [index.get(value) ?? -1] : [],
      );
      if (found.length !== 1) {
        throw new Error(`${table.name} row ${r} does not hold exactly one of the harness's values`);
      }
      return found[0] ?? -1;
    });
  };
  const participantOfP = locate(
    dump.participation,
    participants.map((p) => p.person),
  );
  const participantOfS = locate(
    dump.submission,
    participants.map((p) => p.answer),
  );
  const submissionOfParticipant = new Map(participantOfS.map((participant, s) => [participant, s]));
  return participantOfP.map((participant) => submissionOfParticipant.get(participant) ?? -1);
};

const indices = (rows: ReadonlyArray<Row>): ReadonlyArray<number> => rows.map((_, i) => i);

const columns = (table: Table): ReadonlyArray<string> => [
  ...new Set(table.rows.flatMap((row) => Object.keys(row))),
];

const sortBy = (table: Table, key: ReadonlyArray<string>): ReadonlyArray<number> =>
  indices(table.rows).toSorted((a, b) => {
    for (const column of key) {
      const order = compareValues(table.rows[a]?.[column], table.rows[b]?.[column]);
      if (order !== 0) return order;
    }
    return 0;
  });

/** SQLite's order: NULL, then numbers, then text, then blobs (bytewise). */
const typeRank = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number" || typeof value === "bigint") return 1;
  if (typeof value === "string") return 2;
  return 3;
};

const compareValues = (a: unknown, b: unknown): number => {
  const rankDifference = typeRank(a) - typeRank(b);
  if (rankDifference !== 0) return rankDifference;
  if ((typeof a === "number" || typeof a === "bigint") && (typeof b === "number" || typeof b === "bigint")) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const difference = (a[i] ?? 0) - (b[i] ?? 0);
      if (difference !== 0) return difference;
    }
    return a.length - b.length;
  }
  return 0;
};

/** A key under which equal stored values collide: 1 and 1n are equal, blobs compare by bytes. */
const valueKey = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "bigint") return `n:${String(value)}`;
  if (typeof value === "string") return `s:${value}`;
  if (value instanceof Uint8Array)
    return `b:${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return `o:${JSON.stringify(value)}`;
};
