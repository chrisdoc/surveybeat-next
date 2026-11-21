import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import type { QuestionType } from "../pulses/Question.ts";
import { QuestionVersionId } from "../pulses/Question.ts";
import {
  calculateRoundResult,
  delayedRoundResult,
  enforceEffectiveNOnResult,
  evaluateHighlight,
  median,
  RoundResult,
} from "./Results.ts";
import type { HistoricalRoundData } from "./Results.ts";
import { RoundId } from "./Round.ts";
import type { SubmissionAnswer } from "./Submission.ts";
import { PULSE_ID, Q1, Q2, Q3_CHOICE, ROUND_1, TEAM_ID, testQuestions } from "./resultsTestData.ts";

describe("median calculation", () => {
  it("calculates median for odd and even arrays", () => {
    assert.strictEqual(median([0.1, 0.2, 0.1, 0.15, 0.2]), 0.15);
    assert.strictEqual(median([1, 2, 3]), 2);
    assert.strictEqual(median([1, 2, 3, 4]), 2.5);
    assert.strictEqual(median([]), 0);
  });
});

describe("Typical change and highlights (Issue #4)", () => {
  it("highlights when |change| >= 2 * typical and >= 0.3", () => {
    // 5 past changes: 0.1, 0.2, 0.1, 0.15, 0.2 -> median 0.15
    const pastDiffs = [0.1, 0.2, 0.1, 0.15, 0.2];
    const typical = median(pastDiffs);
    assert.strictEqual(typical, 0.15);

    // change of -0.35: |-0.35| = 0.35 >= 2*0.15 (0.30) and >= 0.3 -> highlighted
    const h1 = evaluateHighlight(-0.35, typical);
    assert.isTrue(h1.isLargerThanUsual);
    assert.strictEqual(h1.direction, "drop");

    // change of -0.25: |-0.25| = 0.25 < 0.30 -> not highlighted
    const h2 = evaluateHighlight(-0.25, typical);
    assert.isFalse(h2.isLargerThanUsual);
  });

  it("enforces floor of 0.3 for stable teams with 0.0 typical change", () => {
    // Team whose past changes are all 0.0 (typical = 0.0)
    const typical = median([0, 0, 0, 0, 0]);
    assert.strictEqual(typical, 0);

    // Change of 0.2 is not highlighted because 0.2 < 0.3 floor
    const h = evaluateHighlight(0.2, typical);
    assert.isFalse(h.isLargerThanUsual);

    // Change of 0.3 is highlighted because 0.3 >= 0.0 and 0.3 >= 0.3
    const hPass = evaluateHighlight(0.3, typical);
    assert.isTrue(hPass.isLargerThanUsual);
    assert.strictEqual(hPass.direction, "rise");
  });
});

describe("12-Round history, trends, warm-up, and gap handling (Issue #4)", () => {
  it("building baseline warm-up note when fewer than 6 usable rounds exist", () => {
    // 3 usable past rounds
    const history: HistoricalRoundData[] = [];

    for (let i = 1; i <= 3; i++) {
      history.push({
        roundId: RoundId.make(`past-${i}`),
        plannedOpenDate: `2026-10-0${i}`,
        closedAt: 1_730_000_000_000 + i * 86_400_000,
        effectiveMinimumGroupSize: 4,
        submissionsCount: 5,
        questions: [
          {
            questionVersionId: Q1,
            score: 3.5,
            contributors: 5,
            meetsMinimumGroupSize: true,
          },
        ],
        dimensions: [
          {
            dimension: "workload",
            score: 3.5,
            usableQuestionCount: 1,
            meetsMinimumGroupSize: true,
          },
        ],
      });
    }

    const submissions: { id: string; answers: SubmissionAnswer[] }[] = [
      { id: "s1", answers: [{ questionVersionId: Q1, value: 4, comment: null }] },
      { id: "s2", answers: [{ questionVersionId: Q1, value: 4, comment: null }] },
      { id: "s3", answers: [{ questionVersionId: Q1, value: 4, comment: null }] },
      { id: "s4", answers: [{ questionVersionId: Q1, value: 4, comment: null }] },
    ];

    const result = calculateRoundResult({
      roundId: ROUND_1,
      pulseId: PULSE_ID,
      teamId: TEAM_ID,
      status: "closed",
      plannedOpenDate: "2026-11-02",
      anonymityMode: "anonymous",
      closedAt: 1_730_592_000_000,
      effectiveMinimumGroupSize: 4,
      eligibleMembersCount: 6,
      questions: testQuestions,
      submissions,
      pastRoundsHistory: history,
    });

    const q1Res = result.questions.find((q) => q.questionVersionId === Q1);
    assert.strictEqual(q1Res?.typicalChange?.status, "buildingBaseline");
    assert.strictEqual(q1Res?.typicalChange?.completedUsableRounds, 3);
    assert.strictEqual(q1Res?.typicalChange?.totalRequiredUsableRounds, 6);
    // Change since last usable round is computed and labeled with its date
    assert.strictEqual(q1Res?.change?.change, 0.5); // 4.0 - 3.5
    assert.strictEqual(q1Res?.change?.previousRoundDate, "2026-10-03");
    // But no highlight during warm-up!
    assert.isNull(q1Res?.change?.highlight);
  });

  it("gaps in history: sub-N round does not bridge, produces 1 pair across gap", () => {
    // 6 usable rounds with 1 sub-N round in the middle
    // Round 1 (3.0), Round 2 (sub-N gap), Round 3 (3.2), Round 4 (3.3), Round 5 (3.4), Round 6 (3.5), Round 7 (3.6)
    const history: HistoricalRoundData[] = [
      {
        roundId: RoundId.make("r-1"),
        plannedOpenDate: "2026-09-01",
        closedAt: 100,
        effectiveMinimumGroupSize: 4,
        submissionsCount: 4,
        questions: [{ questionVersionId: Q1, score: 3, contributors: 4, meetsMinimumGroupSize: true }],
        dimensions: [
          { dimension: "workload", score: 3, usableQuestionCount: 1, meetsMinimumGroupSize: true },
        ],
      },
      {
        roundId: RoundId.make("r-2"),
        plannedOpenDate: "2026-09-08",
        closedAt: 200,
        effectiveMinimumGroupSize: 4,
        submissionsCount: 2, // sub-N GAP!
        questions: [{ questionVersionId: Q1, score: null, contributors: 2, meetsMinimumGroupSize: false }],
        dimensions: [
          { dimension: "workload", score: null, usableQuestionCount: 0, meetsMinimumGroupSize: false },
        ],
      },
      {
        roundId: RoundId.make("r-3"),
        plannedOpenDate: "2026-09-15",
        closedAt: 300,
        effectiveMinimumGroupSize: 4,
        submissionsCount: 4,
        questions: [{ questionVersionId: Q1, score: 3.2, contributors: 4, meetsMinimumGroupSize: true }],
        dimensions: [
          { dimension: "workload", score: 3.2, usableQuestionCount: 1, meetsMinimumGroupSize: true },
        ],
      },
      {
        roundId: RoundId.make("r-4"),
        plannedOpenDate: "2026-09-22",
        closedAt: 400,
        effectiveMinimumGroupSize: 4,
        submissionsCount: 4,
        questions: [{ questionVersionId: Q1, score: 3.3, contributors: 4, meetsMinimumGroupSize: true }],
        dimensions: [
          { dimension: "workload", score: 3.3, usableQuestionCount: 1, meetsMinimumGroupSize: true },
        ],
      },
      {
        roundId: RoundId.make("r-5"),
        plannedOpenDate: "2026-09-29",
        closedAt: 500,
        effectiveMinimumGroupSize: 4,
        submissionsCount: 4,
        questions: [{ questionVersionId: Q1, score: 3.4, contributors: 4, meetsMinimumGroupSize: true }],
        dimensions: [
          { dimension: "workload", score: 3.4, usableQuestionCount: 1, meetsMinimumGroupSize: true },
        ],
      },
      {
        roundId: RoundId.make("r-6"),
        plannedOpenDate: "2026-10-06",
        closedAt: 600,
        effectiveMinimumGroupSize: 4,
        submissionsCount: 4,
        questions: [{ questionVersionId: Q1, score: 3.5, contributors: 4, meetsMinimumGroupSize: true }],
        dimensions: [
          { dimension: "workload", score: 3.5, usableQuestionCount: 1, meetsMinimumGroupSize: true },
        ],
      },
      {
        roundId: RoundId.make("r-7"),
        plannedOpenDate: "2026-10-13",
        closedAt: 700,
        effectiveMinimumGroupSize: 4,
        submissionsCount: 4,
        questions: [{ questionVersionId: Q1, score: 3.6, contributors: 4, meetsMinimumGroupSize: true }],
        dimensions: [
          { dimension: "workload", score: 3.6, usableQuestionCount: 1, meetsMinimumGroupSize: true },
        ],
      },
    ];

    // Current round has score 4.2
    const submissions = [
      { id: "s1", answers: [{ questionVersionId: Q1, value: 4, comment: null }] },
      { id: "s2", answers: [{ questionVersionId: Q1, value: 4, comment: null }] },
      { id: "s3", answers: [{ questionVersionId: Q1, value: 5, comment: null }] },
      { id: "s4", answers: [{ questionVersionId: Q1, value: 4, comment: null }] },
    ];

    const result = calculateRoundResult({
      roundId: ROUND_1,
      pulseId: PULSE_ID,
      teamId: TEAM_ID,
      status: "closed",
      plannedOpenDate: "2026-10-20",
      anonymityMode: "anonymous",
      closedAt: 800,
      effectiveMinimumGroupSize: 4,
      eligibleMembersCount: 5,
      questions: testQuestions,
      submissions,
      pastRoundsHistory: history,
    });

    const q1Res = result.questions.find((q) => q.questionVersionId === Q1);
    assert.strictEqual(q1Res?.typicalChange?.status, "ready");
    // Usable rounds before current: r1, r3, r4, r5, r6, r7 (6 usable rounds!).
    // Consecutive pairs skipping gap:
    // (r1, r3): |3.2 - 3.0| = 0.2
    // (r3, r4): |3.3 - 3.2| = 0.1
    // (r4, r5): |3.4 - 3.3| = 0.1
    // (r5, r6): |3.5 - 3.4| = 0.1
    // (r6, r7): |3.6 - 3.5| = 0.1
    // Diffs: [0.2, 0.1, 0.1, 0.1, 0.1] -> median is 0.1!
    assert.strictEqual(q1Res?.typicalChange?.typicalChange, 0.1);

    // Current change: 4.25 - 3.6 = +0.65
    assert.strictEqual(q1Res?.change?.change, 0.65);
    // 0.65 >= 2 * 0.1 (0.2) AND >= 0.3 -> highlighted rise!
    assert.isTrue(q1Res?.change?.highlight?.isLargerThanUsual);
    assert.strictEqual(q1Res?.change?.highlight?.direction, "rise");

    // Trend points check: gap on r-2 is marked
    const trendPt2 = q1Res?.trend.find((tp) => tp.roundId === "r-2");
    assert.isTrue(trendPt2?.hasGap);
    assert.isNull(trendPt2?.score);
  });

  it("Dimension change matches per-Question subset: 'Based on 1 of 2 questions'", () => {
    // Previous round had usable Q1 (score 3.0) and Q2 (score 2.0).
    // Current round has usable Q1 (score 4.0), but Q2 is below N (only 2 answers).
    const history: HistoricalRoundData[] = [
      {
        roundId: RoundId.make("r-prev"),
        plannedOpenDate: "2026-10-01",
        closedAt: 100,
        effectiveMinimumGroupSize: 4,
        submissionsCount: 5,
        questions: [
          { questionVersionId: Q1, score: 3, contributors: 5, meetsMinimumGroupSize: true },
          { questionVersionId: Q2, score: 2, contributors: 5, meetsMinimumGroupSize: true },
        ],
        dimensions: [
          { dimension: "workload", score: 2.5, usableQuestionCount: 2, meetsMinimumGroupSize: true },
        ],
      },
    ];

    // Current round: 5 submissions, all 5 answer Q1, only 2 answer Q2
    const submissions: { id: string; answers: SubmissionAnswer[] }[] = [];

    for (let i = 1; i <= 5; i++) {
      const answers: SubmissionAnswer[] = [{ questionVersionId: Q1, value: 4, comment: null }];

      if (i <= 2) {
        answers.push({ questionVersionId: Q2, value: 3, comment: null });
      }

      submissions.push({ id: `sub-${i}`, answers });
    }

    const result = calculateRoundResult({
      roundId: ROUND_1,
      pulseId: PULSE_ID,
      teamId: TEAM_ID,
      status: "closed",
      plannedOpenDate: "2026-10-08",
      anonymityMode: "anonymous",
      closedAt: 200,
      effectiveMinimumGroupSize: 4,
      eligibleMembersCount: 6,
      questions: testQuestions,
      submissions,
      pastRoundsHistory: history,
    });

    const dim = result.dimensions.find((d) => d.dimension === "workload");
    assert.isDefined(dim);
    // Common usable questions in both rounds: Q1 only (matchedCount = 1).
    // Q1 changed from 3.0 to 4.0 (+1.0).
    assert.strictEqual(dim?.change?.change, 1);
    assert.strictEqual(dim?.change?.matchedQuestionCount, 1);
    assert.strictEqual(dim?.change?.currentQuestionCount, 2);
    assert.strictEqual(dim?.change?.annotation, "Based on 1 of 2 questions");
  });
});

describe("RoundResult anonymity mode (issue #79)", () => {
  it("decodes a Result stored before the field existed as anonymous", () => {
    const stored = {
      roundId: "round-1",
      pulseId: "pulse-1",
      teamId: "team-1",
      status: "closed",
      plannedOpenDate: "2026-11-02",
      closedAt: 1000,
      effectiveMinimumGroupSize: 4,
      meetsMinimumGroupSize: true,
      eligibleMembersCount: 9,
      submissionsCount: 7,
      responseRate: 0.78,
      delayed: false,
      questions: [],
      dimensions: [],
      comments: [],
    };

    const decoded = Schema.decodeUnknownSync(RoundResult)(stored);
    assert.strictEqual(decoded.anonymityMode, "anonymous");
  });

  it("refuses an anonymity mode Release 1 does not know", () => {
    assert.throws(() => {
      Schema.decodeUnknownSync(RoundResult)({
        roundId: "round-1",
        pulseId: "pulse-1",
        teamId: "team-1",
        status: "closed",
        plannedOpenDate: "2026-11-02",
        anonymityMode: "confidential",
        closedAt: 1000,
        effectiveMinimumGroupSize: 4,
        meetsMinimumGroupSize: true,
        eligibleMembersCount: 9,
        submissionsCount: 7,
        responseRate: 0.78,
        delayed: false,
        questions: [],
        dimensions: [],
        comments: [],
      });
    });
  });
});

describe("delayedRoundResult: the stand-in for a Result that is not computed (Issue #128)", () => {
  const params = {
    roundId: ROUND_1,
    pulseId: PULSE_ID,
    teamId: TEAM_ID,
    status: "closed" as const,
    plannedOpenDate: "2026-11-09",
    anonymityMode: "anonymous" as const,
    closedAt: 1_731_140_000_000,
    effectiveMinimumGroupSize: 3,
    eligibleMembersCount: 8,
  };

  it("carries the counts and the response rate, and is delayed", () => {
    const result = delayedRoundResult({ ...params, submissionsCount: 6 });
    assert.strictEqual(result.roundId, ROUND_1);
    assert.strictEqual(result.status, "closed");
    assert.strictEqual(result.closedAt, 1_731_140_000_000);
    assert.strictEqual(result.effectiveMinimumGroupSize, 3);
    assert.strictEqual(result.submissionsCount, 6);
    assert.strictEqual(result.eligibleMembersCount, 8);
    assert.strictEqual(result.responseRate, 0.75);
    assert.strictEqual(result.meetsMinimumGroupSize, true);
    assert.strictEqual(result.delayed, true);
  });

  it("holds no scores, questions, dimensions or comments", () => {
    const result = delayedRoundResult({ ...params, submissionsCount: 6 });
    assert.deepStrictEqual(result.questions, []);
    assert.deepStrictEqual(result.dimensions, []);
    assert.deepStrictEqual(result.comments, []);
  });

  it("does not meet N below the group size, and has no response rate without eligible members", () => {
    const below = delayedRoundResult({ ...params, submissionsCount: 2 });
    assert.strictEqual(below.meetsMinimumGroupSize, false);
    const none = delayedRoundResult({ ...params, eligibleMembersCount: 0, submissionsCount: 0 });
    assert.strictEqual(none.responseRate, null);
  });
});

describe("Raised Organization N hides a past Round's Dimension (ADR 0004)", () => {
  const past = (
    id: string,
    dimensionContributors: number | undefined,
    submissionsCount: number,
    contributors: number,
  ): HistoricalRoundData => ({
    roundId: RoundId.make(id),
    plannedOpenDate: `2026-10-0${id.slice(-1)}`,
    closedAt: 1_730_000_000_000,
    effectiveMinimumGroupSize: 4,
    submissionsCount,
    questions: [{ questionVersionId: Q1, score: 3, contributors, meetsMinimumGroupSize: true }],
    dimensions: [
      {
        dimension: "workload",
        score: 3,
        usableQuestionCount: 1,
        ...(dimensionContributors === undefined ? {} : { contributors: dimensionContributors }),
        meetsMinimumGroupSize: true,
      },
    ],
  });

  const compute = (pastRoundsHistory: HistoricalRoundData[], effectiveN: number) =>
    calculateRoundResult({
      roundId: ROUND_1,
      pulseId: PULSE_ID,
      teamId: TEAM_ID,
      status: "closed",
      plannedOpenDate: "2026-11-02",
      anonymityMode: "anonymous",
      closedAt: 1_730_592_000_000,
      effectiveMinimumGroupSize: effectiveN,
      eligibleMembersCount: 10,
      questions: testQuestions,
      submissions: Array.from({ length: 6 }, (_, i) => ({
        id: `s${i}`,
        answers: [{ questionVersionId: Q1, value: 4, comment: null }],
      })),
      pastRoundsHistory,
    });

  const workloadTrend = (result: ReturnType<typeof calculateRoundResult>) =>
    result.dimensions.find((d) => d.dimension === "workload")?.trend.map((p) => p.score);

  it("keeps a past score only when its Submissions, its contributors and every Question it averaged meet the raised N", () => {
    const result = compute(
      [past("past-1", 6, 6, 6), past("past-2", 5, 5, 5), past("past-3", 6, 6, 5), past("past-4", 5, 6, 5)],
      6,
    );

    assert.deepStrictEqual(workloadTrend(result), [3, null, null, null, 4]);
  });

  it("takes a past Dimension's contributors from its largest Question count when the stored count is absent", () => {
    const result = compute([past("past-1", undefined, 5, 5)], 4);

    const point = result.dimensions.find((d) => d.dimension === "workload")?.trend[0];
    assert.strictEqual(point?.score, 3);
    assert.strictEqual(point?.contributors, 5);
  });
});

describe("Raised N reports a lower-bound contributor count after the usable set shrinks", () => {
  it("uses the largest remaining Question count, never the old distinct count", () => {
    const result = calculateRoundResult({
      roundId: ROUND_1,
      pulseId: PULSE_ID,
      teamId: TEAM_ID,
      status: "closed",
      plannedOpenDate: "2026-11-02",
      anonymityMode: "anonymous",
      closedAt: 1_730_592_000_000,
      effectiveMinimumGroupSize: 4,
      eligibleMembersCount: 12,
      questions: testQuestions,
      submissions: [
        ...Array.from({ length: 4 }, (_, i) => ({
          id: `q1-${i}`,
          answers: [{ questionVersionId: Q1, value: 4, comment: null }],
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `q2-${i}`,
          answers: [{ questionVersionId: Q2, value: 2, comment: null }],
        })),
      ],
      pastRoundsHistory: [],
    });

    const before = result.dimensions.find((d) => d.dimension === "workload");
    assert.strictEqual(before?.usableQuestionCount, 2);
    assert.strictEqual(before?.contributors, 9);

    const masked = enforceEffectiveNOnResult(result, 5);
    const after = masked.dimensions.find((d) => d.dimension === "workload");
    assert.strictEqual(after?.usableQuestionCount, 1);
    assert.strictEqual(after?.contributors, 5);
    assert.isAtLeast(after?.contributors ?? 0, masked.effectiveMinimumGroupSize);
  });
});

describe("Trend is only derived for Rating Questions (Issue #265)", () => {
  const LONG_TEXT = QuestionVersionId.make("q-4.1");
  const longTextType: QuestionType = { _tag: "LongText" };

  it("gives a SingleChoice and a LongText Question an empty trend while a Rating Question keeps one", () => {
    const result = calculateRoundResult({
      roundId: ROUND_1,
      pulseId: PULSE_ID,
      teamId: TEAM_ID,
      status: "closed",
      plannedOpenDate: "2026-11-02",
      anonymityMode: "anonymous",
      closedAt: 1_730_592_000_000,
      effectiveMinimumGroupSize: 4,
      eligibleMembersCount: 10,
      questions: [
        ...testQuestions,
        { id: LONG_TEXT, position: 3, text: "Question 4 Long text", type: longTextType, dimension: null },
      ],
      submissions: Array.from({ length: 5 }, (_, i) => ({
        id: `s${i}`,
        answers: [
          { questionVersionId: Q1, value: 4, comment: null },
          { questionVersionId: Q3_CHOICE, value: 1, comment: null },
          { questionVersionId: LONG_TEXT, value: null, comment: "Some words" },
        ],
      })),
      pastRoundsHistory: [],
    });

    const rating = result.questions.find((q) => q.questionVersionId === Q1);
    const choice = result.questions.find((q) => q.questionVersionId === Q3_CHOICE);
    const longText = result.questions.find((q) => q.questionVersionId === LONG_TEXT);
    assert.isTrue((rating?.trend.length ?? 0) > 0);
    assert.deepStrictEqual(choice?.trend, []);
    assert.deepStrictEqual(longText?.trend, []);
  });
});
