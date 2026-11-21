import type { TeamId } from "../people/Team.ts";
import type { AnonymityMode, PulseId } from "../pulses/Pulse.ts";
import type { Dimension, QuestionType } from "../pulses/Question.ts";
import type {
  CommentResult,
  DimensionChange,
  DimensionResult,
  DimensionTrendPoint,
  DistributionOption,
  Highlight,
  HistoricalRoundData,
  HistoricalRoundDimensionData,
  QuestionChange,
  QuestionInput,
  QuestionResult,
  RoundResult,
  TrendPoint,
  TypicalChange,
} from "./Results.ts";
import type { RoundId, RoundStatus } from "./Round.ts";
import type { SubmissionAnswer } from "./Submission.ts";

const pastDimContributors = (
  pastDim: HistoricalRoundDimensionData,
  past: HistoricalRoundData,
  questions: readonly QuestionInput[],
): { readonly contributors?: number } => {
  if (pastDim.contributors !== undefined && pastDim.contributors !== null) {
    return { contributors: pastDim.contributors };
  }

  const ids = new Set<string>(questions.flatMap((q) => (q.dimension === pastDim.dimension ? [q.id] : [])));
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

  if (pastEffectiveN <= past.effectiveMinimumGroupSize) {
    return true;
  }

  if (
    pastDim.contributors !== undefined &&
    pastDim.contributors !== null &&
    pastDim.contributors < pastEffectiveN
  ) {
    return false;
  }

  const ids = new Set<string>(questions.flatMap((q) => (q.dimension === pastDim.dimension ? [q.id] : [])));
  const averaged = past.questions.filter((pq) => ids.has(pq.questionVersionId) && pq.score !== null);

  return (
    averaged.length > 0 &&
    averaged.length === pastDim.usableQuestionCount &&
    averaged.every((pq) => pq.contributors >= pastEffectiveN)
  );
};

export const calculateRoundResult =
  (dependencies: {
    readonly roundDecimals: (value: number, decimals: number) => number;
    readonly median: (values: readonly number[]) => number;
    readonly computeDistribution: (
      type: QuestionType,
      answers: readonly SubmissionAnswer[],
    ) => readonly DistributionOption[];
    readonly evaluateHighlight: (change: number, typicalChangeVal: number) => Highlight;
    readonly shuffleComments: (comments: readonly CommentResult[]) => readonly CommentResult[];
  }) =>
  (params: {
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
    const { roundDecimals, median, computeDistribution, evaluateHighlight, shuffleComments } = dependencies;

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
