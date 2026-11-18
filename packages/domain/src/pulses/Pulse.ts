import { Schema } from "effect";
import { EmailAddress, SendId } from "../email/Email.ts";
import { FailureReason } from "../email/SendState.ts";
import { days, Policy } from "../Policy.ts";
import { TeamSummary } from "../people/Team.ts";
import { QuestionContent, QuestionId, QuestionVersionId } from "./Question.ts";
import { TemplateQuestion, TemplateQuestionKey } from "./Template.ts";

export const PulseId = Schema.String.pipe(Schema.brand("PulseId"));
export type PulseId = typeof PulseId.Type;

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

const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const SendTime = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(CLOCK_TIME),
    Schema.makeFilter(
      (time: string) => time >= Policy.sendWindow.earliest && time <= Policy.sendWindow.latest,
      {
        expected: `a time from ${Policy.sendWindow.earliest} to ${Policy.sendWindow.latest}`,
      },
    ),
  ),
  Schema.brand("SendTime"),
);
export type SendTime = typeof SendTime.Type;

export const Cadence = Schema.TaggedUnion({
  Weekly: { day: Weekday, time: SendTime },
});
export type Cadence = typeof Cadence.Type;

export const AnswerWindowDays = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(6)),
);

export const ReviewWindowDays = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(7)),
);

export const ReminderCount = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(2)),
);

export const AnonymityMode = Schema.Literals(["anonymous"]);
export type AnonymityMode = typeof AnonymityMode.Type;

export const Distribution = Schema.Literals(["invitation"]);
export type Distribution = typeof Distribution.Type;

export const PulseSettings = Schema.Struct({
  name: PulseName,
  cadence: Cadence,
  answerWindowDays: AnswerWindowDays,
  reviewWindowDays: ReviewWindowDays,
  reminders: ReminderCount,
  anonymityMode: AnonymityMode,
  distribution: Distribution,
});
export type PulseSettings = typeof PulseSettings.Type;

export const MIN_QUESTIONS = 1;

export const MAX_QUESTIONS = Policy.questions.maximum;
export const RECOMMENDED_MAX_SECONDS = 90;

export const PulseWarning = Schema.TaggedUnion({
  TooManyQuestions: { count: Schema.Int, recommended: Schema.Int },

  TooLong: { seconds: Schema.Int, recommended: Schema.Int },

  NoOneTap: {},

  TeamBelowMinimumGroupSize: { members: Schema.Int, minimumGroupSize: Schema.Int },
});
export type PulseWarning = typeof PulseWarning.Type;

export const PulseQuestion = Schema.Struct({
  questionId: QuestionId,
  versionId: QuestionVersionId,

  templateKey: Schema.NullOr(TemplateQuestionKey),
  ...QuestionContent.fields,

  hasAnswers: Schema.Boolean,
  estimatedSeconds: Schema.Int,
});
export type PulseQuestion = typeof PulseQuestion.Type;

export const PulseSummary = Schema.Struct({
  id: PulseId,
  name: Schema.String,
  cadence: Cadence,
  questionCount: Schema.Int,
  estimatedSeconds: Schema.Int,

  paused: Schema.optional(Schema.Boolean),

  nextRoundDate: Schema.optional(Schema.NullOr(Schema.String)),
});
export type PulseSummary = typeof PulseSummary.Type;

export const PulseList = Schema.Struct({
  team: TeamSummary,
  pulses: Schema.Array(PulseSummary),
});
export type PulseList = typeof PulseList.Type;

export const PulseDetail = Schema.Struct({
  id: PulseId,
  team: TeamSummary,
  settings: PulseSettings,
  questions: Schema.Array(PulseQuestion),
  estimatedSeconds: Schema.Int,
  warnings: Schema.Array(PulseWarning),

  templateQuestions: Schema.Array(TemplateQuestion),
});
export type PulseDetail = typeof PulseDetail.Type;

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

export class QuestionNotFound extends Schema.TaggedError<
  QuestionNotFound,
  { readonly brand: unique symbol }
>()("QuestionNotFound", {}, { httpApiStatus: 404 }) {}

export class QuestionAlreadyInPulse extends Schema.TaggedError<
  QuestionAlreadyInPulse,
  { readonly brand: unique symbol }
>()("QuestionAlreadyInPulse", {}, { httpApiStatus: 409 }) {}

export class QuestionHasAnswers extends Schema.TaggedError<
  QuestionHasAnswers,
  { readonly brand: unique symbol }
>()("QuestionHasAnswers", {}, { httpApiStatus: 409 }) {}

export class PulseNeedsAQuestion extends Schema.TaggedError<
  PulseNeedsAQuestion,
  { readonly brand: unique symbol }
>()("PulseNeedsAQuestion", {}, { httpApiStatus: 409 }) {}

export class PulseFull extends Schema.TaggedError<PulseFull, { readonly brand: unique symbol }>()(
  "PulseFull",
  { maximum: Schema.Int },
  { httpApiStatus: 409 },
) {}

export class OrderMismatch extends Schema.TaggedError<OrderMismatch, { readonly brand: unique symbol }>()(
  "OrderMismatch",
  {},
  { httpApiStatus: 409 },
) {}

export const testSendsPerHour = Policy.testSend.perHour;

export const testInvitationLifetimeMs = days(Policy.testSend.lifetimeDays);

export class TestSendLimitReached extends Schema.TaggedError<
  TestSendLimitReached,
  { readonly brand: unique symbol }
>()("TestSendLimitReached", { perHour: Schema.Int }, { httpApiStatus: 429 }) {}

export const TestInvitationSent = Schema.Struct({ email: EmailAddress, sendId: SendId });
export type TestInvitationSent = typeof TestInvitationSent.Type;

export const TestSendStatus = Schema.Struct({
  queuedAt: Schema.Int,

  checkedAt: Schema.Int,
  state: Schema.TaggedUnion({
    Queued: { attempts: Schema.Int, lastCode: Schema.NullOr(Schema.String) },

    Sending: { attempt: Schema.Int },
    Sent: { sentAt: Schema.Int },
    Failed: { reason: FailureReason, code: Schema.NullOr(Schema.String), failedAt: Schema.Int },
  }),
});
export type TestSendStatus = typeof TestSendStatus.Type;

export class TestSendNotFound extends Schema.TaggedError<
  TestSendNotFound,
  { readonly brand: unique symbol }
>()("TestSendNotFound", {}, { httpApiStatus: 404 }) {}
