// @effect-diagnostics globalRandom:off -- the shuffle is the deliberate unlinkability step (A4); its whole point is a non-deterministic order, not reproducible randomness.

import { Effect, Schema } from "effect";
import { TeamId } from "../people/Team.ts";
import { AnonymityMode, PulseId } from "../pulses/Pulse.ts";
import { Dimension, QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import { calculateRoundResult as calculateRoundResultWith } from "./CalculateRoundResult.ts";
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
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    const val = sorted[mid];

    return val ?? 0;
  }

  const low = sorted[mid - 1];
  const high = sorted[mid];

  if (low === undefined || high === undefined) {
    return 0;
  }

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

export const calculateRoundResult = calculateRoundResultWith({
  roundDecimals,
  median,
  computeDistribution,
  evaluateHighlight,
  shuffleComments,
});

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
    if (p.roundId === currentRoundId || p.score === null) {
      return p;
    }

    if (p.contributors !== undefined && p.contributors >= effectiveN) {
      return p;
    }

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
      if (!earlierChanged) {
        return q;
      }

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
        if (p.roundId === result.roundId || p.score === null) {
          return p;
        }

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
        if (p.roundId !== result.roundId) {
          return p;
        }

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
