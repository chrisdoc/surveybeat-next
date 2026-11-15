import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";

export const K = 200;

export const SEEDS: ReadonlyArray<string> = ["a4-alpha", "a4-bravo", "a4-charlie"];

export const MAX_MATCHES = 2;

export type Row = Readonly<Record<string, unknown>>;

export interface Table {
  readonly name: string;

  readonly key: ReadonlyArray<string>;

  readonly rows: ReadonlyArray<Row>;
}

export interface Dump {
  readonly participation: Table;
  readonly submission: Table;
}

export interface Participant {
  readonly person: string;

  readonly answer: string;
}

export interface Subject<E, R> {
  readonly write: (participant: Participant) => Effect.Effect<void, E, R>;

  readonly dump: Effect.Effect<Dump, E, R>;
}

export type AttackName = "rank" | "keyOrder" | "sharedColumns" | "rowid";

export interface AttackResult {
  readonly attack: AttackName;

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

export const randomHex = (bytes = 16): Effect.Effect<string> =>
  Effect.gen(function* () {
    let hex = "";
    for (let i = 0; i < bytes; i++) {
      hex += (yield* Random.nextIntBetween(0, 255)).toString(16).padStart(2, "0");
    }
    return hex;
  });

export const seededRandomBytes: Effect.Effect<(size: number) => Uint8Array> = Effect.gen(function* () {
  const random = yield* Random.Random;
  return (size) => Uint8Array.from({ length: size }, () => Math.floor(random.nextDoubleUnsafe() * 256));
});

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

const valueKey = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "bigint") return `n:${String(value)}`;
  if (typeof value === "string") return `s:${value}`;
  if (value instanceof Uint8Array)
    return `b:${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return `o:${JSON.stringify(value)}`;
};
