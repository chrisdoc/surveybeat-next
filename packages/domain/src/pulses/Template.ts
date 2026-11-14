import { Schema } from "effect";
import type { Locale } from "../people/Locale.ts";
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
 * The weekly team health Template in each language Release 2 ships (ADR 0018). Its Questions are
 * grouped by Dimension; a new Pulse starts with all of them, in this order. The first is a rating,
 * so the Invitation email can offer one-tap answers (ADR 0007). Every language has the same keys,
 * Dimensions, types and options in the same order: only the wording differs, and a Pulse copies the
 * Lead's language when it is created. The keys are language-independent.
 */
const WEEKLY_TEAM_HEALTH: { readonly [L in Locale]: Template } = {
  en: {
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
  },
  de: {
    name: "Wöchentlicher Team-Check",
    questions: [
      {
        key: key("workload-manageable"),
        dimension: "workload",
        text: "Wie gut ließ sich dein Arbeitspensum diese Woche bewältigen?",
        type: {
          _tag: "Rating",
          lowLabel: "Nicht zu bewältigen",
          highLabel: "Sehr gut zu bewältigen",
          comment: true,
        },
      },
      {
        key: key("safe-to-speak-up"),
        dimension: "psychologicalSafety",
        text: "Wie sicher hast du dich gefühlt, Bedenken oder Fehler im Team anzusprechen?",
        type: { _tag: "Rating", lowLabel: "Nicht sicher", highLabel: "Völlig sicher", comment: true },
      },
      {
        key: key("priorities-clear"),
        dimension: "clarity",
        text: "Wie klar waren deine Prioritäten diese Woche?",
        type: { _tag: "Rating", lowLabel: "Sehr unklar", highLabel: "Sehr klar", comment: false },
      },
      {
        key: key("work-recognised"),
        dimension: "recognition",
        text: "Wie sehr hast du dich diese Woche für deine Arbeit wertgeschätzt gefühlt?",
        type: { _tag: "Rating", lowLabel: "Überhaupt nicht", highLabel: "Voll und ganz", comment: false },
      },
      {
        key: key("biggest-obstacle"),
        dimension: "workload",
        text: "Was hat dich diese Woche am meisten ausgebremst?",
        type: {
          _tag: "SingleChoice",
          options: [
            "Unklare Ziele",
            "Warten auf andere",
            "Unterbrechungen",
            "Zu viel Arbeit",
            "Nichts Besonderes",
          ],
        },
      },
      {
        key: key("shout-out"),
        dimension: "recognition",
        text: "Was lief diese Woche gut?",
        type: { _tag: "LongText" },
      },
    ],
  },
};

/** The weekly team health Template in `locale`: the same Questions, keys and order in every language. */
export const weeklyTeamHealth = (locale: Locale): Template => WEEKLY_TEAM_HEALTH[locale];

/** The Question with `questionKey` in `locale`, if the Template has one. */
export const templateQuestion = (
  questionKey: TemplateQuestionKey,
  locale: Locale,
): TemplateQuestion | undefined =>
  weeklyTeamHealth(locale).questions.find((question) => question.key === questionKey);
