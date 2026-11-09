import { assert, describe, it } from "@effect/vitest";
import { TeamId } from "../people/Team.ts";
import { PulseId } from "../pulses/Pulse.ts";
import { QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import {
  calculateRoundResult,
  enforceEffectiveNOnResult,
  evaluateHighlight,
  type HistoricalRoundData,
  median,
  type QuestionInput,
} from "./Results.ts";
import { RoundId } from "./Round.ts";
import type { SubmissionAnswer } from "./Submission.ts";

const PULSE_ID = PulseId.make("pulse-1");
const TEAM_ID = TeamId.make("team-1");
const ROUND_1 = RoundId.make("round-1");
const Q1 = QuestionVersionId.make("q-1.1");
const Q2 = QuestionVersionId.make("q-2.1");
const Q3_CHOICE = QuestionVersionId.make("q-3.1");

const ratingType: QuestionType = {
  _tag: "Rating",
  lowLabel: "Low",
  highLabel: "High",
  comment: true,
};

const choiceType: QuestionType = {
  _tag: "SingleChoice",
  options: ["Option A", "Option B", "Option C"],
};

const testQuestions: ReadonlyArray<QuestionInput> = [
  {
    id: Q1,
    position: 0,
    text: "Question 1",
    type: ratingType,
    dimension: "workload",
  },
  {
    id: Q2,
    position: 1,
    text: "Question 2",
    type: ratingType,
    dimension: "workload",
  },
  {
    id: Q3_CHOICE,
    position: 2,
    text: "Question 3 Choice",
    type: choiceType,
    dimension: null,
  },
];

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
    assert.strictEqual(h1.label, "Bigger change than usual for this team");
    assert.strictEqual(h1.explanation, "Usually moves about ±0.2 between rounds");

    // change of -0.25: |-0.25| = 0.25 < 0.30 -> not highlighted
    const h2 = evaluateHighlight(-0.25, typical);
    assert.isFalse(h2.isLargerThanUsual);
  });

  it("enforces floor of 0.3 for stable teams with 0.0 typical change", () => {
    // Team whose past changes are all 0.0 (typical = 0.0)
    const typical = median([0.0, 0.0, 0.0, 0.0, 0.0]);
    assert.strictEqual(typical, 0.0);

    // Change of 0.2 is not highlighted because 0.2 < 0.3 floor
    const h = evaluateHighlight(0.2, typical);
    assert.isFalse(h.isLargerThanUsual);

    // Change of 0.3 is highlighted because 0.3 >= 0.0 and 0.3 >= 0.3
    const hPass = evaluateHighlight(0.3, typical);
    assert.isTrue(hPass.isLargerThanUsual);
    assert.strictEqual(hPass.direction, "rise");
  });
});

describe("Minimum group size rules R1–R11 (Issue #3 / ADR 0004)", () => {
  it("R1 & R3: Question B with 3 contributors is hidden under N=4, left out of Dimension", () => {
    // 6 Submissions total, but only 3 answer Question 2 (Q2).
    // All 6 answer Question 1 (Q1).
    const submissions: Array<{ id: string; answers: Array<SubmissionAnswer> }> = [];
    for (let i = 1; i <= 6; i++) {
      const answers: Array<SubmissionAnswer> = [{ questionVersionId: Q1, value: 4, comment: null }];
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
      closedAt: 1730592000000,
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
    const submissions: Array<{ id: string; answers: Array<SubmissionAnswer> }> = [
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
      closedAt: 1730592000000,
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
    const submissions: Array<{ id: string; answers: Array<SubmissionAnswer> }> = [
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
      closedAt: 1730592000000,
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
      assert.isUndefined((c as Record<string, unknown>)["submissionId"]);
      assert.isUndefined((c as Record<string, unknown>)["value"]);
      assert.isUndefined((c as Record<string, unknown>)["personId"]);
    }
  });

  it("R7: Zero results while Open, only submission count appears", () => {
    const submissions: Array<{ id: string; answers: Array<SubmissionAnswer> }> = [
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
    const submissions: Array<{ id: string; answers: Array<SubmissionAnswer> }> = [
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
      closedAt: 1730592000000,
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
    const submissions: Array<{ id: string; answers: Array<SubmissionAnswer> }> = [
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
      closedAt: 1730592000000,
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
      closedAt: 1730592000000,
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

describe("12-Round history, trends, warm-up, and gap handling (Issue #4)", () => {
  it("building baseline warm-up note when fewer than 6 usable rounds exist", () => {
    // 3 usable past rounds
    const history: Array<HistoricalRoundData> = [];
    for (let i = 1; i <= 3; i++) {
      history.push({
        roundId: RoundId.make(`past-${i}`),
        plannedOpenDate: `2026-10-0${i}`,
        closedAt: 1730000000000 + i * 86400000,
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

    const submissions: Array<{ id: string; answers: Array<SubmissionAnswer> }> = [
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
      closedAt: 1730592000000,
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
    const history: Array<HistoricalRoundData> = [
      {
        roundId: RoundId.make("r-1"),
        plannedOpenDate: "2026-09-01",
        closedAt: 100,
        effectiveMinimumGroupSize: 4,
        submissionsCount: 4,
        questions: [{ questionVersionId: Q1, score: 3.0, contributors: 4, meetsMinimumGroupSize: true }],
        dimensions: [
          { dimension: "workload", score: 3.0, usableQuestionCount: 1, meetsMinimumGroupSize: true },
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
    const history: Array<HistoricalRoundData> = [
      {
        roundId: RoundId.make("r-prev"),
        plannedOpenDate: "2026-10-01",
        closedAt: 100,
        effectiveMinimumGroupSize: 4,
        submissionsCount: 5,
        questions: [
          { questionVersionId: Q1, score: 3.0, contributors: 5, meetsMinimumGroupSize: true },
          { questionVersionId: Q2, score: 2.0, contributors: 5, meetsMinimumGroupSize: true },
        ],
        dimensions: [
          { dimension: "workload", score: 2.5, usableQuestionCount: 2, meetsMinimumGroupSize: true },
        ],
      },
    ];

    // Current round: 5 submissions, all 5 answer Q1, only 2 answer Q2
    const submissions: Array<{ id: string; answers: Array<SubmissionAnswer> }> = [];
    for (let i = 1; i <= 5; i++) {
      const answers: Array<SubmissionAnswer> = [{ questionVersionId: Q1, value: 4, comment: null }];
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
    assert.strictEqual(dim?.change?.change, 1.0);
    assert.strictEqual(dim?.change?.matchedQuestionCount, 1);
    assert.strictEqual(dim?.change?.currentQuestionCount, 2);
    assert.strictEqual(dim?.change?.annotation, "Based on 1 of 2 questions");
  });
});
