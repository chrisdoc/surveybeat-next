import {
  AuthUnavailable,
  EmailAddress,
  Locale,
  Forbidden,
  LastAdmin,
  LastLead,
  MinimumGroupSize,
  NewPulseQuestion,
  OrderMismatch,
  OrganizationId,
  OrganizationSettings,
  PersonId,
  PersonNotFound,
  PersonWasRemoved,
  PulseDetail,
  PulseFull,
  PulseId,
  PulseList,
  PulseNeedsAQuestion,
  PulseNotFound,
  PulseSettings,
  QuestionAlreadyInPulse,
  QuestionContent,
  QuestionHasAnswers,
  QuestionId,
  QuestionNotFound,
  InvalidRoundState,
  InvitationNotFound,
  MemberHistory,
  RoundDetail,
  RoundId,
  RoundList,
  RoundNotFound,
  RoundNotOpen,
  RoundResult,
  WeekOutOfRange,
  ActionId,
  ActionItem,
  ActionList,
  ActionNotFound,
  CreateAction,
  OwnerNotInTeam,
  RoundNoteView,
  SaveNote,
  UpdateAction,
  SessionState,
  TeamDetail,
  TeamId,
  TeamName,
  TeamNameTaken,
  TeamNotFound,
  TeamOverview,
  TeamSummary,
  TestInvitationSent,
  TestSendLimitReached,
  TimeZone,
  Unauthenticated,
} from "@surveybeat/domain";
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

/** The name a creator gives a new Organization: trimmed, 1 to 100 characters. */
export const OrganizationName = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(100)),
);

/**
 * Sign-in (WorkOS AuthKit, SPEC §6.1). `login`, `callback`, and `logout` answer with redirects
 * and cookies, so browsers navigate to them; the app calls the other three.
 */
export class AuthApiGroup extends HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.get("login", "/login", { success: HttpApiSchema.Empty(302) }),
    HttpApiEndpoint.get("callback", "/callback", {
      query: { code: Schema.optional(Schema.String), state: Schema.optional(Schema.String) },
      success: HttpApiSchema.Empty(302),
    }),
    HttpApiEndpoint.post("logout", "/logout", {
      success: HttpApiSchema.Empty(303),
      error: [Forbidden, AuthUnavailable],
    }),
    HttpApiEndpoint.get("session", "/session", {
      success: SessionState,
      error: [Unauthenticated, AuthUnavailable],
    }),
    HttpApiEndpoint.post("createOrganization", "/organization", {
      payload: Schema.Struct({ name: OrganizationName }),
      success: SessionState,
      error: [Unauthenticated, Forbidden, AuthUnavailable],
    }),
    HttpApiEndpoint.post("chooseOrganization", "/organization/choose", {
      payload: Schema.Struct({ organizationId: OrganizationId }),
      success: SessionState,
      error: [Unauthenticated, Forbidden, AuthUnavailable],
    }),
  )
  .prefix("/auth") {}

/**
 * Every directory call needs a session in an Organization (`Forbidden` also covers "not in one"),
 * and any of them may meet a rule. `AuthUnavailable`: WorkOS could not be reached; repeat the call.
 */
const directoryErrors = [
  Unauthenticated,
  Forbidden,
  AuthUnavailable,
  TeamNotFound,
  PersonNotFound,
  PulseDetail,
  PulseFull,
  PulseId,
  PulseList,
  PulseNeedsAQuestion,
  PulseNotFound,
  PulseSettings,
  QuestionAlreadyInPulse,
  QuestionContent,
  QuestionHasAnswers,
  QuestionId,
  QuestionNotFound,
  LastLead,
  LastAdmin,
  TeamNameTaken,
  PersonWasRemoved,
] as const;
const teamParams = { teamId: TeamId };
const memberParams = { teamId: TeamId, personId: PersonId };

/**
 * Teams, Leads, members, and Organization settings, for the signed-in Person's Organization
 * (never one named in the URL). The permission table in `@surveybeat/domain` decides each call
 * from the Organization's Durable Object. No endpoint returns Result data. Changes answer 204 and
 * the app reads the view again, since a change can end the caller's own access to it.
 */
export class DirectoryApiGroup extends HttpApiGroup.make("directory")
  .add(
    HttpApiEndpoint.get("listTeams", "/teams", {
      success: Schema.Array(TeamSummary),
      error: directoryErrors,
    }),
    HttpApiEndpoint.post("createTeam", "/teams", {
      payload: Schema.Struct({ name: TeamName, timeZone: TimeZone, leadEmail: EmailAddress }),
      success: TeamDetail,
      error: directoryErrors,
    }),
    HttpApiEndpoint.get("getTeam", "/teams/:teamId", {
      params: teamParams,
      success: TeamDetail,
      error: directoryErrors,
    }),
    HttpApiEndpoint.patch("updateTeam", "/teams/:teamId", {
      params: teamParams,
      payload: Schema.Struct({ name: TeamName, timeZone: TimeZone }),
      error: directoryErrors,
    }),
    HttpApiEndpoint.post("addMember", "/teams/:teamId/members", {
      params: teamParams,
      payload: Schema.Struct({ email: EmailAddress }),
      error: directoryErrors,
    }),
    HttpApiEndpoint.delete("removeMember", "/teams/:teamId/members/:personId", {
      params: memberParams,
      error: directoryErrors,
    }),
    HttpApiEndpoint.post("assignLead", "/teams/:teamId/leads", {
      params: teamParams,
      payload: Schema.Struct({ email: EmailAddress }),
      error: directoryErrors,
    }),
    HttpApiEndpoint.delete("removeLead", "/teams/:teamId/leads/:personId", {
      params: memberParams,
      error: directoryErrors,
    }),
    HttpApiEndpoint.get("getSettings", "/organization", {
      success: OrganizationSettings,
      error: directoryErrors,
    }),
    HttpApiEndpoint.patch("updateSettings", "/organization", {
      payload: Schema.Struct({
        minimumGroupSize: Schema.optionalKey(MinimumGroupSize),
        aiProcessing: Schema.optionalKey(Schema.Boolean),
        defaultLocale: Schema.optionalKey(Locale),
      }),
      error: directoryErrors,
    }),
    HttpApiEndpoint.patch("updateOwnLanguage", "/me/language", {
      payload: Schema.Struct({
        locale: Schema.optionalKey(Schema.NullOr(Locale)),
        detectedLocale: Schema.optionalKey(Locale),
      }),
      error: directoryErrors,
    }),
    HttpApiEndpoint.put("grantAdmin", "/organization/admins/:personId", {
      params: { personId: PersonId },
      error: directoryErrors,
    }),
    HttpApiEndpoint.delete("revokeAdmin", "/organization/admins/:personId", {
      params: { personId: PersonId },
      error: directoryErrors,
    }),
    HttpApiEndpoint.delete("removePerson", "/organization/people/:personId", {
      params: { personId: PersonId },
      error: directoryErrors,
    }),
  )
  .prefix("/api") {}

const pulseErrors = [
  Unauthenticated,
  Forbidden,
  AuthUnavailable,
  TeamNotFound,
  PulseNotFound,
  QuestionNotFound,
  QuestionAlreadyInPulse,
  QuestionHasAnswers,
  PulseNeedsAQuestion,
  PulseFull,
  OrderMismatch,
  TestSendLimitReached,
] as const;
const pulseParams = { teamId: TeamId, pulseId: PulseId };
const questionParams = { teamId: TeamId, pulseId: PulseId, questionId: QuestionId };

/**
 * The Pulse editor: a Team's Pulses, their settings, and their Questions, for the Team's Leads and
 * Organization admins (the permission table decides). Every change answers with the Pulse as the
 * editor shows it, with its estimated answer time and warnings. No endpoint returns Result data.
 */
export class PulsesApiGroup extends HttpApiGroup.make("pulses")
  .add(
    HttpApiEndpoint.get("listPulses", "/teams/:teamId/pulses", {
      params: teamParams,
      success: PulseList,
      error: pulseErrors,
    }),
    HttpApiEndpoint.post("createPulse", "/teams/:teamId/pulses", {
      params: teamParams,
      success: PulseDetail,
      error: pulseErrors,
    }),
    HttpApiEndpoint.get("getPulse", "/teams/:teamId/pulses/:pulseId", {
      params: pulseParams,
      success: PulseDetail,
      error: pulseErrors,
    }),
    HttpApiEndpoint.put("updatePulseSettings", "/teams/:teamId/pulses/:pulseId/settings", {
      params: pulseParams,
      payload: PulseSettings,
      success: PulseDetail,
      error: pulseErrors,
    }),
    HttpApiEndpoint.post("addQuestion", "/teams/:teamId/pulses/:pulseId/questions", {
      params: pulseParams,
      payload: NewPulseQuestion,
      success: PulseDetail,
      error: pulseErrors,
    }),
    HttpApiEndpoint.put("editQuestion", "/teams/:teamId/pulses/:pulseId/questions/:questionId", {
      params: questionParams,
      payload: QuestionContent,
      success: PulseDetail,
      error: pulseErrors,
    }),
    HttpApiEndpoint.delete("removeQuestion", "/teams/:teamId/pulses/:pulseId/questions/:questionId", {
      params: questionParams,
      success: PulseDetail,
      error: pulseErrors,
    }),
    HttpApiEndpoint.put("reorderQuestions", "/teams/:teamId/pulses/:pulseId/order", {
      params: pulseParams,
      payload: Schema.Struct({ order: Schema.Array(QuestionId) }),
      success: PulseDetail,
      error: pulseErrors,
    }),
    HttpApiEndpoint.post("sendTestInvitation", "/teams/:teamId/pulses/:pulseId/test-invitation", {
      params: pulseParams,
      success: TestInvitationSent,
      error: pulseErrors,
    }),
  )
  .prefix("/api") {}

const roundErrors = [
  Unauthenticated,
  Forbidden,
  AuthUnavailable,
  TeamNotFound,
  PulseNotFound,
  RoundNotFound,
  RoundNotOpen,
  InvalidRoundState,
  WeekOutOfRange,
  InvitationNotFound,
] as const;

/**
 * Rounds and lifecycle controls: listing Rounds for a Pulse, viewing a Round, skipping weeks,
 * pausing and resuming Pulses, closing early, and cancelling. Authorized through the permission table.
 * `getResults` and `getTeamOverview` return Team Result data, and `getMyHistory` returns the Team's
 * scores for the caller's own Rounds, each only when it meets N. Everything else returns no Result data.
 */
export class RoundsApiGroup extends HttpApiGroup.make("rounds")
  .add(
    HttpApiEndpoint.get("listRounds", "/teams/:teamId/pulses/:pulseId/rounds", {
      params: { teamId: TeamId, pulseId: PulseId },
      success: RoundList,
      error: roundErrors,
    }),
    HttpApiEndpoint.get("getRound", "/teams/:teamId/rounds/:roundId", {
      params: { teamId: TeamId, roundId: RoundId },
      success: RoundDetail,
      error: roundErrors,
    }),
    HttpApiEndpoint.post("skipWeek", "/teams/:teamId/pulses/:pulseId/skip", {
      params: { teamId: TeamId, pulseId: PulseId },
      payload: Schema.Struct({ plannedOpenDate: Schema.String }),
      success: Schema.Void,
      error: roundErrors,
    }),
    HttpApiEndpoint.post("unskipWeek", "/teams/:teamId/pulses/:pulseId/unskip", {
      params: { teamId: TeamId, pulseId: PulseId },
      payload: Schema.Struct({ plannedOpenDate: Schema.String }),
      success: Schema.Void,
      error: roundErrors,
    }),
    HttpApiEndpoint.post("pausePulse", "/teams/:teamId/pulses/:pulseId/pause", {
      params: { teamId: TeamId, pulseId: PulseId },
      success: Schema.Void,
      error: roundErrors,
    }),
    HttpApiEndpoint.post("resumePulse", "/teams/:teamId/pulses/:pulseId/resume", {
      params: { teamId: TeamId, pulseId: PulseId },
      success: Schema.Void,
      error: roundErrors,
    }),
    HttpApiEndpoint.post("closeRoundEarly", "/teams/:teamId/rounds/:roundId/close", {
      params: { teamId: TeamId, roundId: RoundId },
      success: RoundDetail,
      error: roundErrors,
    }),
    HttpApiEndpoint.post("shareResults", "/teams/:teamId/rounds/:roundId/share", {
      params: { teamId: TeamId, roundId: RoundId },
      success: Schema.Void,
      error: roundErrors,
    }),
    HttpApiEndpoint.post("retryResult", "/teams/:teamId/rounds/:roundId/retry-result", {
      params: { teamId: TeamId, roundId: RoundId },
      success: Schema.Void,
      error: roundErrors,
    }),
    HttpApiEndpoint.post("cancelRound", "/teams/:teamId/rounds/:roundId/cancel", {
      params: { teamId: TeamId, roundId: RoundId },
      success: RoundDetail,
      error: roundErrors,
    }),
    HttpApiEndpoint.post("resendInvitation", "/teams/:teamId/rounds/:roundId/invitations/:personId/resend", {
      params: { teamId: TeamId, roundId: RoundId, personId: PersonId },
      success: Schema.Void,
      error: roundErrors,
    }),
    HttpApiEndpoint.get("getResults", "/teams/:teamId/rounds/:roundId/results", {
      params: { teamId: TeamId, roundId: RoundId },
      success: RoundResult,
      error: roundErrors,
    }),
    HttpApiEndpoint.get("getTeamOverview", "/teams/:teamId/overview", {
      params: { teamId: TeamId },
      success: TeamOverview,
      error: roundErrors,
    }),
    // Takes no input: the server never learns which Submission is the caller's (ADR 0017).
    HttpApiEndpoint.get("getMyHistory", "/me/history", {
      success: MemberHistory,
      error: roundErrors,
    }),
  )
  .prefix("/api") {}

const actionErrors = [
  Unauthenticated,
  Forbidden,
  AuthUnavailable,
  TeamNotFound,
  RoundNotFound,
  ActionNotFound,
  OwnerNotInTeam,
  PersonNotFound,
] as const;

/**
 * Team Actions: commitments made from Results (slice 13).
 * Lead creates and updates actions; team members can view.
 * The Actions list has no minimum group size.
 */
export class ActionsApiGroup extends HttpApiGroup.make("actions")
  .add(
    HttpApiEndpoint.get("listActions", "/teams/:teamId/actions", {
      params: { teamId: TeamId },
      success: ActionList,
      error: actionErrors,
    }),
    HttpApiEndpoint.post("createAction", "/teams/:teamId/actions", {
      params: { teamId: TeamId },
      payload: CreateAction,
      success: ActionItem,
      error: actionErrors,
    }),
    HttpApiEndpoint.patch("updateAction", "/teams/:teamId/actions/:actionId", {
      params: { teamId: TeamId, actionId: ActionId },
      payload: UpdateAction,
      success: ActionItem,
      error: actionErrors,
    }),
  )
  .prefix("/api") {}

const noteErrors = [Unauthenticated, Forbidden, AuthUnavailable, TeamNotFound, RoundNotFound] as const;

/**
 * The Lead's Note on a Round (R2 04). The Lead writes it; the Team reads it. Organization admins
 * outside the Team get 403 on both (ADR 0003). Free text, so no minimum group size applies.
 */
export class NotesApiGroup extends HttpApiGroup.make("notes")
  .add(
    HttpApiEndpoint.get("getRoundNote", "/teams/:teamId/rounds/:roundId/note", {
      params: { teamId: TeamId, roundId: RoundId },
      success: RoundNoteView,
      error: noteErrors,
    }),
    HttpApiEndpoint.put("saveRoundNote", "/teams/:teamId/rounds/:roundId/note", {
      params: { teamId: TeamId, roundId: RoundId },
      payload: SaveNote,
      success: RoundNoteView,
      error: noteErrors,
    }),
  )
  .prefix("/api") {}

/** The HttpApi declaration shared by the server and the clients. */
export class SurveyBeatApi extends HttpApi.make("surveybeat")
  .add(AuthApiGroup)
  .add(DirectoryApiGroup)
  .add(PulsesApiGroup)
  .add(RoundsApiGroup)
  .add(ActionsApiGroup)
  .add(NotesApiGroup) {}
