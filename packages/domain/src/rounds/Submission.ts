import { Schema } from "effect";
import { QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import { RoundStatus } from "./Round.ts";

/** A random 128-bit key identifying an anonymous Submission. */
export const SubmissionId = Schema.String.pipe(Schema.brand("SubmissionId"));
export type SubmissionId = typeof SubmissionId.Type;

/** A browser-generated 256-bit Edit key used to change answers. */
export const EditKey = Schema.String.pipe(Schema.brand("EditKey"));
export type EditKey = typeof EditKey.Type;

/** SHA-256 hash of the browser-generated Edit key. Stored in DB instead of Edit key. */
export const EditKeyHash = Schema.String.pipe(Schema.brand("EditKeyHash"));
export type EditKeyHash = typeof EditKeyHash.Type;

/** One answer within a submission. */
export const SubmissionAnswer = Schema.Struct({
  questionVersionId: QuestionVersionId,
  value: Schema.NullOr(Schema.Int),
  comment: Schema.NullOr(Schema.String),
});
export type SubmissionAnswer = typeof SubmissionAnswer.Type;

/** A frozen question shown on the answer page. */
export const SubmissionQuestion = Schema.Struct({
  id: QuestionVersionId,
  position: Schema.Int,
  text: Schema.String,
  type: QuestionType,
});
export type SubmissionQuestion = typeof SubmissionQuestion.Type;

/** An open Action from the Pulse/Team shown on the answer page. */
export const SubmissionAction = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
});
export type SubmissionAction = typeof SubmissionAction.Type;

/** The context returned by token exchange with zero side effects (ADR 0005, ADR 0007). */
export const SubmissionRoundContext = Schema.Struct({
  pulseName: Schema.String,
  anonymityStatement: Schema.String,
  questions: Schema.Array(SubmissionQuestion),
  actions: Schema.Array(SubmissionAction),
  closeTime: Schema.Int,
  state: RoundStatus,
  hasAnswered: Schema.Boolean,
});
export type SubmissionRoundContext = typeof SubmissionRoundContext.Type;

/** Tagged error when a member attempts a second first-answer. */
export class AlreadyAnswered extends Schema.TaggedError<AlreadyAnswered, { readonly brand: unique symbol }>()(
  "AlreadyAnswered",
  {},
  { httpApiStatus: 409 },
) {}

/** Tagged error when a submission is not found for an edit key hash. */
export class SubmissionNotFound extends Schema.TaggedError<
  SubmissionNotFound,
  { readonly brand: unique symbol }
>()("SubmissionNotFound", {}, { httpApiStatus: 404 }) {}

/** Tagged error when a request carries invalid combinations (e.g. both token and edit key). */
export class InvalidSubmissionRequest extends Schema.TaggedError<
  InvalidSubmissionRequest,
  { readonly reason: string }
>()("InvalidSubmissionRequest", { reason: Schema.String }, { httpApiStatus: 400 }) {}
