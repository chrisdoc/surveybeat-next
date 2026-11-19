// @effect-diagnostics globalRandom:off -- the shuffle is the deliberate unlinkability step (A4); its whole point is a non-deterministic order, not reproducible randomness.

import { Effect, Schema } from "effect";
import { TeamId } from "../people/Team.ts";
import { AnonymityMode, PulseId } from "../pulses/Pulse.ts";
import { Dimension, QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import { RoundId, RoundStatus } from "./Round.ts";
import type { SubmissionAnswer } from "./Submission.ts";

export const DistributionOption = Schema.Struct({
  option: Schema.Union([Schema.String, Schema.Int]),
  count: Schema.Int,
});
export type DistributionOption = typeof DistributionOption.Type;

export const TrendPoint = Schema.Struct({
  roundId: RoundId,
  plannedOpenDate: Schema.String,
  score: Schema.NullOr(Schema.Finite),
  contributors: Schema.Int,
  hasGap: Schema.Boolean,
});
export type TrendPoint = typeof TrendPoint.Type;

export const DimensionTrendPoint = Schema.Struct({
  roundId: RoundId,
  plannedOpenDate: Schema.String,
  score: Schema.NullOr(Schema.Finite),
  usableQuestionCount: Schema.Int,

  contributors: Schema.optionalKey(Schema.Int),
  hasGap: Schema.Boolean,
});
export type DimensionTrendPoint = typeof DimensionTrendPoint.Type;

export const Highlight = Schema.Struct({
  isLargerThanUsual: Schema.Boolean,
  direction: Schema.NullOr(Schema.Literals(["rise", "drop"])),
});
export type Highlight = typeof Highlight.Type;

export const TypicalChange = Schema.Struct({
  status: Schema.Literals(["buildingBaseline", "ready"]),
  completedUsableRounds: Schema.Int,
  totalRequiredUsableRounds: Schema.Int,
  typicalChange: Schema.NullOr(Schema.Finite),
});
export type TypicalChange = typeof TypicalChange.Type;

export const QuestionChange = Schema.Struct({
  change: Schema.NullOr(Schema.Finite),
  previousRoundDate: Schema.NullOr(Schema.String),
  previousRoundId: Schema.NullOr(RoundId),
  highlight: Schema.NullOr(Highlight),
});
export type QuestionChange = typeof QuestionChange.Type;

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

export const DimensionResult = Schema.Struct({
  dimension: Dimension,
  score: Schema.NullOr(Schema.Finite),
  usableQuestionCount: Schema.Int,
  totalQuestionCount: Schema.Int,

  contributors: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  meetsMinimumGroupSize: Schema.Boolean,
  change: Schema.NullOr(DimensionChange),
  typicalChange: Schema.NullOr(TypicalChange),
  trend: Schema.Array(DimensionTrendPoint),
});
export type DimensionResult = typeof DimensionResult.Type;

export const CommentResult = Schema.Struct({
  questionVersionId: QuestionVersionId,
  text: Schema.String,
});
export type CommentResult = typeof CommentResult.Type;

export const CommentTheme = Schema.Struct({
  label: Schema.String,
  sentence: Schema.String,
  supportingComments: Schema.optionalKey(Schema.Int),
});
export type CommentTheme = typeof CommentTheme.Type;

export const DiscussionGuide = Schema.Struct({
  whatStoodOut: Schema.Array(Schema.String),
  whatPeopleRaised: Schema.Array(Schema.String),
  actionsToCheckOn: Schema.Array(Schema.String),
  questions: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMaxLength(3))),
});
export type DiscussionGuide = typeof DiscussionGuide.Type;

export const ThemesStatus = Schema.Literals(["notRequested", "preparing", "ready", "unavailable"]);
export type ThemesStatus = typeof ThemesStatus.Type;

export const RoundResult = Schema.Struct({
  roundId: RoundId,
  pulseId: PulseId,
  teamId: TeamId,
  status: RoundStatus,
  plannedOpenDate: Schema.String,

  pulseName: Schema.optionalKey(Schema.String),

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

  themesStatus: Schema.optionalKey(ThemesStatus),
  themes: Schema.optionalKey(Schema.Array(CommentTheme)),

  discussionGuide: Schema.optionalKey(Schema.NullOr(DiscussionGuide)),

  reviewEndsAt: Schema.optionalKey(Schema.Int),

  couldNotCompute: Schema.optionalKey(Schema.Boolean),
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

export const roundDecimals = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export const median = (values: readonly number[]): number => {
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

  readonly contributors?: number | null | undefined;
  readonly meetsMinimumGroupSize: boolean;
}

export interface HistoricalRoundData {
  readonly roundId: RoundId;
  readonly plannedOpenDate: string;
  readonly closedAt: number | null;
  readonly effectiveMinimumGroupSize: number;
  readonly submissionsCount: number;
  readonly questions: readonly HistoricalRoundQuestionData[];
  readonly dimensions: readonly HistoricalRoundDimensionData[];
}

export const computeDistribution = (
  type: QuestionType,
  answers: readonly SubmissionAnswer[],
): readonly DistributionOption[] => {
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

export const evaluateHighlight = (change: number, typicalChangeVal: number): Highlight => {
  const absChange = roundDecimals(Math.abs(change), 4);
  const threshold = roundDecimals(2 * typicalChangeVal, 4);
  const isLarger = absChange >= threshold && absChange >= 0.3;
  const direction = change > 0 ? ("rise" as const) : change < 0 ? ("drop" as const) : null;

  return { isLargerThanUsual: isLarger, direction };
};

export const shuffleComments = (comments: readonly CommentResult[]): readonly CommentResult[] => {
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

const pastDimContributors = (
  pastDim: HistoricalRoundDimensionData,
  past: HistoricalRoundData,
  questions: readonly QuestionInput[],
): { readonly contributors?: number } => {
  if (pastDim.contributors !== undefined && pastDim.contributors !== null) {
    return { contributors: pastDim.contributors };
  }
  const ids = new Set<string>(questions.filter((q) => q.dimension === pastDim.dimension).map((q) => q.id));
  const counts = past.questions.filter((pq) => ids.has(pq.questionVersionId)).map((pq) => pq.contributors);
  return counts.length === 0 ? {} : { contributors: Math.max(...counts) };
};

const pastDimMeetsN = (
  pastDim: HistoricalRoundDimensionData,
  past: HistoricalRoundData,
  questions: readonly QuestionInput[],
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
  readonly questions: readonly QuestionInput[];
  readonly submissions: readonly {
    readonly id: string;
    readonly answers: readonly SubmissionAnswer[];
  }[];
  readonly pastRoundsHistory: readonly HistoricalRoundData[];
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

  const isClosedOrLater = status === "closed" || status === "ready" || status === "shared";
  const shouldRevealResults = isClosedOrLater && meetsRoundN;

  const answersByQuestion = new Map<string, SubmissionAnswer[]>();
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

  interface TempQuestionScore {
    readonly question: QuestionInput;
    readonly contributors: number;
    readonly meetsN: boolean;
    readonly score: number | null;
    readonly distribution: readonly DistributionOption[] | null;
  }

  const tempQuestionScores: TempQuestionScore[] = [];

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

  const dimensionsToEvaluate: readonly Dimension[] = [
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

  const tempDimensionScores: TempDimensionScore[] = [];

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

  const pastUpTo11 = pastRoundsHistory.slice(-11);

  const finalQuestions: QuestionResult[] = tempQuestionScores.map((tqs) => {
    const q = tqs.question;

    const trendPoints: TrendPoint[] = [];
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
        trend: q.type._tag === "Rating" ? trendPoints : [],
      };
    }

    interface UsablePastQuestionRound {
      readonly roundId: RoundId;
      readonly plannedOpenDate: string;
      readonly score: number;
    }

    const pastUsableRounds: UsablePastQuestionRound[] = [];
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

    const pastDifferences: number[] = [];
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
      const diffsToUse = pastDifferences.slice(-11);
      typicalChangeVal = median(diffsToUse);
      typicalChangeObj = {
        status: "ready",
        completedUsableRounds: completedUsableCount,
        totalRequiredUsableRounds: 6,
        typicalChange: typicalChangeVal,
      };
    }

    const mostRecentPastUsable = pastUsableRounds.at(-1);
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

  const finalDimensions: DimensionResult[] = tempDimensionScores.map((tds) => {
    const dim = tds.dimension;

    const dimTrendPoints: DimensionTrendPoint[] = [];
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

    interface UsablePastDimRound {
      readonly roundId: RoundId;
      readonly plannedOpenDate: string;
      readonly roundData: HistoricalRoundData;
    }

    const usablePastDimRounds: UsablePastDimRound[] = [];
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

    const pastDimDifferences: number[] = [];
    for (let i = 1; i < usablePastDimRounds.length; i++) {
      const prev = usablePastDimRounds[i - 1];
      const curr = usablePastDimRounds[i];
      if (prev !== undefined && curr !== undefined) {
        const prevEffectiveN = Math.max(prev.roundData.effectiveMinimumGroupSize, effectiveN);
        const currEffectiveN = Math.max(curr.roundData.effectiveMinimumGroupSize, effectiveN);

        const dimQuestions = questions.filter((q) => q.dimension === dim && q.type._tag === "Rating");
        const perQuestionChanges: number[] = [];

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

    const mostRecentPastUsable = usablePastDimRounds.at(-1);
    let changeObj: DimensionChange | null = null;

    if (mostRecentPastUsable !== undefined) {
      const pastEffectiveN = Math.max(mostRecentPastUsable.roundData.effectiveMinimumGroupSize, effectiveN);
      const dimQuestions = questions.filter((q) => q.dimension === dim && q.type._tag === "Rating");
      const perQuestionChanges: number[] = [];

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

  const rawComments: CommentResult[] = [];
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

export const delayedRoundResult = (params: {
  readonly roundId: RoundId;
  readonly pulseId: PulseId;
  readonly teamId: TeamId;
  readonly status: RoundStatus;
  readonly plannedOpenDate: string;
  readonly anonymityMode: AnonymityMode;
  readonly closedAt: number | null;
  readonly effectiveMinimumGroupSize: number;
  readonly eligibleMembersCount: number;
  readonly submissionsCount: number;
}): RoundResult => {
  const { submissionsCount, eligibleMembersCount, effectiveMinimumGroupSize } = params;
  return {
    roundId: params.roundId,
    pulseId: params.pulseId,
    teamId: params.teamId,
    status: params.status,
    plannedOpenDate: params.plannedOpenDate,
    anonymityMode: params.anonymityMode,
    closedAt: params.closedAt,
    effectiveMinimumGroupSize,
    meetsMinimumGroupSize: submissionsCount >= effectiveMinimumGroupSize,
    eligibleMembersCount,
    submissionsCount,
    responseRate: eligibleMembersCount > 0 ? roundDecimals(submissionsCount / eligibleMembersCount, 4) : null,
    delayed: true,
    questions: [],
    dimensions: [],
    comments: [],
  };
};

interface MaskableTrendPoint {
  readonly roundId: RoundId;
  readonly score: number | null;
  readonly contributors?: number | undefined;
  readonly hasGap: boolean;
}

const maskEarlierTrendPoints = <P extends MaskableTrendPoint>(
  points: readonly P[],
  currentRoundId: RoundId,
  effectiveN: number,
): { readonly points: readonly P[]; readonly newlyMasked: ReadonlySet<RoundId> } => {
  const newlyMasked = new Set<RoundId>();
  const masked = points.map((p) => {
    if (p.roundId === currentRoundId || p.score === null) return p;
    if (p.contributors !== undefined && p.contributors >= effectiveN) return p;
    newlyMasked.add(p.roundId);
    return { ...p, score: null, hasGap: true };
  });
  return { points: masked, newlyMasked };
};

export const enforceEffectiveNOnResult = (result: RoundResult, currentOrgN: number): RoundResult => {
  const effectiveN = Math.max(result.effectiveMinimumGroupSize, currentOrgN);
  if (effectiveN === result.effectiveMinimumGroupSize) {
    return result;
  }

  const meetsRoundN = result.submissionsCount >= effectiveN;

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

  const maskedDimensions = result.dimensions.map((d): DimensionResult => {
    const dimensionQuestions = result.questions.filter((q) => q.dimension === d.dimension);
    const questionMasked = new Set<RoundId>();
    for (const q of dimensionQuestions) {
      for (const id of maskEarlierTrendPoints(q.trend, result.roundId, effectiveN).newlyMasked) {
        questionMasked.add(id);
      }
    }
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
    ): readonly DimensionTrendPoint[] =>
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
