import { Schema } from "effect";
import { TeamId } from "../people/Team.ts";
import { QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import { enforceEffectiveNOnResult, type QuestionInput, type RoundResult } from "./Results.ts";
import { RoundId, type RoundStatus } from "./Round.ts";

/**
 * One Question of a Round in the member's history. `teamScore` is the Team's score for it, only when
 * the Round is shown and the Question is a Rating that meets the minimum group size (ADR 0004).
 */
export const HistoryQuestion = Schema.Struct({
  questionVersionId: QuestionVersionId,
  position: Schema.Int,
  text: Schema.String,
  type: QuestionType,
  teamScore: Schema.NullOr(Schema.Finite),
});
export type HistoryQuestion = typeof HistoryQuestion.Type;

/**
 * Why a Round's Team scores are or are not shown: not shared (or not visible to the member), below
 * the minimum group size, or shown.
 */
export const HistoryTeamResult = Schema.Literals(["shown", "notShared", "belowMinimumGroupSize"]);
export type HistoryTeamResult = typeof HistoryTeamResult.Type;

/** One Round the signed-in Person took part in. Carries no Submission data (ADR 0017). */
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

/** The signed-in Person's Rounds, newest first. */
export const MemberHistory = Schema.Struct({
  rounds: Schema.Array(HistoryRound),
});
export type MemberHistory = typeof MemberHistory.Type;

/** What the history needs about one Round the Person took part in. */
export interface MemberHistoryRoundInput {
  readonly roundId: RoundId;
  readonly teamId: TeamId;
  readonly teamName: string;
  readonly pulseName: string;
  readonly plannedOpenDate: string;
  readonly status: RoundStatus;
  readonly questions: ReadonlyArray<QuestionInput>;
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

  // The Round's own status decides, not the stored payload, which can lag behind sharing.
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

/**
 * Builds the signed-in Person's history. Each Round's Team scores follow the same rules as the
 * Round's Result: shown only when shared, visible to the member, and at least N under the stricter
 * of the stored and the current minimum group size (ADR 0004, ADR 0017).
 */
export const buildMemberHistory = (params: {
  readonly rounds: ReadonlyArray<MemberHistoryRoundInput>;
  readonly minimumGroupSize: number;
}): MemberHistory => {
  const rounds = params.rounds
    .map((round) => historyRound(round, params.minimumGroupSize))
    .sort(
      (a, b) => compareStrings(b.plannedOpenDate, a.plannedOpenDate) || compareStrings(b.roundId, a.roundId),
    );
  return { rounds };
};
