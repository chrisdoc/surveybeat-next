import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { estimateSeconds, pulseWarnings } from "./Editor.ts";
import { ChoiceOption, QuestionContent, QuestionType, ScaleLabel } from "./Question.ts";
import { TemplateQuestionKey, templateQuestion, weeklyTeamHealth } from "./Template.ts";

const en = weeklyTeamHealth("en");

describe("the weekly team health Template", () => {
  const questions = en.questions;

  it("has 5–6 Questions over the four Dimensions, with a rating first", () => {
    expect(questions.length).toBeGreaterThanOrEqual(5);
    expect(questions.length).toBeLessThanOrEqual(6);
    expect(questions[0]?.type._tag).toBe("Rating");
    expect(new Set(questions.map((question) => question.dimension))).toEqual(
      new Set(["workload", "psychologicalSafety", "clarity", "recognition"]),
    );
    expect(new Set(questions.map((question) => question.key)).size).toBe(questions.length);
  });

  it("holds only Questions its own schemas accept", () => {
    for (const question of questions) {
      expect(Schema.is(QuestionType)(question.type)).toBe(true);
      expect(
        Schema.is(QuestionContent)({
          text: question.text,
          type: question.type,
          dimension: question.dimension,
        }),
      ).toBe(true);

      if (question.type._tag === "Rating") {
        expect(Schema.is(ScaleLabel)(question.type.lowLabel)).toBe(true);
        expect(Schema.is(ScaleLabel)(question.type.highLabel)).toBe(true);
      }

      if (question.type._tag === "SingleChoice") {
        for (const option of question.type.options) {
          expect(Schema.is(ChoiceOption)(option)).toBe(true);
        }
      }
    }
  });

  it("starts a Pulse that needs no warning but the Team's size", () => {
    expect(estimateSeconds(questions)).toBeLessThanOrEqual(90);
    expect(pulseWarnings(questions, 4, 4)).toEqual([]);
  });

  it("keeps its name and first Question", () => {
    expect(en.name).toBe("Weekly team health");
    expect(en.questions[0]?.text).toBe("How manageable was your workload this week?");
  });
});

describe("templateQuestion", () => {
  const workload = TemplateQuestionKey.make("workload-manageable");

  it("returns the Question of the requested locale", () => {
    expect(templateQuestion(workload, "en")).toEqual(en.questions[0]);
  });

  it("returns undefined for a key the Template does not have", () => {
    const unknown = TemplateQuestionKey.make("no-such-question");
    expect(templateQuestion(unknown, "en")).toBeUndefined();
  });
});
