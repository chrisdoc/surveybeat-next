import { TeamId } from "../people/Team.ts";
import { PulseId } from "../pulses/Pulse.ts";
import type { QuestionType } from "../pulses/Question.ts";
import { QuestionVersionId } from "../pulses/Question.ts";
import type { QuestionInput } from "./Results.ts";
import { RoundId } from "./Round.ts";

export const PULSE_ID = PulseId.make("pulse-1");

export const TEAM_ID = TeamId.make("team-1");

export const ROUND_1 = RoundId.make("round-1");

export const Q1 = QuestionVersionId.make("q-1.1");

export const Q2 = QuestionVersionId.make("q-2.1");

export const Q3_CHOICE = QuestionVersionId.make("q-3.1");

export const ratingType: QuestionType = {
  _tag: "Rating",
  lowLabel: "Low",
  highLabel: "High",
  comment: true,
};

export const choiceType: QuestionType = {
  _tag: "SingleChoice",
  options: ["Option A", "Option B", "Option C"],
};

export const testQuestions: readonly QuestionInput[] = [
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
