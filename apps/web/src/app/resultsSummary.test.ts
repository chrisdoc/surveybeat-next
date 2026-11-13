import { assert, describe, it } from "@effect/vitest";
import type { DimensionResult, RoundResult } from "@surveybeat/domain";
import { resultsSummary } from "./resultsSummary.ts";

const ready = {
  status: "ready",
  completedUsableRounds: 6,
  totalRequiredUsableRounds: 6,
  typicalChange: 0.2,
} as const;

const dimension = (
  name: DimensionResult["dimension"],
  options: { shown?: boolean; flagged?: "rise" | "drop"; baseline?: boolean } = {},
): DimensionResult => ({
  dimension: name,
  score: options.shown === false ? null : 3.4,
  usableQuestionCount: 1,
  totalQuestionCount: 1,
  contributors: options.shown === false ? null : 7,
  meetsMinimumGroupSize: options.shown !== false,
  change:
    options.flagged === undefined
      ? null
      : {
          change: options.flagged === "rise" ? 0.5 : -0.5,
          previousRoundDate: "2026-10-26",
          previousRoundId: null,
          matchedQuestionCount: 1,
          currentQuestionCount: 1,
          annotation: null,
          highlight: { isLargerThanUsual: true, direction: options.flagged },
        },
  typicalChange:
    options.baseline === true ? { ...ready, status: "buildingBaseline", completedUsableRounds: 3 } : ready,
  trend: [],
});

const result = (overrides: Partial<RoundResult>): RoundResult =>
  ({
    roundId: "round-1",
    pulseId: "pulse-1",
    teamId: "team-1",
    status: "closed",
    plannedOpenDate: "2026-11-02",
    anonymityMode: "anonymous",
    closedAt: 1000,
    effectiveMinimumGroupSize: 4,
    meetsMinimumGroupSize: true,
    eligibleMembersCount: 9,
    submissionsCount: 7,
    responseRate: 7 / 9,
    delayed: false,
    questions: [],
    dimensions: [],
    comments: [],
    ...overrides,
  }) as RoundResult;

describe("resultsSummary", () => {
  it("says nothing while the Round is open or its Results are delayed", () => {
    assert.isNull(resultsSummary(result({ status: "open" })));
    assert.isNull(resultsSummary(result({ delayed: true })));
  });

  it("names a Dimension that changed more than usual and says the rest held steady", () => {
    const summary = resultsSummary(
      result({
        dimensions: [
          dimension("workload", { flagged: "drop" }),
          dimension("clarity"),
          dimension("recognition"),
        ],
      }),
    );
    assert.strictEqual(
      summary,
      "7 of 9 people checked in. Workload dropped more than usual; everything else held steady.",
    );
  });

  it("joins several changes and drops the rest clause when every judged Dimension changed", () => {
    const summary = resultsSummary(
      result({
        dimensions: [
          dimension("workload", { flagged: "drop" }),
          dimension("recognition", { flagged: "rise" }),
        ],
      }),
    );
    assert.strictEqual(
      summary,
      "7 of 9 people checked in. Workload dropped more than usual and Recognition rose more than usual.",
    );
  });

  it("says nothing changed when no shown Dimension is flagged", () => {
    assert.strictEqual(
      resultsSummary(result({ dimensions: [dimension("workload"), dimension("clarity")] })),
      "7 of 9 people checked in. Nothing changed more than usual for this Team.",
    );
  });

  it("says the baseline is still being built before any change can be judged", () => {
    assert.strictEqual(
      resultsSummary(result({ dimensions: [dimension("workload", { baseline: true })] })),
      "7 of 9 people checked in. This Team is still building its baseline, so no change is judged yet.",
    );
  });

  it("never names a Dimension below the minimum group size", () => {
    const hidden = { ...dimension("workload", { flagged: "drop" }), meetsMinimumGroupSize: false };
    const summary = resultsSummary(result({ dimensions: [hidden, dimension("clarity")] }));
    assert.notInclude(summary ?? "", "Workload");
    assert.strictEqual(summary, "7 of 9 people checked in. Nothing changed more than usual for this Team.");
  });

  it("below the minimum, gives only the count and why nothing is shown", () => {
    assert.strictEqual(
      resultsSummary(
        result({
          meetsMinimumGroupSize: false,
          submissionsCount: 3,
          dimensions: [dimension("workload", { flagged: "drop" })],
        }),
      ),
      "3 of 9 people checked in. That's fewer than 4, so no Results are shown.",
    );
  });
});
