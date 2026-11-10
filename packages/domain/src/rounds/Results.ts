import { Effect, Schema } from "effect";
import { TeamId } from "../people/Team.ts";
import { AnonymityMode, PulseId } from "../pulses/Pulse.ts";
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
  /**
   * Contributors to the Dimension in that Round (see `DimensionResult.contributors`). Optional so
   * payloads stored before this field existed still decode; absent means unknown.
   */
  contributors: Schema.optionalKey(Schema.Int),
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
  /**
   * Contributors to the Dimension: Submissions that gave a value to at least one of its usable
   * Questions. Null when the Dimension is hidden by the minimum group size. Optional so payloads
   * stored before this field existed still decode; absent means unknown.
   */
  contributors: Schema.optionalKey(Schema.NullOr(Schema.Int)),
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

/** A Comment theme as shown (ADR 0016). `supportingComments` is Lead only; members never get it. */
export const CommentTheme = Schema.Struct({
  label: Schema.String,
  sentence: Schema.String,
  supportingComments: Schema.optionalKey(Schema.Int),
});
export type CommentTheme = typeof CommentTheme.Type;

/** The Round's discussion guide (ADR 0019), Lead only. */
export const DiscussionGuide = Schema.Struct({
  whatStoodOut: Schema.Array(Schema.String),
  whatPeopleRaised: Schema.Array(Schema.String),
  actionsToCheckOn: Schema.Array(Schema.String),
  questions: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMaxLength(3))),
});
export type DiscussionGuide = typeof DiscussionGuide.Type;

/**
 * notRequested: AI off at close, closed before AI was on, or below N. preparing: call pending.
 * ready: stored. unavailable: gave up after 24 h.
 */
export const ThemesStatus = Schema.Literals(["notRequested", "preparing", "ready", "unavailable"]);
export type ThemesStatus = typeof ThemesStatus.Type;

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
  /** Release 1 has only anonymous Rounds, so Results stored before this field decode as anonymous. */
  anonymityMode: AnonymityMode.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed<AnonymityMode>("anonymous")),
  ),
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
  /** Optional so stored payloads decode without them; the view sets them (ADR 0016, 0019). */
  themesStatus: Schema.optionalKey(ThemesStatus),
  themes: Schema.optionalKey(Schema.Array(CommentTheme)),
  /** Lead only. */
  discussionGuide: Schema.optionalKey(Schema.NullOr(DiscussionGuide)),
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
  /** Dimension contributors of that Round, when known (older stored Results lack it). */
  readonly contributors?: number | null | undefined;
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
 * Contributors of a past Round's Dimension for its trend point: the stored value when present,
 * otherwise the largest contributor count among that Round's Questions of the Dimension
 * (a lower bound of the distinct count; enough to apply the minimum group size).
 */
const pastDimContributors = (
  pastDim: HistoricalRoundDimensionData,
  past: HistoricalRoundData,
  questions: ReadonlyArray<QuestionInput>,
): { readonly contributors?: number } => {
  if (pastDim.contributors !== undefined && pastDim.contributors !== null) {
    return { contributors: pastDim.contributors };
  }
  const ids = new Set<string>(questions.filter((q) => q.dimension === pastDim.dimension).map((q) => q.id));
  const counts = past.questions.filter((pq) => ids.has(pq.questionVersionId)).map((pq) => pq.contributors);
  return counts.length === 0 ? {} : { contributors: Math.max(...counts) };
};

/**
 * Whether a past Round's Dimension score may be shown at `pastEffectiveN`. When N has been raised
 * since that Round, every Question its score averaged must still meet the raised N (ADR 0004);
 * if those Questions cannot be matched, the score stays hidden.
 */
const pastDimMeetsN = (
  pastDim: HistoricalRoundDimensionData,
  past: HistoricalRoundData,
  questions: ReadonlyArray<QuestionInput>,
  pastEffectiveN: number,
): boolean => {
  if (pastDim.score === null || !pastDim.meetsMinimumGroupSize || past.submissionsCount < pastEffectiveN) {
    return false;
  }
  if (pastEffectiveN <= past.effectiveMinimumGroupSize) return true;
  if (
    pastDim.contributors !== undefined &&
    pastDim.contributors !== null &&
    pastDim.contributors < pastEffectiveN
  ) {
    return false;
  }
  const ids = new Set<string>(questions.filter((q) => q.dimension === pastDim.dimension).map((q) => q.id));
  const averaged = past.questions.filter((pq) => ids.has(pq.questionVersionId) && pq.score !== null);
  return (
    averaged.length > 0 &&
    averaged.length === pastDim.usableQuestionCount &&
    averaged.every((pq) => pq.contributors >= pastEffectiveN)
  );
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
  readonly anonymityMode: AnonymityMode;
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
    anonymityMode,
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
    readonly contributors: number | null;
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
        contributors: null,
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
        contributors: null,
        meetsN: false,
      });
    } else {
      const sum = usableQuestions.reduce((acc, q) => acc + (q.score ?? 0), 0);
      const mean = roundDecimals(sum / usableQuestions.length, 2);
      const usableIds = new Set<string>(usableQuestions.map((tqs) => tqs.question.id));
      const dimContributors = submissions.filter((sub) =>
        sub.answers.some((ans) => ans.value !== null && usableIds.has(ans.questionVersionId)),
      ).length;
      tempDimensionScores.push({
        dimension: dim,
        score: mean,
        usableQuestionCount: usableQuestions.length,
        totalQuestionCount: totalCount,
        contributors: dimContributors,
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
      const pastUsable = pastDim !== undefined && pastDimMeetsN(pastDim, past, questions, pastEffectiveN);

      dimTrendPoints.push({
        roundId: past.roundId,
        plannedOpenDate: past.plannedOpenDate,
        score: pastUsable && pastDim ? pastDim.score : null,
        usableQuestionCount: pastDim ? pastDim.usableQuestionCount : 0,
        ...(pastDim !== undefined ? pastDimContributors(pastDim, past, questions) : {}),
        hasGap: !pastUsable,
      });
    }

    dimTrendPoints.push({
      roundId,
      plannedOpenDate,
      score: tds.score,
      usableQuestionCount: tds.usableQuestionCount,
      ...(tds.contributors !== null ? { contributors: tds.contributors } : {}),
      hasGap: !tds.meetsN,
    });

    if (!tds.meetsN || tds.score === null) {
      return {
        dimension: dim,
        score: null,
        usableQuestionCount: tds.usableQuestionCount,
        totalQuestionCount: tds.totalQuestionCount,
        contributors: null,
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
      if (pastDim !== undefined && pastDimMeetsN(pastDim, past, questions, pastEffectiveN)) {
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
      contributors: tds.contributors,
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
    anonymityMode,
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

/** Minimal shape shared by Question and Dimension trend points. */
interface MaskableTrendPoint {
  readonly roundId: RoundId;
  readonly score: number | null;
  readonly contributors?: number | undefined;
  readonly hasGap: boolean;
}

/**
 * Applies an effective N to the earlier Rounds' trend points (everything except the current Round's
 * point, which the caller rebuilds from the masked current aggregate). A point whose contributors are
 * unknown or below N loses its score. Earlier Rounds' own stored N was already applied when the trend
 * was built, so only the raised Organization N needs checking here. Returns the points and the
 * Rounds whose visible score was newly hidden.
 */
const maskEarlierTrendPoints = <P extends MaskableTrendPoint>(
  points: ReadonlyArray<P>,
  currentRoundId: RoundId,
  effectiveN: number,
): { readonly points: ReadonlyArray<P>; readonly newlyMasked: ReadonlySet<RoundId> } => {
  const newlyMasked = new Set<RoundId>();
  const masked = points.map((p) => {
    if (p.roundId === currentRoundId || p.score === null) return p;
    if (p.contributors !== undefined && p.contributors >= effectiveN) return p;
    newlyMasked.add(p.roundId);
    return { ...p, score: null, hasGap: true };
  });
  return { points: masked, newlyMasked };
};

/**
 * When N is raised in Organization settings after a Result was computed,
 * apply the stricter effective N (Rule R9: max(stored N, current N)).
 * Lowering N never loosens past rounds.
 *
 * Everything derived from a now-hidden score is hidden with it: the trend points (the current
 * Round's point mirrors the masked aggregate), the change, and the Typical change (which is computed
 * from the earlier Rounds' scores and cannot be recomputed here, so it is dropped whenever one of
 * those scores is newly hidden).
 */
export const enforceEffectiveNOnResult = (result: RoundResult, currentOrgN: number): RoundResult => {
  const effectiveN = Math.max(result.effectiveMinimumGroupSize, currentOrgN);
  if (effectiveN === result.effectiveMinimumGroupSize) {
    return result;
  }

  const meetsRoundN = result.submissionsCount >= effectiveN;

  // Mask questions
  const maskedQuestions = result.questions.map((q): QuestionResult => {
    const meetsN = q.contributors >= effectiveN && meetsRoundN;
    const earlier = maskEarlierTrendPoints(q.trend, result.roundId, effectiveN);
    const trend = earlier.points.map((p) =>
      p.roundId === result.roundId && !meetsN ? { ...p, score: null, hasGap: true } : p,
    );
    const earlierChanged = earlier.newlyMasked.size > 0;
    if (meetsN) {
      if (!earlierChanged) return q;
      return {
        ...q,
        change:
          q.change !== null &&
          q.change.previousRoundId !== null &&
          earlier.newlyMasked.has(q.change.previousRoundId)
            ? null
            : q.change,
        typicalChange: null,
        trend,
      };
    }
    return {
      ...q,
      meetsMinimumGroupSize: false,
      score: null,
      distribution: null,
      change: null,
      typicalChange: null,
      trend,
    };
  });

  // Mask dimensions
  const maskedDimensions = result.dimensions.map((d): DimensionResult => {
    const dimensionQuestions = result.questions.filter((q) => q.dimension === d.dimension);
    // Earlier Rounds whose score of one of this Dimension's Questions is newly hidden: the
    // Dimension's change and Typical change average those Question scores, so they are stale.
    const questionMasked = new Set<RoundId>();
    for (const q of dimensionQuestions) {
      for (const id of maskEarlierTrendPoints(q.trend, result.roundId, effectiveN).newlyMasked) {
        questionMasked.add(id);
      }
    }
    // An earlier Dimension score is the mean of that Round's visible Question scores, so it may stay
    // only if every Question it averaged still meets the effective N (same rule as `pastDimMeetsN`).
    const base = maskEarlierTrendPoints(d.trend, result.roundId, effectiveN);
    const newlyMasked = new Set<RoundId>(base.newlyMasked);
    const earlier = {
      newlyMasked,
      points: base.points.map((p) => {
        if (p.roundId === result.roundId || p.score === null) return p;
        const averaged = dimensionQuestions.flatMap((q) =>
          q.trend.filter((t) => t.roundId === p.roundId && t.score !== null),
        );
        if (
          averaged.length > 0 &&
          averaged.length === p.usableQuestionCount &&
          averaged.every((t) => t.contributors >= effectiveN)
        ) {
          return p;
        }
        newlyMasked.add(p.roundId);
        return { ...p, score: null, hasGap: true };
      }),
    };
    const withCurrent = (
      current: Pick<DimensionTrendPoint, "score" | "usableQuestionCount" | "hasGap"> & {
        readonly contributors: number | null;
      },
    ): ReadonlyArray<DimensionTrendPoint> =>
      earlier.points.map((p) => {
        if (p.roundId !== result.roundId) return p;
        const { contributors: _previous, ...rest } = p;
        return {
          ...rest,
          score: current.score,
          usableQuestionCount: current.usableQuestionCount,
          ...(current.contributors !== null ? { contributors: current.contributors } : {}),
          hasGap: current.hasGap,
        };
      });

    const usableQs = maskedQuestions.filter(
      (q) => q.dimension === d.dimension && q.meetsMinimumGroupSize && q.score !== null,
    );
    if (usableQs.length === 0 || !meetsRoundN) {
      return {
        ...d,
        meetsMinimumGroupSize: false,
        score: null,
        usableQuestionCount: 0,
        contributors: null,
        change: null,
        typicalChange: null,
        trend: withCurrent({ score: null, usableQuestionCount: 0, contributors: null, hasGap: true }),
      };
    }
    const sum = usableQs.reduce((acc, q) => acc + (q.score ?? 0), 0);
    const mean = roundDecimals(sum / usableQs.length, 2);
    const usableSetChanged = usableQs.length !== d.usableQuestionCount;
    // Distinct contributors cannot be recounted without Submissions. When the usable Questions are
    // unchanged the stored count still holds; otherwise use the largest remaining Question count
    // (a lower bound, and every usable Question has at least N contributors).
    const contributors = usableSetChanged
      ? Math.max(...usableQs.map((q) => q.contributors))
      : (d.contributors ?? Math.max(...usableQs.map((q) => q.contributors)));
    const earlierChanged = newlyMasked.size > 0 || questionMasked.size > 0;
    const changeStale =
      usableSetChanged ||
      (d.change !== null &&
        d.change.previousRoundId !== null &&
        (newlyMasked.has(d.change.previousRoundId) || questionMasked.has(d.change.previousRoundId)));
    return {
      ...d,
      score: mean,
      usableQuestionCount: usableQs.length,
      contributors,
      meetsMinimumGroupSize: true,
      change: changeStale ? null : d.change,
      typicalChange: earlierChanged || usableSetChanged ? null : d.typicalChange,
      trend: withCurrent({ score: mean, usableQuestionCount: usableQs.length, contributors, hasGap: false }),
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
