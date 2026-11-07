import { Schema } from "effect";

/** A Question in the Organization's question library. */
export const QuestionId = Schema.String.pipe(Schema.brand("QuestionId"));
export type QuestionId = typeof QuestionId.Type;

/** One meaning of a Question. Answers always point at a Question version, never at the Question. */
export const QuestionVersionId = Schema.String.pipe(Schema.brand("QuestionVersionId"));
export type QuestionVersionId = typeof QuestionVersionId.Type;

/** Release 1 has exactly one version per Question, so its version is always the first. */
export const firstVersionId = (questionId: QuestionId): QuestionVersionId =>
  QuestionVersionId.make(`${questionId}.1`);

/** The themes the weekly team health Template groups its Questions by. */
export const Dimension = Schema.Literals(["workload", "psychologicalSafety", "clarity", "recognition"]);
export type Dimension = typeof Dimension.Type;

const trimmed = (maximum: number) =>
  Schema.String.pipe(Schema.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(maximum)));

/** What a Question asks: trimmed, 1 to 200 characters. */
export const QuestionText = trimmed(200);

/** The label at one end of a rating scale, such as "Very unclear". */
export const ScaleLabel = trimmed(40);

/** One option of a single choice Question. */
export const ChoiceOption = trimmed(80);

/** The longest answer a long text Question takes. */
export const LONG_TEXT_MAX_LENGTH = 1000;

/**
 * A Question's type. An open union: eNPS and multiple choice are later cases.
 * - `Rating`: 1 to 5 with labelled ends; `comment` adds the optional "Want to say more?" field.
 * - `SingleChoice`: 2 to 8 distinct options, one of which is picked.
 * - `LongText`: free text of up to {@link LONG_TEXT_MAX_LENGTH} characters.
 */
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

/** The content of one Question version: its text and type. */
export const QuestionContent = Schema.Struct({
  text: QuestionText,
  type: QuestionType,
  /** The Dimension it measures, or none for a Question a Lead wrote without one. */
  dimension: Schema.NullOr(Dimension),
});
export type QuestionContent = typeof QuestionContent.Type;
