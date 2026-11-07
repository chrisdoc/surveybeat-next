import { Schema } from "effect";
import { TeamSummary } from "../people/Team.ts";
import { QuestionContent, QuestionId, QuestionVersionId } from "./Question.ts";
import { TemplateQuestion, TemplateQuestionKey } from "./Template.ts";

/** A recurring check-in for one Team. */
export const PulseId = Schema.String.pipe(Schema.brand("PulseId"));
export type PulseId = typeof PulseId.Type;

/** What the Pulse is called in its Team's list: trimmed, 1 to 100 characters. */
export const PulseName = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(100)),
);

export const Weekday = Schema.Literals([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);
export type Weekday = typeof Weekday.Type;

/** `HH:MM` on the 24-hour clock. */
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const EARLIEST_SEND_TIME = "06:00";
export const LATEST_SEND_TIME = "21:00";

/**
 * When a Round opens on its day, in each member's local time: `HH:MM` from 06:00 to 21:00, so no
 * Invitation arrives at night. `HH:MM` strings compare in time order.
 */
export const SendTime = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(CLOCK_TIME),
    Schema.makeFilter((time: string) => time >= EARLIEST_SEND_TIME && time <= LATEST_SEND_TIME, {
      expected: `a time from ${EARLIEST_SEND_TIME} to ${LATEST_SEND_TIME}`,
    }),
  ),
  Schema.brand("SendTime"),
);
export type SendTime = typeof SendTime.Type;

/** How often Rounds open. Release 1 has only weekly; other rules are later cases. */
export const Cadence = Schema.TaggedUnion({
  Weekly: { day: Weekday, time: SendTime },
});
export type Cadence = typeof Cadence.Type;

/** How long a Round takes answers, in days: 1 to 6. */
export const AnswerWindowDays = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(6)),
);

/** Reminders per Round, at fixed points in the answer window: 0 to 2. */
export const ReminderCount = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(2)),
);

/** A Pulse's privacy setting. Release 1 allows only anonymous; attributed and confidential come later. */
export const AnonymityMode = Schema.Literals(["anonymous"]);
export type AnonymityMode = typeof AnonymityMode.Type;

/** How a Pulse reaches people, fixed per Pulse. Release 1 allows only Invitation; shared link comes later. */
export const Distribution = Schema.Literals(["invitation"]);
export type Distribution = typeof Distribution.Type;

/** Everything about a Pulse but its Team and its Questions. */
export const PulseSettings = Schema.Struct({
  name: PulseName,
  cadence: Cadence,
  answerWindowDays: AnswerWindowDays,
  reminders: ReminderCount,
  anonymityMode: AnonymityMode,
  distribution: Distribution,
});
export type PulseSettings = typeof PulseSettings.Type;

/** A Pulse with no Questions cannot open a Round, so a Pulse always keeps one. */
export const MIN_QUESTIONS = 1;
/** The hard limit. The editor warns well before it, above {@link RECOMMENDED_MAX_QUESTIONS}. */
export const MAX_QUESTIONS = 20;
export const RECOMMENDED_MAX_QUESTIONS = 7;
export const RECOMMENDED_MAX_SECONDS = 90;

/** What the editor tells the Lead about a Pulse. None of them stops the Pulse being saved. */
export const PulseWarning = Schema.TaggedUnion({
  /** More than {@link RECOMMENDED_MAX_QUESTIONS} Questions. */
  TooManyQuestions: { count: Schema.Int, recommended: Schema.Int },
  /** The estimated answer time is over about {@link RECOMMENDED_MAX_SECONDS} seconds. */
  TooLong: { seconds: Schema.Int, recommended: Schema.Int },
  /** One-tap answers from the email need a rating Question first (ADR 0007). */
  NoOneTap: {},
  /**
   * The Team has fewer members than the minimum group size N, so no Result can be shown until
   * more join (ADR 0004).
   */
  TeamBelowMinimumGroupSize: { members: Schema.Int, minimumGroupSize: Schema.Int },
});
export type PulseWarning = typeof PulseWarning.Type;

/** One Question of a Pulse, as the editor shows it. */
export const PulseQuestion = Schema.Struct({
  questionId: QuestionId,
  versionId: QuestionVersionId,
  /** The Template Question it was copied from, if any. */
  templateKey: Schema.NullOr(TemplateQuestionKey),
  ...QuestionContent.fields,
  /** A Question with Answers cannot be edited. */
  hasAnswers: Schema.Boolean,
  estimatedSeconds: Schema.Int,
});
export type PulseQuestion = typeof PulseQuestion.Type;

/** A Pulse in its Team's list. */
export const PulseSummary = Schema.Struct({
  id: PulseId,
  name: Schema.String,
  cadence: Cadence,
  questionCount: Schema.Int,
  estimatedSeconds: Schema.Int,
});
export type PulseSummary = typeof PulseSummary.Type;

/** A Team's Pulses. Never Result data. */
export const PulseList = Schema.Struct({
  team: TeamSummary,
  pulses: Schema.Array(PulseSummary),
});
export type PulseList = typeof PulseList.Type;

/** The Pulse editor's view: settings, Questions in order, the estimate, and the warnings. */
export const PulseDetail = Schema.Struct({
  id: PulseId,
  team: TeamSummary,
  settings: PulseSettings,
  questions: Schema.Array(PulseQuestion),
  estimatedSeconds: Schema.Int,
  warnings: Schema.Array(PulseWarning),
  /** The Template's Questions this Pulse does not have, which the Lead can add. */
  templateQuestions: Schema.Array(TemplateQuestion),
});
export type PulseDetail = typeof PulseDetail.Type;

/** What the Lead adds to a Pulse: a Template Question, or a Question they write. */
export const NewPulseQuestion = Schema.Union([
  Schema.TaggedStruct("FromTemplate", { key: TemplateQuestionKey }),
  Schema.TaggedStruct("Written", QuestionContent.fields),
]);
export type NewPulseQuestion = typeof NewPulseQuestion.Type;

export class PulseNotFound extends Schema.TaggedError<PulseNotFound, { readonly brand: unique symbol }>()(
  "PulseNotFound",
  {},
  { httpApiStatus: 404 },
) {}

/** Not one of this Pulse's Questions, or not one of the Template's. */
export class QuestionNotFound extends Schema.TaggedError<
  QuestionNotFound,
  { readonly brand: unique symbol }
>()("QuestionNotFound", {}, { httpApiStatus: 404 }) {}

export class QuestionAlreadyInPulse extends Schema.TaggedError<
  QuestionAlreadyInPulse,
  { readonly brand: unique symbol }
>()("QuestionAlreadyInPulse", {}, { httpApiStatus: 409 }) {}

/** Answers point at the Question version, so its meaning is fixed once anyone answered it. */
export class QuestionHasAnswers extends Schema.TaggedError<
  QuestionHasAnswers,
  { readonly brand: unique symbol }
>()("QuestionHasAnswers", {}, { httpApiStatus: 409 }) {}

/** A Pulse keeps at least one Question. */
export class PulseNeedsAQuestion extends Schema.TaggedError<
  PulseNeedsAQuestion,
  { readonly brand: unique symbol }
>()("PulseNeedsAQuestion", {}, { httpApiStatus: 409 }) {}

export class PulseFull extends Schema.TaggedError<PulseFull, { readonly brand: unique symbol }>()(
  "PulseFull",
  { maximum: Schema.Int },
  { httpApiStatus: 409 },
) {}

/** A reorder must list exactly the Pulse's Questions; someone else changed them meanwhile. */
export class OrderMismatch extends Schema.TaggedError<OrderMismatch, { readonly brand: unique symbol }>()(
  "OrderMismatch",
  {},
  { httpApiStatus: 409 },
) {}
