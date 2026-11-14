import { Schema } from "effect";

export const QuestionId = Schema.String.pipe(Schema.brand("QuestionId"));
export type QuestionId = typeof QuestionId.Type;

export const QuestionVersionId = Schema.String.pipe(Schema.brand("QuestionVersionId"));
export type QuestionVersionId = typeof QuestionVersionId.Type;

export const firstVersionId = (questionId: QuestionId): QuestionVersionId =>
  QuestionVersionId.make(`${questionId}.1`);

export const Dimension = Schema.Literals(["workload", "psychologicalSafety", "clarity", "recognition"]);
export type Dimension = typeof Dimension.Type;

const trimmed = (maximum: number) =>
  Schema.String.pipe(Schema.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(maximum)));

export const QuestionText = trimmed(200);

export const ScaleLabel = trimmed(40);

export const ChoiceOption = trimmed(80);

export const LONG_TEXT_MAX_LENGTH = 1000;

export const QuestionType = Schema.TaggedUnion({
  Rating: { lowLabel: ScaleLabel, highLabel: ScaleLabel, comment: Schema.Boolean },
  SingleChoice: {
    options: Schema.Array(ChoiceOption).pipe(
      Schema.check(
        Schema.isMinLength(2),
        Schema.isMaxLength(8),
        Schema.makeFilter((options: ReadonlyArray<string>) => new Set(options).size === options.length, {
          expected: "distinct options",
        }),
      ),
    ),
  },
  LongText: {},
});
export type QuestionType = typeof QuestionType.Type;

export const QuestionContent = Schema.Struct({
  text: QuestionText,
  type: QuestionType,

  dimension: Schema.NullOr(Dimension),
});
export type QuestionContent = typeof QuestionContent.Type;
