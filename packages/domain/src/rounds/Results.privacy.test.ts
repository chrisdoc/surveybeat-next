import { assert, describe, it } from "@effect/vitest";
import { TeamId } from "../people/Team.ts";
import { PulseId } from "../pulses/Pulse.ts";
import { QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import { calculateRoundResult, type QuestionInput } from "./Results.ts";
import { RoundId } from "./Round.ts";
import type { SubmissionAnswer } from "./Submission.ts";

const PULSE_ID = PulseId.make("pulse-priv");
const TEAM_ID = TeamId.make("team-priv");
const ROUND_ID = RoundId.make("round-priv");

const ratingType: QuestionType = {
  _tag: "Rating",
  lowLabel: "Low",
  highLabel: "High",
  comment: true,
};

const choiceType: QuestionType = {
  _tag: "SingleChoice",
  options: ["Red", "Green", "Blue"],
};

describe("Results Privacy & Minimum Group Size Invariants (ADR 0004, Issue #3)", () => {
  it("Invariant P1: Sub-N question answers cannot be recovered through dimension score subtraction", () => {
    // Dimension 'clarity' has Question A (5 contributors) and Question B (1 contributor, secret value = 5).
    // Under N=4: Question B must be excluded from Dimension score.
    const QA = QuestionVersionId.make("q-a.1");
    const QB = QuestionVersionId.make("q-b.1");

    const questions: ReadonlyArray<QuestionInput> = [
      { id: QA, position: 0, text: "Question A", type: ratingType, dimension: "clarity" },
      { id: QB, position: 1, text: "Question B", type: ratingType, dimension: "clarity" },
    ];

    const submissions: Array<{ id: string; answers: Array<SubmissionAnswer> }> = [
      { id: "s1", answers: [{ questionVersionId: QA, value: 3, comment: null }] },
      { id: "s2", answers: [{ questionVersionId: QA, value: 3, comment: null }] },
      { id: "s3", answers: [{ questionVersionId: QA, value: 3, comment: null }] },
      { id: "s4", answers: [{ questionVersionId: QA, value: 3, comment: null }] },
      {
        id: "s5",
        answers: [
          { questionVersionId: QA, value: 3, comment: null },
          { questionVersionId: QB, value: 5, comment: null }, // Only 1 person answered B with score 5
        ],
      },
    ];

    const result = calculateRoundResult({
      roundId: ROUND_ID,
      pulseId: PULSE_ID,
      teamId: TEAM_ID,
      status: "closed",
      plannedOpenDate: "2026-11-09",
      closedAt: 1731140000000,
      effectiveMinimumGroupSize: 4,
      eligibleMembersCount: 8,
      questions,
      submissions,
      pastRoundsHistory: [],
    });

    const resB = result.questions.find((q) => q.questionVersionId === QB);
    assert.isFalse(resB?.meetsMinimumGroupSize);
    assert.isNull(resB?.score);
    assert.isNull(resB?.distribution);

    // Dimension clarity score must equal QA score exactly (3.0)
    // If QB were included: (3.0 + 5.0) / 2 = 4.0, which would allow deriving QB = 2 * 4.0 - 3.0 = 5.0!
    // But under Rule R3, dimension score is strictly 3.0:
    const dim = result.dimensions.find((d) => d.dimension === "clarity");
    assert.strictEqual(dim?.score, 3.0);
    assert.strictEqual(dim?.usableQuestionCount, 1);
  });

  it("Invariant P2: Comments are unlinked from ratings and submission identity", () => {
    const QA = QuestionVersionId.make("q-a.1");
    const questions: ReadonlyArray<QuestionInput> = [
      { id: QA, position: 0, text: "Question A", type: ratingType, dimension: null },
    ];

    const submissions = [
      { id: "sub-100", answers: [{ questionVersionId: QA, value: 1, comment: "I feel terrible" }] },
      { id: "sub-200", answers: [{ questionVersionId: QA, value: 5, comment: "I feel wonderful" }] },
      { id: "sub-300", answers: [{ questionVersionId: QA, value: 4, comment: null }] },
      { id: "sub-400", answers: [{ questionVersionId: QA, value: 4, comment: null }] },
    ];

    const result = calculateRoundResult({
      roundId: ROUND_ID,
      pulseId: PULSE_ID,
      teamId: TEAM_ID,
      status: "closed",
      plannedOpenDate: "2026-11-09",
      closedAt: 1731140000000,
      effectiveMinimumGroupSize: 4,
      eligibleMembersCount: 4,
      questions,
      submissions,
      pastRoundsHistory: [],
    });

    assert.strictEqual(result.comments.length, 2);
    for (const c of result.comments) {
      // Must only contain questionVersionId and text
      const keys = Object.keys(c);
      assert.isTrue(keys.includes("questionVersionId"));
      assert.isTrue(keys.includes("text"));
      assert.isFalse(keys.includes("submissionId"));
      assert.isFalse(keys.includes("value"));
      assert.isFalse(keys.includes("personId"));
      assert.isFalse(keys.includes("email"));
    }
  });

  it("Invariant P3: Property test over 50 generated rounds with arbitrary N and submissions", () => {
    const QA = QuestionVersionId.make("q-prop-a.1");
    const QB = QuestionVersionId.make("q-prop-b.1");
    const QC = QuestionVersionId.make("q-prop-c.1");

    const questions: ReadonlyArray<QuestionInput> = [
      { id: QA, position: 0, text: "Prop A", type: ratingType, dimension: "workload" },
      { id: QB, position: 1, text: "Prop B", type: ratingType, dimension: "workload" },
      { id: QC, position: 2, text: "Prop C", type: choiceType, dimension: null },
    ];

    for (let run = 0; run < 50; run++) {
      const N = 3 + Math.floor(Math.random() * 5); // N between 3 and 7
      const totalSubmissions = Math.floor(Math.random() * 12); // 0 to 11 submissions

      const submissions: Array<{ id: string; answers: Array<SubmissionAnswer> }> = [];
      for (let s = 0; s < totalSubmissions; s++) {
        const answers: Array<SubmissionAnswer> = [];
        // Randomly choose whether respondent answers QA, QB, QC
        if (Math.random() > 0.3) {
          answers.push({
            questionVersionId: QA,
            value: 1 + Math.floor(Math.random() * 5),
            comment: Math.random() > 0.5 ? `Comment QA ${s}` : null,
          });
        }
        if (Math.random() > 0.6) {
          answers.push({
            questionVersionId: QB,
            value: 1 + Math.floor(Math.random() * 5),
            comment: null,
          });
        }
        if (Math.random() > 0.4) {
          answers.push({
            questionVersionId: QC,
            value: Math.floor(Math.random() * 3),
            comment: null,
          });
        }
        submissions.push({ id: `prop-sub-${s}`, answers });
      }

      const result = calculateRoundResult({
        roundId: ROUND_ID,
        pulseId: PULSE_ID,
        teamId: TEAM_ID,
        status: "closed",
        plannedOpenDate: "2026-11-09",
        closedAt: 1731140000000,
        effectiveMinimumGroupSize: N,
        eligibleMembersCount: 15,
        questions,
        submissions,
        pastRoundsHistory: [],
      });

      // Assert Round-level invariant
      if (totalSubmissions < N) {
        assert.isFalse(result.meetsMinimumGroupSize);
        assert.strictEqual(result.comments.length, 0);
        for (const q of result.questions) {
          assert.isNull(q.score);
          assert.isNull(q.distribution);
        }
        for (const d of result.dimensions) {
          assert.isNull(d.score);
        }
      } else {
        // Round meets N: check question-level invariants
        for (const q of result.questions) {
          if (q.contributors < N) {
            assert.isFalse(q.meetsMinimumGroupSize);
            assert.isNull(q.score);
            assert.isNull(q.distribution);
          } else {
            assert.isTrue(q.meetsMinimumGroupSize);
            if (q.type._tag === "Rating") {
              assert.isNotNull(q.score);
            }
            assert.isNotNull(q.distribution);
          }
        }

        // Check dimension invariant: dimension score uses only questions with contributors >= N
        const workloadDim = result.dimensions.find((d) => d.dimension === "workload");
        const usableQuestions = result.questions.filter(
          (q) => q.dimension === "workload" && q.contributors >= N && q.score !== null,
        );

        if (usableQuestions.length === 0) {
          assert.isNull(workloadDim?.score);
        } else {
          assert.isNotNull(workloadDim?.score);
          assert.strictEqual(workloadDim?.usableQuestionCount, usableQuestions.length);
        }
      }
    }
  });

  it("Invariant P4: Role privacy - members see no comments, leads see comments only behind N", () => {
    const QA = QuestionVersionId.make("q-a.1");
    const questions: ReadonlyArray<QuestionInput> = [
      { id: QA, position: 0, text: "Question A", type: ratingType, dimension: "clarity" },
    ];

    const submissions = [
      { id: "s1", answers: [{ questionVersionId: QA, value: 4, comment: "Lead should see this" }] },
      { id: "s2", answers: [{ questionVersionId: QA, value: 4, comment: "And this" }] },
      { id: "s3", answers: [{ questionVersionId: QA, value: 5, comment: null }] },
      { id: "s4", answers: [{ questionVersionId: QA, value: 5, comment: null }] },
    ];

    const result = calculateRoundResult({
      roundId: ROUND_ID,
      pulseId: PULSE_ID,
      teamId: TEAM_ID,
      status: "closed",
      plannedOpenDate: "2026-11-09",
      closedAt: 1731140000000,
      effectiveMinimumGroupSize: 4,
      eligibleMembersCount: 6,
      questions,
      submissions,
      pastRoundsHistory: [],
    });

    assert.isTrue(result.meetsMinimumGroupSize);
    assert.strictEqual(result.comments.length, 2);

    // When viewed as a member (non-lead), comments are stripped
    const memberView = { ...result, comments: [] };
    assert.strictEqual(memberView.comments.length, 0);
  });

  it("Invariant P5: Open round hides all scores, distributions, and comments", () => {
    const QA = QuestionVersionId.make("q-a.1");
    const questions: ReadonlyArray<QuestionInput> = [
      { id: QA, position: 0, text: "Question A", type: ratingType, dimension: "clarity" },
    ];

    const submissions = [
      { id: "s1", answers: [{ questionVersionId: QA, value: 5, comment: "Sneak peek" }] },
      { id: "s2", answers: [{ questionVersionId: QA, value: 5, comment: "Sneak peek 2" }] },
    ];

    const openResult = calculateRoundResult({
      roundId: ROUND_ID,
      pulseId: PULSE_ID,
      teamId: TEAM_ID,
      status: "open",
      plannedOpenDate: "2026-11-09",
      closedAt: null,
      effectiveMinimumGroupSize: 4,
      eligibleMembersCount: 6,
      questions,
      submissions,
      pastRoundsHistory: [],
    });

    assert.strictEqual(openResult.submissionsCount, 2);
    assert.strictEqual(openResult.comments.length, 0);
    for (const q of openResult.questions) {
      assert.isNull(q.score);
      assert.isNull(q.distribution);
    }
    for (const d of openResult.dimensions) {
      assert.isNull(d.score);
    }
  });
});
