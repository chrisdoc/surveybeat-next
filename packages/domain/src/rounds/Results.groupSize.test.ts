import { assert, describe, it } from "@effect/vitest";
import { calculateRoundResult, enforceEffectiveNOnResult } from "./Results.ts";
import type { HistoricalRoundData } from "./Results.ts";
import { RoundId } from "./Round.ts";
import type { SubmissionAnswer } from "./Submission.ts";
import { PULSE_ID, Q1, Q2, Q3_CHOICE, ROUND_1, TEAM_ID, testQuestions } from "./resultsTestData.ts";

describe("Minimum group size rules R1–R11 (Issue #3 / ADR 0004)", () => {
  it("R1 & R3: Question B with 3 contributors is hidden under N=4, left out of Dimension", () => {
    // 6 Submissions total, but only 3 answer Question 2 (Q2).
    // All 6 answer Question 1 (Q1).
    const submissions: { id: string; answers: SubmissionAnswer[] }[] = [];

    for (let i = 1; i <= 6; i++) {
      const answers: SubmissionAnswer[] = [{ questionVersionId: Q1, value: 4, comment: null }];

      if (i <= 3) {
        answers.push({ questionVersionId: Q2, value: 2, comment: null });
      }

      submissions.push({ id: `sub-${i}`, answers });
    }

    const result = calculateRoundResult({
      roundId: ROUND_1,
      pulseId: PULSE_ID,
      teamId: TEAM_ID,
      status: "closed",
      plannedOpenDate: "2026-11-02",
      anonymityMode: "anonymous",
      closedAt: 1_730_592_000_000,
      effectiveMinimumGroupSize: 4,
      eligibleMembersCount: 8,
      questions: testQuestions,
      submissions,
      pastRoundsHistory: [],
    });

    // Q1 has 6 contributors >= 4: shown
    const q1Res = result.questions.find((q) => q.questionVersionId === Q1);
    assert.isDefined(q1Res);
    assert.isTrue(q1Res?.meetsMinimumGroupSize);
    assert.strictEqual(q1Res?.contributors, 6);
    assert.strictEqual(q1Res?.score, 4);
    assert.isNotNull(q1Res?.distribution);

    // Q2 has 3 contributors < 4: hidden with "Not enough responses"
    const q2Res = result.questions.find((q) => q.questionVersionId === Q2);
    assert.isDefined(q2Res);
    assert.isFalse(q2Res?.meetsMinimumGroupSize);
    assert.strictEqual(q2Res?.contributors, 3);
    assert.isNull(q2Res?.score);
    assert.isNull(q2Res?.distribution);

    // Dimension 'workload' contains Q1 and Q2.
    // Q2 is below N, so Dimension score must use ONLY Q1 (mean 4.0).
    // Nothing on the page allows deriving Q2's score!
    const workloadDim = result.dimensions.find((d) => d.dimension === "workload");
    assert.isDefined(workloadDim);
    assert.isTrue(workloadDim?.meetsMinimumGroupSize);
    assert.strictEqual(workloadDim?.score, 4);
    assert.strictEqual(workloadDim?.usableQuestionCount, 1);
    assert.strictEqual(workloadDim?.totalQuestionCount, 2);
  });

  it("R2: Rating distribution and choice option counts have no per-option minimum when N is met", () => {
    // 4 Submissions (meets N=4)
    // 3 pick option 1, 1 picks option 5, 0 pick 2, 3, 4
    const submissions: { id: string; answers: SubmissionAnswer[] }[] = [
      {
        id: "sub-1",
        answers: [
          { questionVersionId: Q1, value: 1, comment: null },
          { questionVersionId: Q3_CHOICE, value: 0, comment: null },
        ],
      },
      {
        id: "sub-2",
        answers: [
          { questionVersionId: Q1, value: 1, comment: null },
          { questionVersionId: Q3_CHOICE, value: 0, comment: null },
        ],
      },
      {
        id: "sub-3",
        answers: [
          { questionVersionId: Q1, value: 1, comment: null },
          { questionVersionId: Q3_CHOICE, value: 0, comment: null },
        ],
      },
      {
        id: "sub-4",
        answers: [
          { questionVersionId: Q1, value: 5, comment: null },
          { questionVersionId: Q3_CHOICE, value: 1, comment: null },
        ],
      },
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
      eligibleMembersCount: 5,
      questions: testQuestions,
      submissions,
      pastRoundsHistory: [],
    });

    const q1Res = result.questions.find((q) => q.questionVersionId === Q1);
    assert.deepStrictEqual(q1Res?.distribution, [
      { option: 1, count: 3 },
      { option: 2, count: 0 },
      { option: 3, count: 0 },
      { option: 4, count: 0 },
      { option: 5, count: 1 },
    ]);

    const q3Res = result.questions.find((q) => q.questionVersionId === Q3_CHOICE);
    assert.deepStrictEqual(q3Res?.distribution, [
      { option: "Option A", count: 3 },
      { option: "Option B", count: 1 },
      { option: "Option C", count: 0 },
    ]);
  });

  it("R4: Comments shown when Round total submissions >= N, unlinked and randomized", () => {
    // 4 Submissions (meets N=4), 2 comments provided
    const submissions: { id: string; answers: SubmissionAnswer[] }[] = [
      {
        id: "sub-1",
        answers: [{ questionVersionId: Q1, value: 4, comment: "First comment" }],
      },
      {
        id: "sub-2",
        answers: [{ questionVersionId: Q1, value: 3, comment: null }],
      },
      {
        id: "sub-3",
        answers: [{ questionVersionId: Q1, value: 5, comment: "Second comment" }],
      },
      {
        id: "sub-4",
        answers: [{ questionVersionId: Q1, value: 4, comment: null }],
      },
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
      pastRoundsHistory: [],
    });

    assert.strictEqual(result.comments.length, 2);

    // Comments never contain rating value or submission ID
    for (const c of result.comments) {
      assert.isDefined(c.text);
      assert.isDefined(c.questionVersionId);
      // Ensure no submission ID or rating value fields exist
      assert.isUndefined((c as Record<string, unknown>).submissionId);
      assert.isUndefined((c as Record<string, unknown>).value);
      assert.isUndefined((c as Record<string, unknown>).personId);
    }
  });

  it("R7: Zero results while Open, only submission count appears", () => {
    const submissions: { id: string; answers: SubmissionAnswer[] }[] = [
      {
        id: "sub-1",
        answers: [{ questionVersionId: Q1, value: 5, comment: "Secret" }],
      },
      {
        id: "sub-2",
        answers: [{ questionVersionId: Q1, value: 5, comment: null }],
      },
      {
        id: "sub-3",
        answers: [{ questionVersionId: Q1, value: 5, comment: null }],
      },
      {
        id: "sub-4",
        answers: [{ questionVersionId: Q1, value: 5, comment: null }],
      },
      {
        id: "sub-5",
        answers: [{ questionVersionId: Q1, value: 5, comment: null }],
      },
    ];

    const openResult = calculateRoundResult({
      roundId: ROUND_1,
      pulseId: PULSE_ID,
      teamId: TEAM_ID,
      status: "open",
      plannedOpenDate: "2026-11-02",
      anonymityMode: "anonymous",
      closedAt: null,
      effectiveMinimumGroupSize: 4,
      eligibleMembersCount: 10,
      questions: testQuestions,
      submissions,
      pastRoundsHistory: [],
    });

    // Response count is shown
    assert.strictEqual(openResult.submissionsCount, 5);

    // No scores, distributions, or comments while Open!
    for (const q of openResult.questions) {
      assert.isNull(q.score);
      assert.isNull(q.distribution);
      assert.isFalse(q.meetsMinimumGroupSize);
    }

    for (const d of openResult.dimensions) {
      assert.isNull(d.score);
      assert.isFalse(d.meetsMinimumGroupSize);
    }

    assert.strictEqual(openResult.comments.length, 0);
  });

  it("R8: Round with N-1 Submissions closes below N: response rate appears, answers hidden", () => {
    // 3 Submissions under N=4
    const submissions: { id: string; answers: SubmissionAnswer[] }[] = [
      { id: "sub-1", answers: [{ questionVersionId: Q1, value: 5, comment: "Hello" }] },
      { id: "sub-2", answers: [{ questionVersionId: Q1, value: 4, comment: null }] },
      { id: "sub-3", answers: [{ questionVersionId: Q1, value: 3, comment: null }] },
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
      pastRoundsHistory: [],
    });

    assert.isFalse(result.meetsMinimumGroupSize);
    assert.strictEqual(result.submissionsCount, 3);
    assert.strictEqual(result.responseRate, 0.5); // 3 / 6

    // No score, distribution, or comment
    for (const q of result.questions) {
      assert.isNull(q.score);
      assert.isNull(q.distribution);
    }

    for (const d of result.dimensions) {
      assert.isNull(d.score);
    }

    assert.strictEqual(result.comments.length, 0);
  });

  it("R9: Changing N: raising N hides past rounds, lowering N never loosens past rounds", () => {
    // Round with 4 submissions that closed under N=4
    const submissions: { id: string; answers: SubmissionAnswer[] }[] = [
      { id: "sub-1", answers: [{ questionVersionId: Q1, value: 4, comment: null }] },
      { id: "sub-2", answers: [{ questionVersionId: Q1, value: 4, comment: null }] },
      { id: "sub-3", answers: [{ questionVersionId: Q1, value: 4, comment: null }] },
      { id: "sub-4", answers: [{ questionVersionId: Q1, value: 4, comment: "Good job" }] },
    ];

    const originalResult = calculateRoundResult({
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
      pastRoundsHistory: [],
    });

    assert.isTrue(originalResult.meetsMinimumGroupSize);
    assert.strictEqual(originalResult.questions[0]?.score, 4);
    assert.strictEqual(originalResult.comments.length, 1);

    // Raising N to 5: applies immediately, past round with 4 submissions is masked
    const raisedResult = enforceEffectiveNOnResult(originalResult, 5);
    assert.isFalse(raisedResult.meetsMinimumGroupSize);
    assert.isNull(raisedResult.questions[0]?.score);
    assert.isNull(raisedResult.questions[0]?.distribution);
    assert.strictEqual(raisedResult.comments.length, 0);

    // Round that closed under N=5: lowering org N to 4 never reveals it
    const closedUnder5 = calculateRoundResult({
      roundId: ROUND_1,
      pulseId: PULSE_ID,
      teamId: TEAM_ID,
      status: "closed",
      plannedOpenDate: "2026-11-02",
      anonymityMode: "anonymous",
      closedAt: 1_730_592_000_000,
      effectiveMinimumGroupSize: 5,
      eligibleMembersCount: 6,
      questions: testQuestions,
      submissions, // only 4 submissions
      pastRoundsHistory: [],
    });

    assert.isFalse(closedUnder5.meetsMinimumGroupSize);

    // When org N is lowered to 4, effective N remains max(5, 4) = 5
    const loweredResult = enforceEffectiveNOnResult(closedUnder5, 4);
    assert.isFalse(loweredResult.meetsMinimumGroupSize);
    assert.isNull(loweredResult.questions[0]?.score);
    assert.strictEqual(loweredResult.effectiveMinimumGroupSize, 5);
  });
});

describe("Raised Organization N masks derived values (ADR 0004)", () => {
  const history = (contributors: number): HistoricalRoundData[] =>
    [1, 2, 3].map((i) => ({
      roundId: RoundId.make(`past-${i}`),
      plannedOpenDate: `2026-10-0${i}`,
      closedAt: 1_730_000_000_000 + i * 86_400_000,
      effectiveMinimumGroupSize: 4,
      submissionsCount: contributors,
      questions: [{ questionVersionId: Q1, score: 2 + i * 0.5, contributors, meetsMinimumGroupSize: true }],
      dimensions: [
        {
          dimension: "workload" as const,
          score: 2 + i * 0.5,
          usableQuestionCount: 1,
          contributors,
          meetsMinimumGroupSize: true,
        },
      ],
    }));

  const compute = (submissionCount: number, past: HistoricalRoundData[]) =>
    calculateRoundResult({
      roundId: ROUND_1,
      pulseId: PULSE_ID,
      teamId: TEAM_ID,
      status: "closed",
      plannedOpenDate: "2026-11-02",
      anonymityMode: "anonymous",
      closedAt: 1_730_592_000_000,
      effectiveMinimumGroupSize: 4,
      eligibleMembersCount: 10,
      questions: testQuestions,
      submissions: Array.from({ length: submissionCount }, (_, i) => ({
        id: `s${i}`,
        answers: [{ questionVersionId: Q1, value: 4, comment: null }],
      })),
      pastRoundsHistory: past,
    });

  it("reports dimension contributors and hides them with the dimension", () => {
    const result = compute(5, history(5));
    const dim = result.dimensions.find((d) => d.dimension === "workload");
    assert.strictEqual(dim?.contributors, 5);
    const masked = enforceEffectiveNOnResult(result, 6);
    assert.isNull(masked.dimensions.find((d) => d.dimension === "workload")?.contributors);
  });

  it("leaves no score, trend point or typical change once the current Round fails the raised N", () => {
    const result = compute(5, history(5));
    const before = result.dimensions.find((d) => d.dimension === "workload");
    assert.strictEqual(before?.trend.at(-1)?.score, 4);

    const masked = enforceEffectiveNOnResult(result, 6);

    for (const d of masked.dimensions) {
      assert.isNull(d.score);
      assert.isNull(d.change);
      assert.isNull(d.typicalChange);

      for (const p of d.trend) {
        assert.isNull(p.score);
        assert.isTrue(p.hasGap);
      }
    }

    for (const q of masked.questions) {
      assert.isNull(q.typicalChange);

      for (const p of q.trend) {
        assert.isNull(p.score);
      }
    }
  });

  it("hides earlier trend points that fail the raised N but keeps the current point that passes", () => {
    const result = compute(6, history(5));
    const masked = enforceEffectiveNOnResult(result, 6);
    const dim = masked.dimensions.find((d) => d.dimension === "workload");
    assert.strictEqual(dim?.score, 4);
    assert.strictEqual(dim?.contributors, 6);
    assert.isNull(dim?.change);
    assert.isNull(dim?.typicalChange);
    assert.deepStrictEqual(
      dim?.trend.map((p) => p.score),
      [null, null, null, 4],
    );
    const q = masked.questions.find((x) => x.questionVersionId === Q1);
    assert.deepStrictEqual(
      q?.trend.map((p) => p.score),
      [null, null, null, 4],
    );
    assert.isNull(q?.change);
  });
});
