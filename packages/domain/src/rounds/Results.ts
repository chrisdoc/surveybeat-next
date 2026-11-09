import { Schema } from "effect";
import { TeamId } from "../people/Team.ts";
import { PulseId } from "../pulses/Pulse.ts";
import { Dimension, QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import { RoundId, RoundStatus } from "./Round.ts";
import type { SubmissionAnswer } from "./Submission.ts";

/** Single option in a rating or choice distribution. */
export const DistributionOption = Schema.Struct({
  option: Schema.Union([Schema.String, Schema.Int]),
  count: Schema.Int,
});
export type DistributionOption = typeof DistributionOption.Type;

/** One historical point on a Question's trend line over up to 12 Rounds. */
export const TrendPoint = Schema.Struct({
  roundId: RoundId,
  plannedOpenDate: Schema.String,
  score: Schema.NullOr(Schema.Finite),
  contributors: Schema.Int,
  hasGap: Schema.Boolean,
});
export type TrendPoint = typeof TrendPoint.Type;

/** One historical point on a Dimension's trend line over up to 12 Rounds. */
export const DimensionTrendPoint = Schema.Struct({
  roundId: RoundId,
  plannedOpenDate: Schema.String,
  score: Schema.NullOr(Schema.Finite),
  usableQuestionCount: Schema.Int,
  hasGap: Schema.Boolean,
});
export type DimensionTrendPoint = typeof DimensionTrendPoint.Type;

/** Highlight indicating a score change is larger than normal noise (Issue #4). */
export const Highlight = Schema.Struct({
  isLargerThanUsual: Schema.Boolean,
  direction: Schema.NullOr(Schema.Literals(["rise", "drop"])),
  label: Schema.String,
  explanation: Schema.String,
});
export type Highlight = typeof Highlight.Type;

/** Typical change status: baseline warm-up (needs 6 usable rounds) or ready. */
export const TypicalChange = Schema.Struct({
  status: Schema.Literals(["buildingBaseline", "ready"]),
  completedUsableRounds: Schema.Int,
  totalRequiredUsableRounds: Schema.Int,
  typicalChange: Schema.NullOr(Schema.Finite),
});
export type TypicalChange = typeof TypicalChange.Type;

/** Change for a Question compared with the most recent earlier usable Round within 12. */
export const QuestionChange = Schema.Struct({
  change: Schema.NullOr(Schema.Finite),
  previousRoundDate: Schema.NullOr(Schema.String),
  previousRoundId: Schema.NullOr(RoundId),
  highlight: Schema.NullOr(Highlight),
});
export type QuestionChange = typeof QuestionChange.Type;

/** Change for a Dimension compared with the most recent earlier usable Round within 12. */
export const DimensionChange = Schema.Struct({
  change: Schema.NullOr(Schema.Finite),
  previousRoundDate: Schema.NullOr(Schema.String),
  previousRoundId: Schema.NullOr(RoundId),
  matchedQuestionCount: Schema.Int,
  currentQuestionCount: Schema.Int,
  annotation: Schema.NullOr(Schema.String),
  highlight: Schema.NullOr(Highlight),
});
export type DimensionChange = typeof DimensionChange.Type;

/** The computed result for one Question in a Round. */
export const QuestionResult = Schema.Struct({
  questionVersionId: QuestionVersionId,
  position: Schema.Int,
  text: Schema.String,
  type: QuestionType,
  dimension: Schema.NullOr(Dimension),
  contributors: Schema.Int,
  meetsMinimumGroupSize: Schema.Boolean,
  score: Schema.NullOr(Schema.Finite),
  distribution: Schema.NullOr(Schema.Array(DistributionOption)),
  change: Schema.NullOr(QuestionChange),
  typicalChange: Schema.NullOr(TypicalChange),
  trend: Schema.Array(TrendPoint),
});
export type QuestionResult = typeof QuestionResult.Type;

/** The computed result for one Dimension in a Round. */
export const DimensionResult = Schema.Struct({
  dimension: Dimension,
  score: Schema.NullOr(Schema.Finite),
  usableQuestionCount: Schema.Int,
  totalQuestionCount: Schema.Int,
  meetsMinimumGroupSize: Schema.Boolean,
  change: Schema.NullOr(DimensionChange),
  typicalChange: Schema.NullOr(TypicalChange),
  trend: Schema.Array(DimensionTrendPoint),
});
export type DimensionResult = typeof DimensionResult.Type;

/** An anonymous, unlinked, redacted text comment from a Submission (long text or rating say-more). */
export const CommentResult = Schema.Struct({
  questionVersionId: QuestionVersionId,
  text: Schema.String,
});
export type CommentResult = typeof CommentResult.Type;

/**
 * The complete Result of a Round.
 * Gated by effective minimum group size rules (ADR 0004, Issue #3, Issue #4).
 */
export const RoundResult = Schema.Struct({
  roundId: RoundId,
  pulseId: PulseId,
  teamId: TeamId,
  status: RoundStatus,
  plannedOpenDate: Schema.String,
  closedAt: Schema.NullOr(Schema.Int),
  effectiveMinimumGroupSize: Schema.Int,
  meetsMinimumGroupSize: Schema.Boolean,
  eligibleMembersCount: Schema.Int,
  submissionsCount: Schema.Int,
  responseRate: Schema.NullOr(Schema.Finite),
  delayed: Schema.Boolean,
  questions: Schema.Array(QuestionResult),
  dimensions: Schema.Array(DimensionResult),
  comments: Schema.Array(CommentResult),
});
export type RoundResult = typeof RoundResult.Type;

export class ResultsNotReady extends Schema.TaggedError<ResultsNotReady, { readonly brand: unique symbol }>()(
  "ResultsNotReady",
  {},
  { httpApiStatus: 404 },
) {}

export class ResultsDelayed extends Schema.TaggedError<ResultsDelayed, { readonly brand: unique symbol }>()(
  "ResultsDelayed",
  {},
  { httpApiStatus: 503 },
) {}

// --- Pure domain algorithms for Results calculation ---

/** Round a number to a fixed number of decimals to prevent floating point inaccuracies. */
export const roundDecimals = (value: number, decimals: number): number => {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

/** Computes the median of a non-empty array of numbers. */
export const median = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const val = sorted[mid];
    return val !== undefined ? val : 0;
  }
  const low = sorted[mid - 1];
  const high = sorted[mid];
  if (low === undefined || high === undefined) return 0;
  return roundDecimals((low + high) / 2, 4);
};

export interface QuestionInput {
  readonly id: QuestionVersionId;
  readonly position: number;
  readonly text: string;
  readonly type: QuestionType;
  readonly dimension: Dimension | null;
}

export interface HistoricalRoundQuestionData {
  readonly questionVersionId: QuestionVersionId;
  readonly score: number | null;
  readonly contributors: number;
  readonly meetsMinimumGroupSize: boolean;
}

export interface HistoricalRoundDimensionData {
  readonly dimension: Dimension;
  readonly score: number | null;
  readonly usableQuestionCount: number;
  readonly meetsMinimumGroupSize: boolean;
}

export interface HistoricalRoundData {
  readonly roundId: RoundId;
  readonly plannedOpenDate: string;
  readonly closedAt: number | null;
  readonly effectiveMinimumGroupSize: number;
  readonly submissionsCount: number;
  readonly questions: ReadonlyArray<HistoricalRoundQuestionData>;
  readonly dimensions: ReadonlyArray<HistoricalRoundDimensionData>;
}

/** Computes rating distribution (1..5) or choice distribution. */
export const computeDistribution = (
  type: QuestionType,
  answers: ReadonlyArray<SubmissionAnswer>,
): ReadonlyArray<DistributionOption> => {
  if (type._tag === "Rating") {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const ans of answers) {
      if (ans.value !== null && ans.value >= 1 && ans.value <= 5) {
        counts[ans.value] = (counts[ans.value] ?? 0) + 1;
      }
    }
    return [1, 2, 3, 4, 5].map((opt) => ({
      option: opt,
      count: counts[opt] ?? 0,
    }));
  }

  if (type._tag === "SingleChoice") {
    const counts = new Map<string, number>();
    for (const opt of type.options) {
      counts.set(opt, 0);
    }
    for (const ans of answers) {
      if (ans.value !== null && ans.value >= 0 && ans.value < type.options.length) {
        const optionName = type.options[ans.value];
        if (optionName !== undefined) {
          counts.set(optionName, (counts.get(optionName) ?? 0) + 1);
        }
      }
    }
    return type.options.map((opt) => ({
      option: opt,
      count: counts.get(opt) ?? 0,
    }));
  }

  return [];
};

/**
 * Calculates Typical change and checks if the given change is a highlight.
 * Rule: |change| >= 2 * Typical change AND |change| >= 0.3. Floor is 0.3.
 */
export const evaluateHighlight = (change: number, typicalChangeVal: number): Highlight => {
  const absChange = roundDecimals(Math.abs(change), 4);
  const threshold = roundDecimals(2 * typicalChangeVal, 4);
  const isLarger = absChange >= threshold && absChange >= 0.3;
  const direction = change > 0 ? ("rise" as const) : change < 0 ? ("drop" as const) : null;
  const roundedTypical = roundDecimals(typicalChangeVal, 1);

  return {
    isLargerThanUsual: isLarger,
    direction,
    label: "Bigger change than usual for this team",
    explanation: `Usually moves about ±${roundedTypical.toFixed(1)} between rounds`,
  };
};

/** Fisher-Yates non-deterministic shuffle for unlinkability of comments (R4). */
export const shuffleComments = (comments: ReadonlyArray<CommentResult>): ReadonlyArray<CommentResult> => {
  const arr = [...comments];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i];
    const target = arr[j];
    if (temp !== undefined && target !== undefined) {
      arr[i] = target;
      arr[j] = temp;
    }
  }
  return arr;
};

/**
 * Computes the complete RoundResult given the current round's questions,
 * submissions, eligible members, effective N, and the past 11 closed rounds history.
 */
export const calculateRoundResult = (params: {
  readonly roundId: RoundId;
  readonly pulseId: PulseId;
  readonly teamId: TeamId;
  readonly status: RoundStatus;
  readonly plannedOpenDate: string;
  readonly closedAt: number | null;
  readonly effectiveMinimumGroupSize: number;
  readonly eligibleMembersCount: number;
  readonly questions: ReadonlyArray<QuestionInput>;
  readonly submissions: ReadonlyArray<{
    readonly id: string;
    readonly answers: ReadonlyArray<SubmissionAnswer>;
  }>;
  readonly pastRoundsHistory: ReadonlyArray<HistoricalRoundData>;
  readonly delayed?: boolean;
}): RoundResult => {
  const {
    roundId,
    pulseId,
    teamId,
    status,
    plannedOpenDate,
    closedAt,
    effectiveMinimumGroupSize: effectiveN,
    eligibleMembersCount,
    questions,
    submissions,
    pastRoundsHistory,
    delayed = false,
  } = params;

  const submissionsCount = submissions.length;
  const meetsRoundN = submissionsCount >= effectiveN;
  const responseRate =
    eligibleMembersCount > 0 ? roundDecimals(submissionsCount / eligibleMembersCount, 4) : null;

  // Rule R7: zero results while open, only response count.
  // Rule R8: if round closed below N, response rate appears, answers/scores hidden.
  const isClosedOrLater = status === "closed" || status === "ready" || status === "shared";
  const shouldRevealResults = isClosedOrLater && meetsRoundN;

  // Map answers by questionVersionId
  const answersByQuestion = new Map<string, Array<SubmissionAnswer>>();
  for (const q of questions) {
    answersByQuestion.set(q.id, []);
  }
  for (const sub of submissions) {
    for (const ans of sub.answers) {
      const list = answersByQuestion.get(ans.questionVersionId);
      if (list !== undefined) {
        list.push(ans);
      }
    }
  }

  // 1. Calculate Question scores and distributions
  interface TempQuestionScore {
    readonly question: QuestionInput;
    readonly contributors: number;
    readonly meetsN: boolean;
    readonly score: number | null;
    readonly distribution: ReadonlyArray<DistributionOption> | null;
  }

  const tempQuestionScores: Array<TempQuestionScore> = [];

  for (const q of questions) {
    const answers = answersByQuestion.get(q.id) ?? [];
    if (!shouldRevealResults) {
      tempQuestionScores.push({
        question: q,
        contributors: 0,
        meetsN: false,
        score: null,
        distribution: null,
      });
      continue;
    }

    if (q.type._tag === "Rating") {
      const ratingAnswers = answers.filter((a) => a.value !== null);
      const contributors = ratingAnswers.length;
      const meetsN = contributors >= effectiveN;

      if (!meetsN) {
        tempQuestionScores.push({
          question: q,
          contributors,
          meetsN: false,
          score: null,
          distribution: null,
        });
      } else {
        const sum = ratingAnswers.reduce((acc, curr) => acc + (curr.value ?? 0), 0);
        const mean = roundDecimals(sum / contributors, 2);
        const dist = computeDistribution(q.type, ratingAnswers);
        tempQuestionScores.push({
          question: q,
          contributors,
          meetsN: true,
          score: mean,
          distribution: dist,
        });
      }
    } else if (q.type._tag === "SingleChoice") {
      const choiceAnswers = answers.filter((a) => a.value !== null);
      const contributors = choiceAnswers.length;
      const meetsN = contributors >= effectiveN;
      tempQuestionScores.push({
        question: q,
        contributors,
        meetsN,
        score: null,
        distribution: meetsN ? computeDistribution(q.type, choiceAnswers) : null,
      });
    } else {
      // LongText
      const textAnswers = answers.filter((a) => a.comment !== null && a.comment.trim().length > 0);
      const contributors = textAnswers.length;
      const meetsN = contributors >= effectiveN;
      tempQuestionScores.push({
        question: q,
        contributors,
        meetsN,
        score: null,
        distribution: null,
      });
    }
  }

  // 2. Calculate Dimension scores
  // Rule R3: Computed ONLY from Questions that meet N themselves!
  // Hidden if no Questions meet N.
  const dimensionsToEvaluate: ReadonlyArray<Dimension> = [
    "workload",
    "psychologicalSafety",
    "clarity",
    "recognition",
  ];

  interface TempDimensionScore {
    readonly dimension: Dimension;
    readonly score: number | null;
    readonly usableQuestionCount: number;
    readonly totalQuestionCount: number;
    readonly meetsN: boolean;
  }

  const tempDimensionScores: Array<TempDimensionScore> = [];

  for (const dim of dimensionsToEvaluate) {
    const dimQuestions = tempQuestionScores.filter(
      (tqs) => tqs.question.dimension === dim && tqs.question.type._tag === "Rating",
    );
    const totalCount = dimQuestions.length;
    if (totalCount === 0 || !shouldRevealResults) {
      tempDimensionScores.push({
        dimension: dim,
        score: null,
        usableQuestionCount: 0,
        totalQuestionCount: totalCount,
        meetsN: false,
      });
      continue;
    }

    const usableQuestions = dimQuestions.filter((tqs) => tqs.meetsN && tqs.score !== null);
    if (usableQuestions.length === 0) {
      tempDimensionScores.push({
        dimension: dim,
        score: null,
        usableQuestionCount: 0,
        totalQuestionCount: totalCount,
        meetsN: false,
      });
    } else {
      const sum = usableQuestions.reduce((acc, q) => acc + (q.score ?? 0), 0);
      const mean = roundDecimals(sum / usableQuestions.length, 2);
      tempDimensionScores.push({
        dimension: dim,
        score: mean,
        usableQuestionCount: usableQuestions.length,
        totalQuestionCount: totalCount,
        meetsN: true,
      });
    }
  }

  // 3. Trends, Typical Changes, and Highlights for Questions
  // History up to last 11 rounds plus current = up to 12 rounds total.
  const pastUpTo11 = pastRoundsHistory.slice(-11);

  const finalQuestions: Array<QuestionResult> = tempQuestionScores.map((tqs) => {
    const q = tqs.question;

    // Build trend points: past rounds + current round
    const trendPoints: Array<TrendPoint> = [];
    for (const past of pastUpTo11) {
      const pastQ = past.questions.find((pq) => pq.questionVersionId === q.id);
      const pastEffectiveN = Math.max(past.effectiveMinimumGroupSize, effectiveN);
      const pastUsable =
        pastQ !== undefined &&
        pastQ.score !== null &&
        pastQ.contributors >= pastEffectiveN &&
        past.submissionsCount >= pastEffectiveN;

      trendPoints.push({
        roundId: past.roundId,
        plannedOpenDate: past.plannedOpenDate,
        score: pastUsable && pastQ ? pastQ.score : null,
        contributors: pastQ ? pastQ.contributors : 0,
        hasGap: !pastUsable,
      });
    }

    // Add current round to trend
    trendPoints.push({
      roundId,
      plannedOpenDate,
      score: tqs.score,
      contributors: tqs.contributors,
      hasGap: !tqs.meetsN,
    });

    if (q.type._tag !== "Rating" || !tqs.meetsN || tqs.score === null) {
      return {
        questionVersionId: q.id,
        position: q.position,
        text: q.text,
        type: q.type,
        dimension: q.dimension,
        contributors: tqs.contributors,
        meetsMinimumGroupSize: tqs.meetsN,
        score: tqs.score,
        distribution: tqs.distribution,
        change: null,
        typicalChange: null,
        trend: trendPoints,
      };
    }

    // Identify past usable rounds for this question
    interface UsablePastQuestionRound {
      readonly roundId: RoundId;
      readonly plannedOpenDate: string;
      readonly score: number;
    }

    const pastUsableRounds: Array<UsablePastQuestionRound> = [];
    for (const past of pastRoundsHistory) {
      const pastQ = past.questions.find((pq) => pq.questionVersionId === q.id);
      const pastEffectiveN = Math.max(past.effectiveMinimumGroupSize, effectiveN);
      if (
        pastQ !== undefined &&
        pastQ.score !== null &&
        pastQ.contributors >= pastEffectiveN &&
        past.submissionsCount >= pastEffectiveN
      ) {
        pastUsableRounds.push({
          roundId: past.roundId,
          plannedOpenDate: past.plannedOpenDate,
          score: pastQ.score,
        });
      }
    }

    // Consecutive pairs of usable past rounds
    const pastDifferences: Array<number> = [];
    for (let i = 1; i < pastUsableRounds.length; i++) {
      const prev = pastUsableRounds[i - 1];
      const curr = pastUsableRounds[i];
      if (prev !== undefined && curr !== undefined) {
        pastDifferences.push(roundDecimals(Math.abs(curr.score - prev.score), 4));
      }
    }

    const completedUsableCount = pastUsableRounds.length;
    const hasWarmUp = completedUsableCount >= 6 && pastDifferences.length >= 5;

    let typicalChangeObj: TypicalChange | null = null;
    let typicalChangeVal: number | null = null;

    if (!hasWarmUp) {
      typicalChangeObj = {
        status: "buildingBaseline",
        completedUsableRounds: completedUsableCount,
        totalRequiredUsableRounds: 6,
        typicalChange: null,
      };
    } else {
      // Last up to 11 past differences (from last 12 rounds)
      const diffsToUse = pastDifferences.slice(-11);
      typicalChangeVal = median(diffsToUse);
      typicalChangeObj = {
        status: "ready",
        completedUsableRounds: completedUsableCount,
        totalRequiredUsableRounds: 6,
        typicalChange: typicalChangeVal,
      };
    }

    // Change since last usable round
    const mostRecentPastUsable = pastUsableRounds[pastUsableRounds.length - 1];
    let changeObj: QuestionChange | null = null;

    if (mostRecentPastUsable !== undefined) {
      const diff = roundDecimals(tqs.score - mostRecentPastUsable.score, 2);
      const highlight =
        hasWarmUp && typicalChangeVal !== null ? evaluateHighlight(diff, typicalChangeVal) : null;

      changeObj = {
        change: diff,
        previousRoundDate: mostRecentPastUsable.plannedOpenDate,
        previousRoundId: mostRecentPastUsable.roundId,
        highlight,
      };
    }

    return {
      questionVersionId: q.id,
      position: q.position,
      text: q.text,
      type: q.type,
      dimension: q.dimension,
      contributors: tqs.contributors,
      meetsMinimumGroupSize: tqs.meetsN,
      score: tqs.score,
      distribution: tqs.distribution,
      change: changeObj,
      typicalChange: typicalChangeObj,
      trend: trendPoints,
    };
  });

  // 4. Trends, Typical Changes, and Highlights for Dimensions
  const finalDimensions: Array<DimensionResult> = tempDimensionScores.map((tds) => {
    const dim = tds.dimension;

    // Build dimension trend points
    const dimTrendPoints: Array<DimensionTrendPoint> = [];
    for (const past of pastUpTo11) {
      const pastDim = past.dimensions.find((pd) => pd.dimension === dim);
      const pastEffectiveN = Math.max(past.effectiveMinimumGroupSize, effectiveN);
      const pastUsable =
        pastDim !== undefined &&
        pastDim.score !== null &&
        pastDim.meetsMinimumGroupSize &&
        past.submissionsCount >= pastEffectiveN;

      dimTrendPoints.push({
        roundId: past.roundId,
        plannedOpenDate: past.plannedOpenDate,
        score: pastUsable && pastDim ? pastDim.score : null,
        usableQuestionCount: pastDim ? pastDim.usableQuestionCount : 0,
        hasGap: !pastUsable,
      });
    }

    dimTrendPoints.push({
      roundId,
      plannedOpenDate,
      score: tds.score,
      usableQuestionCount: tds.usableQuestionCount,
      hasGap: !tds.meetsN,
    });

    if (!tds.meetsN || tds.score === null) {
      return {
        dimension: dim,
        score: null,
        usableQuestionCount: tds.usableQuestionCount,
        totalQuestionCount: tds.totalQuestionCount,
        meetsMinimumGroupSize: false,
        change: null,
        typicalChange: null,
        trend: dimTrendPoints,
      };
    }

    // Past rounds where dimension was usable
    interface UsablePastDimRound {
      readonly roundId: RoundId;
      readonly plannedOpenDate: string;
      readonly roundData: HistoricalRoundData;
    }

    const usablePastDimRounds: Array<UsablePastDimRound> = [];
    for (const past of pastRoundsHistory) {
      const pastDim = past.dimensions.find((pd) => pd.dimension === dim);
      const pastEffectiveN = Math.max(past.effectiveMinimumGroupSize, effectiveN);
      if (
        pastDim !== undefined &&
        pastDim.score !== null &&
        pastDim.meetsMinimumGroupSize &&
        past.submissionsCount >= pastEffectiveN
      ) {
        usablePastDimRounds.push({
          roundId: past.roundId,
          plannedOpenDate: past.plannedOpenDate,
          roundData: past,
        });
      }
    }

    // Consecutive pairs of usable past dimension rounds:
    // "a Dimension change is the mean of the per-Question changes over the Questions usable in both Rounds."
    const pastDimDifferences: Array<number> = [];
    for (let i = 1; i < usablePastDimRounds.length; i++) {
      const prev = usablePastDimRounds[i - 1];
      const curr = usablePastDimRounds[i];
      if (prev !== undefined && curr !== undefined) {
        const prevEffectiveN = Math.max(prev.roundData.effectiveMinimumGroupSize, effectiveN);
        const currEffectiveN = Math.max(curr.roundData.effectiveMinimumGroupSize, effectiveN);

        const dimQuestions = questions.filter((q) => q.dimension === dim && q.type._tag === "Rating");
        const perQuestionChanges: Array<number> = [];

        for (const q of dimQuestions) {
          const qPrev = prev.roundData.questions.find((pq) => pq.questionVersionId === q.id);
          const qCurr = curr.roundData.questions.find((cq) => cq.questionVersionId === q.id);

          if (
            qPrev &&
            qCurr &&
            qPrev.score !== null &&
            qCurr.score !== null &&
            qPrev.contributors >= prevEffectiveN &&
            qCurr.contributors >= currEffectiveN
          ) {
            perQuestionChanges.push(qCurr.score - qPrev.score);
          }
        }

        if (perQuestionChanges.length > 0) {
          const meanDiff = perQuestionChanges.reduce((a, b) => a + b, 0) / perQuestionChanges.length;
          pastDimDifferences.push(roundDecimals(Math.abs(meanDiff), 4));
        }
      }
    }

    const completedUsableCount = usablePastDimRounds.length;
    const hasWarmUp = completedUsableCount >= 6 && pastDimDifferences.length >= 5;

    let typicalChangeObj: TypicalChange | null = null;
    let typicalChangeVal: number | null = null;

    if (!hasWarmUp) {
      typicalChangeObj = {
        status: "buildingBaseline",
        completedUsableRounds: completedUsableCount,
        totalRequiredUsableRounds: 6,
        typicalChange: null,
      };
    } else {
      const diffsToUse = pastDimDifferences.slice(-11);
      typicalChangeVal = median(diffsToUse);
      typicalChangeObj = {
        status: "ready",
        completedUsableRounds: completedUsableCount,
        totalRequiredUsableRounds: 6,
        typicalChange: typicalChangeVal,
      };
    }

    // Change since last usable round for dimension
    const mostRecentPastUsable = usablePastDimRounds[usablePastDimRounds.length - 1];
    let changeObj: DimensionChange | null = null;

    if (mostRecentPastUsable !== undefined) {
      const pastEffectiveN = Math.max(mostRecentPastUsable.roundData.effectiveMinimumGroupSize, effectiveN);
      const dimQuestions = questions.filter((q) => q.dimension === dim && q.type._tag === "Rating");
      const perQuestionChanges: Array<number> = [];

      for (const q of dimQuestions) {
        const qPast = mostRecentPastUsable.roundData.questions.find((pq) => pq.questionVersionId === q.id);
        const qCurr = tempQuestionScores.find((tqs) => tqs.question.id === q.id);

        if (
          qPast &&
          qCurr &&
          qPast.score !== null &&
          qCurr.score !== null &&
          qPast.contributors >= pastEffectiveN &&
          qCurr.meetsN
        ) {
          perQuestionChanges.push(qCurr.score - qPast.score);
        }
      }

      if (perQuestionChanges.length > 0) {
        const meanChange = roundDecimals(
          perQuestionChanges.reduce((a, b) => a + b, 0) / perQuestionChanges.length,
          2,
        );
        const matchedCount = perQuestionChanges.length;
        const currentCount = dimQuestions.length;
        const annotation =
          matchedCount < currentCount ? `Based on ${matchedCount} of ${currentCount} questions` : null;

        const highlight =
          hasWarmUp && typicalChangeVal !== null ? evaluateHighlight(meanChange, typicalChangeVal) : null;

        changeObj = {
          change: meanChange,
          previousRoundDate: mostRecentPastUsable.plannedOpenDate,
          previousRoundId: mostRecentPastUsable.roundId,
          matchedQuestionCount: matchedCount,
          currentQuestionCount: currentCount,
          annotation,
          highlight,
        };
      }
    }

    return {
      dimension: dim,
      score: tds.score,
      usableQuestionCount: tds.usableQuestionCount,
      totalQuestionCount: tds.totalQuestionCount,
      meetsMinimumGroupSize: true,
      change: changeObj,
      typicalChange: typicalChangeObj,
      trend: dimTrendPoints,
    };
  });

  // 5. Comments
  // Rule R4: Gated on Round's total Submissions count >= N.
  // Comments are unlinked from ratings or member identity and shuffled randomly.
  const rawComments: Array<CommentResult> = [];
  if (shouldRevealResults) {
    for (const sub of submissions) {
      for (const ans of sub.answers) {
        if (ans.comment !== null && ans.comment.trim().length > 0) {
          rawComments.push({
            questionVersionId: ans.questionVersionId,
            text: ans.comment.trim(),
          });
        }
      }
    }
  }

  const finalComments = shuffleComments(rawComments);

  return {
    roundId,
    pulseId,
    teamId,
    status,
    plannedOpenDate,
    closedAt,
    effectiveMinimumGroupSize: effectiveN,
    meetsMinimumGroupSize: meetsRoundN,
    eligibleMembersCount,
    submissionsCount,
    responseRate,
    delayed,
    questions: finalQuestions,
    dimensions: finalDimensions,
    comments: finalComments,
  };
};

/**
 * When N is raised in Organization settings after a Result was computed,
 * apply the stricter effective N (Rule R9: max(stored N, current N)).
 * Lowering N never loosens past rounds.
 */
export const enforceEffectiveNOnResult = (result: RoundResult, currentOrgN: number): RoundResult => {
  const effectiveN = Math.max(result.effectiveMinimumGroupSize, currentOrgN);
  if (effectiveN === result.effectiveMinimumGroupSize) {
    return result;
  }

  const meetsRoundN = result.submissionsCount >= effectiveN;

  // Mask questions
  const maskedQuestions = result.questions.map((q) => {
    const meetsN = q.contributors >= effectiveN && meetsRoundN;
    if (meetsN) return q;
    return {
      ...q,
      meetsMinimumGroupSize: false,
      score: null,
      distribution: null,
      change: null,
    };
  });

  // Mask dimensions
  const maskedDimensions = result.dimensions.map((d) => {
    const usableQs = maskedQuestions.filter(
      (q) => q.dimension === d.dimension && q.meetsMinimumGroupSize && q.score !== null,
    );
    if (usableQs.length === 0 || !meetsRoundN) {
      return {
        ...d,
        meetsMinimumGroupSize: false,
        score: null,
        usableQuestionCount: 0,
        change: null,
      };
    }
    const sum = usableQs.reduce((acc, q) => acc + (q.score ?? 0), 0);
    const mean = roundDecimals(sum / usableQs.length, 2);
    return {
      ...d,
      score: mean,
      usableQuestionCount: usableQs.length,
      meetsMinimumGroupSize: true,
    };
  });

  // Mask comments if round fails effective N
  const maskedComments = meetsRoundN ? result.comments : [];

  return {
    ...result,
    effectiveMinimumGroupSize: effectiveN,
    meetsMinimumGroupSize: meetsRoundN,
    questions: maskedQuestions,
    dimensions: maskedDimensions,
    comments: maskedComments,
  };
};
