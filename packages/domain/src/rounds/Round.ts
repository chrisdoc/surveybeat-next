import { Schema } from "effect";
import { EmailAddress } from "../email/Email.ts";
import { PersonId } from "../people/Identity.ts";
import { TeamSummary } from "../people/Team.ts";
import { TeamId } from "../people/Team.ts";
import { PulseId, AnswerWindowDays, ReminderCount, AnonymityMode, Distribution } from "../pulses/Pulse.ts";
import { QuestionVersionId } from "../pulses/Question.ts";

/** One occurrence of a Pulse. */
export const RoundId = Schema.String.pipe(Schema.brand("RoundId"));
export type RoundId = typeof RoundId.Type;

/** A scheduled job in the DO schedule table. */
export const JobId = Schema.String.pipe(Schema.brand("JobId"));
export type JobId = typeof JobId.Type;

export const RoundStatus = Schema.Literals(["scheduled", "open", "closed", "ready", "shared", "cancelled"]);
export type RoundStatus = typeof RoundStatus.Type;

/** YYYY-MM-DD representing the cadence day of the week for this Round. */
export const PlannedOpenDate = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
    Schema.makeFilter((s: string) => !isNaN(Date.parse(s)), { expected: "a valid YYYY-MM-DD date" }),
  ),
  Schema.brand("PlannedOpenDate"),
);
export type PlannedOpenDate = typeof PlannedOpenDate.Type;

export const ScheduleJobType = Schema.Literals(["open", "close", "compute", "send", "remind"]);
export type ScheduleJobType = typeof ScheduleJobType.Type;

export const ScheduleJobStatus = Schema.Literals(["pending", "running", "completed", "cancelled"]);
export type ScheduleJobStatus = typeof ScheduleJobStatus.Type;

/** A Question version frozen in a Round when it opened. */
export const RoundQuestion = Schema.Struct({
  roundId: RoundId,
  position: Schema.Int,
  questionVersionId: QuestionVersionId,
});
export type RoundQuestion = typeof RoundQuestion.Type;

/** A member eligible to answer frozen when the Round opened. */
export const RoundMember = Schema.Struct({
  roundId: RoundId,
  personId: Schema.String,
  timeZone: Schema.String,
  sendAt: Schema.Int,
});
export type RoundMember = typeof RoundMember.Type;

/** A failed Invitation shown in the Lead's view with Resend (ADR 0006). */
export const FailedInvitation = Schema.Struct({
  personId: PersonId,
  email: EmailAddress,
  reason: Schema.String,
  resendCount: Schema.Int,
});
export type FailedInvitation = typeof FailedInvitation.Type;

/** Summary of a Round in lists. */
export const RoundSummary = Schema.Struct({
  id: RoundId,
  pulseId: PulseId,
  teamId: TeamId,
  status: RoundStatus,
  plannedOpenDate: Schema.String,
  plannedOpenAt: Schema.Int,
  openedAt: Schema.NullOr(Schema.Int),
  plannedCloseAt: Schema.Int,
  closedAt: Schema.NullOr(Schema.Int),
  pulseName: Schema.String,
});
export type RoundSummary = typeof RoundSummary.Type;

/** Detail view of a Round: lifecycle state, frozen questions, effective N, failed invitations. Never Result data. */
export const RoundDetail = Schema.Struct({
  id: RoundId,
  pulseId: PulseId,
  team: TeamSummary,
  status: RoundStatus,
  plannedOpenDate: Schema.String,
  plannedOpenAt: Schema.Int,
  openedAt: Schema.NullOr(Schema.Int),
  plannedCloseAt: Schema.Int,
  closedAt: Schema.NullOr(Schema.Int),
  effectiveMinimumGroupSize: Schema.NullOr(Schema.Int),
  pulseName: Schema.String,
  answerWindowDays: AnswerWindowDays,
  reminders: ReminderCount,
  anonymityMode: AnonymityMode,
  distribution: Distribution,
  questions: Schema.Array(QuestionVersionId),
  failedInvitations: Schema.Array(FailedInvitation),
  createdAt: Schema.Int,
});
export type RoundDetail = typeof RoundDetail.Type;

/** The list of Rounds for a Pulse. */
export const RoundList = Schema.Struct({
  pulseId: PulseId,
  rounds: Schema.Array(RoundSummary),
});
export type RoundList = typeof RoundList.Type;

export class RoundNotFound extends Schema.TaggedError<RoundNotFound, { readonly brand: unique symbol }>()(
  "RoundNotFound",
  {},
  { httpApiStatus: 404 },
) {}

export class RoundNotOpen extends Schema.TaggedError<RoundNotOpen, { readonly brand: unique symbol }>()(
  "RoundNotOpen",
  {},
  { httpApiStatus: 409 },
) {}

export class InvalidRoundState extends Schema.TaggedError<
  InvalidRoundState,
  { readonly brand: unique symbol }
>()("InvalidRoundState", { status: RoundStatus }, { httpApiStatus: 409 }) {}

export class WeekOutOfRange extends Schema.TaggedError<WeekOutOfRange, { readonly brand: unique symbol }>()(
  "WeekOutOfRange",
  {},
  { httpApiStatus: 400 },
) {}

export class InvitationNotFound extends Schema.TaggedError<InvitationNotFound, { readonly brand: unique symbol }>()(
  "InvitationNotFound",
  {},
  { httpApiStatus: 404 },
) {}
