import { Schema } from "effect";
import { QuestionContent } from "./Question.ts";

/**
 * Names one Question of a Template. A Pulse copies the Question when it is added, so changing a
 * Template's text in code never changes a Pulse (GLOSSARY: Template). A new meaning needs a new key.
 */
export const TemplateQuestionKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,39}$/)),
  Schema.brand("TemplateQuestionKey"),
);
export type TemplateQuestionKey = typeof TemplateQuestionKey.Type;

export const TemplateQuestion = Schema.Struct({
  key: TemplateQuestionKey,
  ...QuestionContent.fields,
});
export type TemplateQuestion = typeof TemplateQuestion.Type;

export interface Template {
  readonly name: string;
  readonly questions: ReadonlyArray<TemplateQuestion>;
}

const key = (value: string) => TemplateQuestionKey.make(value);

/**
 * The weekly team health Template, the only one in Release 1. Its Questions are grouped by
 * Dimension; a new Pulse starts with all of them, in this order. The first is a rating, so the
 * Invitation email can offer one-tap answers (ADR 0007).
 */
export const WEEKLY_TEAM_HEALTH: Template = {
  name: "Weekly team health",
  questions: [
    {
      key: key("workload-manageable"),
      dimension: "workload",
      text: "How manageable was your workload this week?",
      type: { _tag: "Rating", lowLabel: "Not manageable", highLabel: "Very manageable", comment: true },
    },
    {
      key: key("safe-to-speak-up"),
      dimension: "psychologicalSafety",
      text: "How safe did you feel raising concerns or mistakes in the team?",
      type: { _tag: "Rating", lowLabel: "Not safe", highLabel: "Completely safe", comment: true },
    },
    {
      key: key("priorities-clear"),
      dimension: "clarity",
      text: "How clear were your priorities this week?",
      type: { _tag: "Rating", lowLabel: "Very unclear", highLabel: "Very clear", comment: false },
    },
    {
      key: key("work-recognised"),
      dimension: "recognition",
      text: "How recognised did you feel for your work this week?",
      type: { _tag: "Rating", lowLabel: "Not at all", highLabel: "Very much", comment: false },
    },
    {
      key: key("biggest-obstacle"),
      dimension: "workload",
      text: "What slowed you down most this week?",
      type: {
        _tag: "SingleChoice",
        options: [
          "Unclear goals",
          "Waiting on others",
          "Interruptions",
          "Too much work",
          "Nothing in particular",
        ],
      },
    },
    {
      key: key("shout-out"),
      dimension: "recognition",
      text: "What went well this week?",
      type: { _tag: "LongText" },
    },
  ],
};

export const templateQuestion = (questionKey: TemplateQuestionKey): TemplateQuestion | undefined =>
  WEEKLY_TEAM_HEALTH.questions.find((question) => question.key === questionKey);
