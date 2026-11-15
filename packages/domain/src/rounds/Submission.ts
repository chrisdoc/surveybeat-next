import { Schema } from "effect";
import { QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import { RoundId, RoundStatus } from "./Round.ts";

export const SubmissionId = Schema.String.pipe(Schema.brand("SubmissionId"));
export type SubmissionId = typeof SubmissionId.Type;

export const EditKey = Schema.String.pipe(Schema.brand("EditKey"));
export type EditKey = typeof EditKey.Type;

export const EditKeyHash = Schema.String.pipe(Schema.brand("EditKeyHash"));
export type EditKeyHash = typeof EditKeyHash.Type;

export const SubmissionAnswer = Schema.Struct({
  questionVersionId: QuestionVersionId,
  value: Schema.NullOr(Schema.Int),
  comment: Schema.NullOr(Schema.String),
});
export type SubmissionAnswer = typeof SubmissionAnswer.Type;

export const SubmissionQuestion = Schema.Struct({
  id: QuestionVersionId,
  position: Schema.Int,
  text: Schema.String,
  type: QuestionType,
});
export type SubmissionQuestion = typeof SubmissionQuestion.Type;

export const SubmissionAction = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
});
export type SubmissionAction = typeof SubmissionAction.Type;

export const SubmissionRoundContext = Schema.Struct({
  roundId: RoundId,
  pulseName: Schema.String,

  minimumGroupSize: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
  questions: Schema.Array(SubmissionQuestion),
  actions: Schema.Array(SubmissionAction),
  closeTime: Schema.Int,
  state: RoundStatus,
  hasAnswered: Schema.Boolean,

  aiProcessing: Schema.Boolean,

  test: Schema.optionalKey(Schema.Literal(true)),
});
export type SubmissionRoundContext = typeof SubmissionRoundContext.Type;

export class AlreadyAnswered extends Schema.TaggedError<AlreadyAnswered, { readonly brand: unique symbol }>()(
  "AlreadyAnswered",
  {},
  { httpApiStatus: 409 },
) {}

export class SubmissionNotFound extends Schema.TaggedError<
  SubmissionNotFound,
  { readonly brand: unique symbol }
>()("SubmissionNotFound", {}, { httpApiStatus: 404 }) {}

export class InvalidSubmissionRequest extends Schema.TaggedError<
  InvalidSubmissionRequest,
  { readonly reason: string }
>()("InvalidSubmissionRequest", { reason: Schema.String }, { httpApiStatus: 400 }) {}
