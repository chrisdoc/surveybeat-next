import { Schema } from "effect";
import { TeamId } from "../people/Team.ts";
import { QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import { enforceEffectiveNOnResult } from "./Results.ts";
import type { QuestionInput, RoundResult } from "./Results.ts";
import { RoundId } from "./Round.ts";
import type { RoundStatus } from "./Round.ts";

export const HistoryQuestion = Schema.Struct({
  questionVersionId: QuestionVersionId,
  position: Schema.Int,
  text: Schema.String,
  type: QuestionType,
  teamScore: Schema.NullOr(Schema.Finite),
});
export type HistoryQuestion = typeof HistoryQuestion.Type;

export const HistoryTeamResult = Schema.Literals(["shown", "notShared", "belowMinimumGroupSize"]);
export type HistoryTeamResult = typeof HistoryTeamResult.Type;

export const HistoryRound = Schema.Struct({
  roundId: RoundId,
  teamId: TeamId,
  teamName: Schema.String,
  pulseName: Schema.String,
  plannedOpenDate: Schema.String,
  teamResult: HistoryTeamResult,
  questions: Schema.Array(HistoryQuestion),
});
export type HistoryRound = typeof HistoryRound.Type;

export const MemberHistory = Schema.Struct({
  rounds: Schema.Array(HistoryRound),
});
export type MemberHistory = typeof MemberHistory.Type;

export interface MemberHistoryRoundInput {
  readonly roundId: RoundId;
  readonly teamId: TeamId;
  readonly teamName: string;
  readonly pulseName: string;
  readonly plannedOpenDate: string;
  readonly status: RoundStatus;
  readonly questions: readonly QuestionInput[];
  readonly result: RoundResult | null;
  readonly canViewResults: boolean;
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const historyRound = (input: MemberHistoryRoundInput, minimumGroupSize: number): HistoryRound => {
  const questions = [...input.questions].sort((a, b) => a.position - b.position);
  const base = {
    roundId: input.roundId,
    teamId: input.teamId,
    teamName: input.teamName,
    pulseName: input.pulseName,
    plannedOpenDate: input.plannedOpenDate,
  };
  const noScores = (teamResult: HistoryTeamResult): HistoryRound => ({
    ...base,
    teamResult,
    questions: questions.map((question) => toHistoryQuestion(question, null)),
  });

  if (input.status !== "shared" || !input.canViewResults || input.result === null) {
    return noScores("notShared");
  }

  const enforced = enforceEffectiveNOnResult(input.result, minimumGroupSize);
  if (!enforced.meetsMinimumGroupSize) return noScores("belowMinimumGroupSize");

  return {
    ...base,
    teamResult: "shown",
    questions: questions.map((question) => {
      const result = enforced.questions.find((each) => each.questionVersionId === question.id);
      const score =
        question.type._tag === "Rating" && result !== undefined && result.meetsMinimumGroupSize
          ? result.score
          : null;
      return toHistoryQuestion(question, score);
    }),
  };
};

const toHistoryQuestion = (question: QuestionInput, teamScore: number | null): HistoryQuestion => ({
  questionVersionId: question.id,
  position: question.position,
  text: question.text,
  type: question.type,
  teamScore,
});

export const buildMemberHistory = (params: {
  readonly rounds: readonly MemberHistoryRoundInput[];
  readonly minimumGroupSize: number;
}): MemberHistory => {
  const rounds = params.rounds
    .map((round) => historyRound(round, params.minimumGroupSize))
    .sort(
      (a, b) => compareStrings(b.plannedOpenDate, a.plannedOpenDate) || compareStrings(b.roundId, a.roundId),
    );
  return { rounds };
};
