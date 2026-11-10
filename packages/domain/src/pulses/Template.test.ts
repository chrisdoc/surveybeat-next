import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { estimateSeconds, pulseWarnings } from "./Editor.ts";
import { ChoiceOption, QuestionContent, QuestionType, ScaleLabel } from "./Question.ts";
import { TemplateQuestionKey, templateQuestion, weeklyTeamHealth } from "./Template.ts";

const en = weeklyTeamHealth("en");
const de = weeklyTeamHealth("de");

describe.each(["en", "de"] as const)("the weekly team health Template in %s", (locale) => {
  const template = weeklyTeamHealth(locale);
  const questions = template.questions;

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
    }
  });

  it("starts a Pulse that needs no warning but the Team's size", () => {
    expect(estimateSeconds(questions)).toBeLessThanOrEqual(90);
    expect(pulseWarnings(questions, 4, 4)).toEqual([]);
  });
});

describe("the English Template", () => {
  it("keeps its name and first Question", () => {
    expect(en.name).toBe("Weekly team health");
    expect(en.questions[0]?.text).toBe("How manageable was your workload this week?");
  });
});

describe("the German and English Templates", () => {
  it("have the same Question keys, in the same order", () => {
    expect(de.questions.map(({ key }) => key)).toEqual(en.questions.map(({ key }) => key));
  });

  it("have the same Dimension, type and comment flag for each Question", () => {
    for (const [index, english] of en.questions.entries()) {
      const german = de.questions[index];
      expect(german?.dimension).toBe(english.dimension);
      expect(german?.type._tag).toBe(english.type._tag);
      if (english.type._tag === "Rating" && german?.type._tag === "Rating") {
        expect(german.type.comment).toBe(english.type.comment);
      }
    }
  });

  it("have the same number of options in each SingleChoice Question", () => {
    for (const [index, english] of en.questions.entries()) {
      const german = de.questions[index];
      if (english.type._tag === "SingleChoice" && german?.type._tag === "SingleChoice") {
        expect(german.type.options).toHaveLength(english.type.options.length);
      }
    }
  });

  it("differ in the name and in the text of every Question", () => {
    expect(de.name).not.toBe(en.name);
    for (const [index, english] of en.questions.entries()) {
      expect(de.questions[index]?.text).not.toBe(english.text);
    }
  });

  it("decode every German Question, label and option with the Question schemas", () => {
    for (const question of de.questions) {
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
        for (const option of question.type.options) expect(Schema.is(ChoiceOption)(option)).toBe(true);
      }
    }
  });
});

describe("templateQuestion", () => {
  const workload = TemplateQuestionKey.make("workload-manageable");

  it("returns the Question in the requested language", () => {
    expect(templateQuestion(workload, "de")).toEqual(de.questions[0]);
    expect(templateQuestion(workload, "de")?.text).toBe(
      "Wie gut ließ sich dein Arbeitspensum diese Woche bewältigen?",
    );
    expect(templateQuestion(workload, "en")).toEqual(en.questions[0]);
  });

  it("returns undefined for a key the Template does not have", () => {
    const unknown = TemplateQuestionKey.make("no-such-question");
    expect(templateQuestion(unknown, "en")).toBeUndefined();
    expect(templateQuestion(unknown, "de")).toBeUndefined();
  });
});
