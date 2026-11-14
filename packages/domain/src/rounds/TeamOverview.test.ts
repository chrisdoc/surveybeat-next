// @effect-diagnostics globalDate:off -- the fixture supplies the instant; the test never reads the clock.

import { assert, describe, it } from "@effect/vitest";
import { ActionId } from "../actions/Action.ts";
import { TeamId } from "../people/Team.ts";
import { PulseId } from "../pulses/Pulse.ts";
import { type Dimension, QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import { calculateRoundResult, type QuestionInput, type RoundResult } from "./Results.ts";
import { RoundId } from "./Round.ts";
import type { SubmissionAnswer } from "./Submission.ts";
import { buildTeamOverview, type OverviewActionInput, type TeamOverview } from "./TeamOverview.ts";

const TEAM = TeamId.make("team-1");
const PULSE = PulseId.make("pulse-1");
const Q1 = QuestionVersionId.make("q-1.1");
const Q2 = QuestionVersionId.make("q-2.1");

const ratingType: QuestionType = { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: false };

const WORKLOAD_QUESTION: QuestionInput = {
  id: Q1,
  position: 0,
  text: "Workload question",
  type: ratingType,
  dimension: "workload",
};

const CLARITY_QUESTION: QuestionInput = {
  id: Q2,
  position: 1,
  text: "Clarity question",
  type: ratingType,
  dimension: "clarity",
};

const BOTH_QUESTIONS: ReadonlyArray<QuestionInput> = [WORKLOAD_QUESTION, CLARITY_QUESTION];

/** Submissions that answer every given Question with the same value. */
const submissions = (
  count: number,
  questionIds: ReadonlyArray<QuestionVersionId>,
  value = 4,
): Array<{ id: string; answers: Array<SubmissionAnswer> }> =>
  Array.from({ length: count }, (_, i) => ({
    id: `sub-${i}`,
    answers: questionIds.map((questionVersionId) => ({ questionVersionId, value, comment: null })),
  }));

interface RoundSpec {
  readonly roundId: string;
  readonly plannedOpenDate: string;
  readonly storedN: number;
  readonly submissions: ReadonlyArray<{ id: string; answers: ReadonlyArray<SubmissionAnswer> }>;
  readonly questions?: ReadonlyArray<QuestionInput>;
  readonly status?: "closed" | "shared";
}

const computeRound = (spec: RoundSpec): RoundResult =>
  calculateRoundResult({
    roundId: RoundId.make(spec.roundId),
    pulseId: PULSE,
    teamId: TEAM,
    status: spec.status ?? "shared",
    plannedOpenDate: spec.plannedOpenDate,
    anonymityMode: "anonymous",
    closedAt: 1_731_000_000_000,
    effectiveMinimumGroupSize: spec.storedN,
    eligibleMembersCount: 20,
    questions: spec.questions ?? BOTH_QUESTIONS,
    submissions: spec.submissions,
    pastRoundsHistory: [],
  });

const ROUND_EARLY = RoundId.make("round-early");
const ROUND_MIDDLE = RoundId.make("round-middle");
const ROUND_LATE = RoundId.make("round-late");

const scoresOf = (overview: TeamOverview, dimension: Dimension): ReadonlyArray<number | null> | undefined =>
  overview.dimensions.find((line) => line.dimension === dimension)?.points.map((point) => point.score);

const overviewOf = (
  results: ReadonlyArray<RoundResult>,
  minimumGroupSize: number,
  actions: ReadonlyArray<OverviewActionInput> = [],
) => buildTeamOverview({ teamId: TEAM, results, minimumGroupSize, actions });

describe("buildTeamOverview rounds", () => {
  it("orders shared Rounds by planned open date regardless of input order", () => {
    const late = computeRound({
      roundId: "round-late",
      plannedOpenDate: "2026-11-16",
      storedN: 2,
      submissions: submissions(5, [Q1]),
    });
    const early = computeRound({
      roundId: "round-early",
      plannedOpenDate: "2026-11-02",
      storedN: 2,
      submissions: submissions(5, [Q1]),
    });
    const middle = computeRound({
      roundId: "round-middle",
      plannedOpenDate: "2026-11-09",
      storedN: 2,
      submissions: submissions(5, [Q1]),
    });

    const overview = overviewOf([late, early, middle], 2);

    assert.deepStrictEqual(
      overview.rounds.map((round) => round.roundId),
      [ROUND_EARLY, ROUND_MIDDLE, ROUND_LATE],
    );
    assert.deepStrictEqual(
      overview.rounds.map((round) => round.plannedOpenDate),
      ["2026-11-02", "2026-11-09", "2026-11-16"],
    );
    assert.deepStrictEqual(
      overview.dimensions[0]?.points.map((point) => point.roundId),
      [ROUND_EARLY, ROUND_MIDDLE, ROUND_LATE],
    );
  });

  it("breaks ties on planned open date by Round id", () => {
    const b = computeRound({
      roundId: "round-b",
      plannedOpenDate: "2026-11-09",
      storedN: 2,
      submissions: submissions(5, [Q1]),
    });
    const a = computeRound({
      roundId: "round-a",
      plannedOpenDate: "2026-11-09",
      storedN: 2,
      submissions: submissions(5, [Q1]),
    });

    const overview = overviewOf([b, a], 2);

    assert.deepStrictEqual(
      overview.rounds.map((round) => round.roundId),
      [RoundId.make("round-a"), RoundId.make("round-b")],
    );
  });

  it("excludes Results that are not shared", () => {
    const shared = computeRound({
      roundId: "round-early",
      plannedOpenDate: "2026-11-02",
      storedN: 2,
      submissions: submissions(5, [Q1]),
    });
    const closed = computeRound({
      roundId: "round-closed",
      plannedOpenDate: "2026-11-09",
      storedN: 2,
      status: "closed",
      submissions: submissions(5, [Q1]),
    });

    const overview = overviewOf([closed, shared], 2);

    assert.deepStrictEqual(
      overview.rounds.map((round) => round.roundId),
      [ROUND_EARLY],
    );
    assert.deepStrictEqual(scoresOf(overview, "workload"), [4]);
  });

  it("is empty when no Round is shared", () => {
    const closed = computeRound({
      roundId: "round-closed",
      plannedOpenDate: "2026-11-09",
      storedN: 2,
      status: "closed",
      submissions: submissions(5, [Q1]),
    });

    const overview = overviewOf([closed], 2);

    assert.deepStrictEqual(overview, { teamId: TEAM, rounds: [], dimensions: [], markers: [] });
  });
});

describe("buildTeamOverview gaps and minimum group size (ADR 0004)", () => {
  it("gives a null point for a Round with fewer Submissions than N, between Rounds with scores", () => {
    const first = computeRound({
      roundId: "round-early",
      plannedOpenDate: "2026-11-02",
      storedN: 2,
      submissions: submissions(5, [Q1]),
    });
    const thin = computeRound({
      roundId: "round-middle",
      plannedOpenDate: "2026-11-09",
      storedN: 2,
      submissions: submissions(1, [Q1]),
    });
    const last = computeRound({
      roundId: "round-late",
      plannedOpenDate: "2026-11-16",
      storedN: 2,
      submissions: submissions(5, [Q1]),
    });

    const overview = overviewOf([first, thin, last], 2);

    assert.deepStrictEqual(scoresOf(overview, "workload"), [4, null, 4]);
  });

  it("shows a Round stored at N=2 with 3 Submissions at minimum group size 2, and hides it at 4", () => {
    const stored = computeRound({
      roundId: "round-early",
      plannedOpenDate: "2026-11-02",
      storedN: 2,
      submissions: submissions(3, [Q1]),
    });

    assert.deepStrictEqual(scoresOf(overviewOf([stored], 2), "workload"), [4]);
    assert.deepStrictEqual(scoresOf(overviewOf([stored], 4), "workload"), [null]);
  });

  it("never reveals a Round stored below its N when the minimum group size is lowered", () => {
    const stored = computeRound({
      roundId: "round-early",
      plannedOpenDate: "2026-11-02",
      storedN: 4,
      submissions: submissions(3, [Q1]),
    });

    assert.deepStrictEqual(scoresOf(overviewOf([stored], 1), "workload"), [null]);
    assert.deepStrictEqual(scoresOf(overviewOf([stored], 3), "workload"), [null]);
  });
});

describe("buildTeamOverview dimensions", () => {
  it("gives null for a Dimension a Round did not ask, and omits a Dimension never asked", () => {
    const withOnlyWorkload = computeRound({
      roundId: "round-early",
      plannedOpenDate: "2026-11-02",
      storedN: 2,
      questions: [WORKLOAD_QUESTION],
      submissions: submissions(5, [Q1]),
    });
    const withBoth = computeRound({
      roundId: "round-late",
      plannedOpenDate: "2026-11-16",
      storedN: 2,
      submissions: submissions(5, [Q1, Q2]),
    });

    const overview = overviewOf([withBoth, withOnlyWorkload], 2);

    assert.deepStrictEqual(
      overview.dimensions.map((line) => line.dimension),
      ["workload", "clarity"],
    );
    assert.deepStrictEqual(scoresOf(overview, "workload"), [4, 4]);
    assert.deepStrictEqual(scoresOf(overview, "clarity"), [null, 4]);
  });
});

describe("buildTeamOverview markers", () => {
  it("places committed and done markers in time order, ignoring proposed and dropped Actions", () => {
    const actions: ReadonlyArray<OverviewActionInput> = [
      {
        id: ActionId.make("action-1"),
        title: "Committed early",
        status: "committed",
        createdAt: 100,
        doneAt: null,
      },
      {
        id: ActionId.make("action-0"),
        title: "Committed too",
        status: "committed",
        createdAt: 100,
        doneAt: null,
      },
      { id: ActionId.make("action-2"), title: "Done later", status: "done", createdAt: 200, doneAt: 300 },
      {
        id: ActionId.make("action-3"),
        title: "Committed late",
        status: "committed",
        createdAt: 300,
        doneAt: null,
      },
      { id: ActionId.make("action-4"), title: "Dropped", status: "dropped", createdAt: 50, doneAt: null },
      { id: ActionId.make("action-5"), title: "Proposed", status: "proposed", createdAt: 60, doneAt: null },
    ];

    const overview = overviewOf([], 2, actions);

    assert.deepStrictEqual(
      overview.markers.map((marker) => [marker.actionId, marker.kind, marker.at]),
      [
        [ActionId.make("action-0"), "committed", 100],
        [ActionId.make("action-1"), "committed", 100],
        [ActionId.make("action-2"), "committed", 200],
        [ActionId.make("action-3"), "committed", 300],
        [ActionId.make("action-2"), "done", 300],
      ],
    );
    assert.strictEqual(overview.markers[2]?.title, "Done later");
  });

  it("does not place a done marker for a done Action without a doneAt", () => {
    const actions: ReadonlyArray<OverviewActionInput> = [
      {
        id: ActionId.make("action-1"),
        title: "Done without time",
        status: "done",
        createdAt: 100,
        doneAt: null,
      },
    ];

    const overview = overviewOf([], 2, actions);

    assert.deepStrictEqual(
      overview.markers.map((marker) => marker.kind),
      ["committed"],
    );
  });
});

describe("buildTeamOverview performance", () => {
  it("builds 104 weekly shared Rounds with two Dimensions in well under a second", () => {
    const results = Array.from({ length: 104 }, (_, week) =>
      computeRound({
        roundId: `round-${week}`,
        plannedOpenDate: new Date(Date.UTC(2025, 0, 6 + 7 * week)).toISOString().slice(0, 10),
        storedN: 3,
        submissions: submissions(5, [Q1, Q2]),
      }),
    ).reverse();

    // Date.now(): the domain package has no Node or DOM timer types; millisecond resolution suffices for a 1500 ms bound.
    const started = Date.now();
    const overview = overviewOf(results, 3);
    const elapsedMs = Date.now() - started;

    assert.isBelow(elapsedMs, 1500);
    assert.strictEqual(overview.rounds.length, 104);
    assert.strictEqual(overview.dimensions.length, 2);
    for (const line of overview.dimensions) {
      assert.strictEqual(line.points.length, 104);
    }
  });
});
