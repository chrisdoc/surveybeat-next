import {
  ActionId,
  ActionItem,
  ActionList,
  ActionStatus,
  browserLocale,
  Dimension,
  EmailAddress,
  FailedEmails,
  FailedEmailStatus,
  Locale,
  MemberHistory,
  MinimumGroupSize,
  NewPulseQuestion,
  NOTE_MAX_LENGTH,
  OrganizationId,
  OrganizationSettings,
  PersonId,
  PulseDetail,
  PulseId,
  PulseList,
  PulseSettings,
  QuestionContent,
  QuestionId,
  type QuestionType,
  resolveLocale,
  RoundDetail,
  RoundId,
  RoundList,
  RoundNoteView,
  RoundResult,
  SendId,
  TeamDetail,
  TeamId,
  TeamName,
  TeamOverview,
  TeamSummary,
  TemplateQuestionKey,
  TestSendStatus,
  TimeZone,
  Weekday,
} from "@surveybeat/domain";
import { Effect, Option, Schema } from "effect";
import { Command, Navigation, type Update } from "foldkit";
import type { Document, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { Url } from "foldkit/url";
import { message, setLocale } from "../messages/locale.ts";
import { Failure, runApi } from "./api.ts";
import { privacyView, screenView } from "./components.ts";
import {
  decodeEmail,
  decodeName,
  decodeSize,
  decodeZone,
  FAILED_EMAIL_POLL_INTERVAL,
  failedEmailKeepsPolling,
  FailedEmailResend,
  LoadedFailedEmails,
  LoadedSettings,
  LoadedTeam,
  LoadedTeams,
  settingsScreenView,
  shellView,
  teamScreenView,
  teamsScreenView,
} from "./directory.ts";
import { historyView, LoadedHistory } from "./history.ts";
import { browserStorage, clearKeptAnswers, KeptAnswers, readKeptAnswers } from "./keptAnswers.ts";
import { LoadedOverview, teamOverviewView } from "./overview.ts";
import {
  decodeContent,
  decodeSettings,
  LoadedPulse,
  LoadedPulses,
  pulseEditorView,
  pulsesScreenView,
  TEST_SEND_POLL_INTERVAL,
  TestSendResult,
  testSendKeepsPolling,
} from "./pulses.ts";
import { GuideCopy, LoadedActions, LoadedNote, LoadedResults, resultsScreenView } from "./results.ts";
import { isLead, LoadedRounds, RoundConfirm, roundsScreenView } from "./rounds.ts";
import { AppRoute, pulseHref, teamHref, urlToAppRoute } from "./routes.ts";
import {
  chooseOrganizationView,
  createOrganizationView,
  failedView,
  notInOrganizationView,
  runSessionCall,
  SessionModel,
  SessionResult,
  signInView,
} from "./session.ts";

// ==========================================
// MODEL
// ==========================================

export const Model = Schema.Struct({
  url: Url,
  route: AppRoute,
  session: SessionModel,
  // The browser's language, if SurveyBeat has one of its languages (ADR 0018)
  browserLocale: Schema.NullOr(Locale),
  languageBusy: Schema.Boolean,
  languageFailure: Schema.Option(Failure),
  // Teams screen
  teams: LoadedTeams,
  createTeamName: Schema.String,
  createTeamTimeZone: Schema.String,
  createTeamLeadEmail: Schema.String,
  createTeamBusy: Schema.Boolean,
  createTeamFailure: Schema.Option(Failure),
  // Team detail screen
  teamDetail: LoadedTeam,
  teamOverview: LoadedOverview,
  renameName: Schema.String,
  renameTimeZone: Schema.String,
  renameBusy: Schema.Boolean,
  renameFailure: Schema.Option(Failure),
  addMemberEmail: Schema.String,
  addMemberBusy: Schema.Boolean,
  addMemberAdded: Schema.Boolean,
  addMemberFailure: Schema.Option(Failure),
  assignLeadEmail: Schema.String,
  assignLeadBusy: Schema.Boolean,
  assignLeadAdded: Schema.Boolean,
  assignLeadFailure: Schema.Option(Failure),
  rosterBusy: Schema.Boolean,
  rosterFailure: Schema.Option(Failure),
  // Settings screen
  settings: LoadedSettings,
  size: Schema.String,
  sizeSaved: Schema.Boolean,
  sizeBusy: Schema.Boolean,
  sizeFailure: Schema.Option(Failure),
  aiBusy: Schema.Boolean,
  aiFailure: Schema.Option(Failure),
  defaultLanguageBusy: Schema.Boolean,
  defaultLanguageFailure: Schema.Option(Failure),
  peopleBusy: Schema.Boolean,
  peopleFailure: Schema.Option(Failure),
  failedEmails: LoadedFailedEmails,
  // Resends of failed sends, by SendId: the row's state while and after an admin resends one
  failedEmailResends: Schema.Record(Schema.String, FailedEmailResend),
  // Pulses list screen
  pulses: LoadedPulses,
  createPulseBusy: Schema.Boolean,
  createPulseFailure: Schema.Option(Failure),
  // Pulse editor screen
  pulseDetail: LoadedPulse,
  pulseActionBusy: Schema.Boolean,
  pulseActionFailure: Schema.Option(Failure),
  writingQuestion: Schema.Boolean,
  editingQuestionId: Schema.Option(QuestionId),
  formText: Schema.String,
  formKind: Schema.Literals(["Rating", "LongText", "SingleChoice"]),
  formDimension: Schema.Union([Dimension, Schema.Literal("none")]),
  formLowLabel: Schema.String,
  formHighLabel: Schema.String,
  formComment: Schema.Boolean,
  formOptions: Schema.String,
  formBusy: Schema.Boolean,
  formFailure: Schema.Option(Failure),
  settingsName: Schema.String,
  settingsDay: Weekday,
  settingsTime: Schema.String,
  settingsWindow: Schema.Finite,
  settingsReviewWindow: Schema.Finite,
  settingsReminders: Schema.Finite,
  settingsSaved: Schema.Boolean,
  settingsBusy: Schema.Boolean,
  settingsFailure: Schema.Option(Failure),
  testSendBusy: Schema.Boolean,
  testSendResult: Schema.Option(TestSendResult),
  // Rounds screen
  rounds: LoadedRounds,
  roundDetails: Schema.Record(Schema.String, RoundDetail),
  roundRates: Schema.Record(Schema.String, Schema.NullOr(Schema.Finite)),
  roundConfirm: Schema.Option(RoundConfirm),
  roundsSkipDate: Schema.String,
  roundsBusy: Schema.Boolean,
  roundsFailure: Schema.Option(Failure),
  // Results screen
  results: LoadedResults,
  showTable: Schema.Record(Schema.String, Schema.Boolean),
  // History screen
  history: LoadedHistory,
  guideCopy: GuideCopy,
  shareBusy: Schema.Boolean,
  shareFailure: Schema.Option(Failure),
  retryBusy: Schema.Boolean,
  retryFailure: Schema.Option(Failure),
  // Actions
  actions: LoadedActions,
  actionTitle: Schema.String,
  actionOwnerId: Schema.Option(PersonId),
  actionDueDate: Schema.String,
  actionDimension: Schema.Union([Dimension, Schema.Literal("none")]),
  actionBusy: Schema.Boolean,
  actionFailure: Schema.Option(Failure),
  // Lead's Note on the Round
  roundNote: LoadedNote,
  noteDraft: Schema.String,
  noteEditing: Schema.Boolean,
  noteBusy: Schema.Boolean,
  noteFailure: Schema.Option(Failure),
});
export type Model = typeof Model.Type;

// ==========================================
// MESSAGES
// ==========================================

export const OutcomeResults = Schema.Union([
  Schema.TaggedStruct("Success", { result: RoundResult }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeActions = Schema.Union([
  Schema.TaggedStruct("Success", { list: ActionList }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeActionItem = Schema.Union([
  Schema.TaggedStruct("Success", { action: ActionItem }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeRoundNote = Schema.Union([
  Schema.TaggedStruct("Success", { view: RoundNoteView }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeRounds = Schema.Union([
  Schema.TaggedStruct("Success", { list: RoundList }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeRoundDetail = Schema.Union([
  Schema.TaggedStruct("Success", { detail: RoundDetail }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeTeams = Schema.Union([
  Schema.TaggedStruct("Success", { teams: Schema.Array(TeamSummary) }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeTeamDetail = Schema.Union([
  Schema.TaggedStruct("Success", { detail: TeamDetail }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeTeamOverview = Schema.Union([
  Schema.TaggedStruct("Success", { overview: TeamOverview }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeMyHistory = Schema.Union([
  Schema.TaggedStruct("Success", { history: MemberHistory, kept: KeptAnswers }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeSettings = Schema.Union([
  Schema.TaggedStruct("Success", { settings: OrganizationSettings }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomePulses = Schema.Union([
  Schema.TaggedStruct("Success", { pulses: PulseList }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomePulseDetail = Schema.Union([
  Schema.TaggedStruct("Success", { detail: PulseDetail }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeTestSent = Schema.Union([
  Schema.TaggedStruct("Success", { email: Schema.String, sendId: SendId, pulseId: PulseId }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeTestSendStatus = Schema.Union([
  Schema.TaggedStruct("Success", { status: TestSendStatus }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeFailedEmails = Schema.Union([
  Schema.TaggedStruct("Success", { list: FailedEmails }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeFailedEmailStatus = Schema.Union([
  Schema.TaggedStruct("Success", { status: FailedEmailStatus }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);
export const OutcomeVoid = Schema.Union([
  Schema.TaggedStruct("Success", {}),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);

export const Message = defineMessageUnion({
  // Navigation
  UrlRequested: { request: Navigation.UrlRequest },
  UrlChanged: { url: Url },
  Navigated: {},
  // Session
  GotSession: { result: SessionResult },
  RetrySession: {},
  CreateOrgNameChanged: { name: Schema.String },
  SubmitCreateOrg: {},
  ChooseOrgClicked: { organizationId: OrganizationId },
  LanguageChanged: { value: Schema.String },
  UpdatedOwnLanguage: { chosen: Schema.Boolean, outcome: OutcomeVoid },
  // Teams screen
  GotTeams: { outcome: OutcomeTeams },
  CreateTeamNameChanged: { name: Schema.String },
  CreateTeamTimeZoneChanged: { tz: Schema.String },
  CreateTeamLeadEmailChanged: { email: Schema.String },
  SubmitCreateTeam: {},
  CreatedTeam: { outcome: OutcomeTeamDetail },
  // Team detail screen
  GotTeam: { outcome: OutcomeTeamDetail },
  GotTeamOverview: { outcome: OutcomeTeamOverview },
  RenameNameChanged: { name: Schema.String },
  RenameTimeZoneChanged: { tz: Schema.String },
  SubmitRenameTeam: {},
  UpdatedTeam: { outcome: OutcomeVoid },
  AddMemberEmailChanged: { email: Schema.String },
  SubmitAddMember: {},
  AddedMember: { outcome: OutcomeVoid },
  AssignLeadEmailChanged: { email: Schema.String },
  SubmitAssignLead: {},
  AssignedLead: { outcome: OutcomeVoid },
  RemoveMemberClicked: { personId: PersonId },
  RemovedMember: { outcome: OutcomeVoid },
  RemoveLeadClicked: { personId: PersonId },
  RemovedLead: { outcome: OutcomeVoid },
  // Settings screen
  GotSettings: { outcome: OutcomeSettings },
  SizeChanged: { size: Schema.String },
  SubmitSize: {},
  UpdatedSettings: { outcome: OutcomeVoid },
  AiProcessingToggled: { isOn: Schema.Boolean },
  UpdatedAiProcessing: { outcome: OutcomeVoid },
  DefaultLanguageChanged: { value: Schema.String },
  UpdatedDefaultLanguage: { outcome: OutcomeVoid },
  GotFailedEmails: { outcome: OutcomeFailedEmails },
  ResendFailedEmailClicked: { sendId: SendId },
  ResentFailedEmail: { sendId: SendId, outcome: OutcomeFailedEmailStatus },
  PolledFailedEmail: { sendId: SendId, outcome: OutcomeFailedEmailStatus },
  GrantAdminClicked: { personId: PersonId },
  GrantedAdmin: { outcome: OutcomeVoid },
  RevokeAdminClicked: { personId: PersonId },
  RevokedAdmin: { outcome: OutcomeVoid },
  RemovePersonClicked: { personId: PersonId },
  RemovedPerson: { outcome: OutcomeVoid },
  // Pulses list screen
  GotPulses: { outcome: OutcomePulses },
  CreatePulseClicked: {},
  CreatedPulse: { outcome: OutcomePulseDetail },
  // Pulse editor screen
  GotPulse: { outcome: OutcomePulseDetail },
  MoveQuestionClicked: { index: Schema.Finite, by: Schema.Finite },
  ToggleEditQuestion: { questionId: Schema.Option(QuestionId) },
  RemoveQuestionClicked: { questionId: QuestionId },
  AddTemplateQuestionClicked: { key: TemplateQuestionKey },
  ToggleWritingQuestion: { writing: Schema.Boolean },
  FormTextChanged: { text: Schema.String },
  FormKindChanged: { kind: Schema.Literals(["Rating", "LongText", "SingleChoice"]) },
  FormDimensionChanged: { dim: Schema.Union([Dimension, Schema.Literal("none")]) },
  FormLowLabelChanged: { low: Schema.String },
  FormHighLabelChanged: { high: Schema.String },
  FormCommentToggled: { comment: Schema.Boolean },
  FormOptionsChanged: { options: Schema.String },
  SubmitQuestionForm: { mode: Schema.Literals(["Add", "Edit"]) },
  UpdatedPulse: { outcome: OutcomePulseDetail },
  SettingsNameChanged: { name: Schema.String },
  SettingsDayChanged: { day: Weekday },
  SettingsTimeChanged: { time: Schema.String },
  SettingsWindowChanged: { days: Schema.String },
  SettingsReviewWindowChanged: { days: Schema.String },
  SettingsRemindersChanged: { reminders: Schema.String },
  SubmitSettings: {},
  SendTestInvitationClicked: {},
  SentTestInvitation: { outcome: OutcomeTestSent },
  PolledTestSend: { sendId: SendId, outcome: OutcomeTestSendStatus },
  // Rounds screen
  GotRounds: { outcome: OutcomeRounds },
  GotRoundDetail: { roundId: RoundId, outcome: OutcomeRoundDetail },
  GotRoundRate: { roundId: RoundId, outcome: OutcomeResults },
  SkipWeekClicked: { plannedOpenDate: Schema.String },
  SkipDateChanged: { date: Schema.String },
  SubmitSkipDate: {},
  PausePulseClicked: {},
  ResumePulseClicked: {},
  RoundConfirmRequested: { kind: Schema.Literals(["close", "cancel"]), roundId: RoundId },
  RoundConfirmDismissed: {},
  RoundConfirmed: {},
  ResendInvitationClicked: { roundId: RoundId, personId: PersonId },
  RoundCommandDone: { outcome: OutcomeVoid },
  // History screen
  GotMyHistory: { outcome: OutcomeMyHistory },
  ClearKeptAnswersClicked: {},
  ClearedKeptAnswers: {},
  // Results screen
  GotResults: { outcome: OutcomeResults },
  ToggleResultsTable: { key: Schema.String },
  CopyGuide: { text: Schema.String },
  CopiedGuide: { ok: Schema.Boolean },
  ShareResultsClicked: {},
  ResultsShareDone: { outcome: OutcomeVoid },
  RetryResultClicked: {},
  RetryResultDone: { outcome: OutcomeVoid },
  // Actions
  GotActions: { outcome: OutcomeActions },
  ActionTitleChanged: { title: Schema.String },
  ActionOwnerChanged: { personId: PersonId },
  ActionDueDateChanged: { dueDate: Schema.String },
  ActionDimensionChanged: { dimension: Schema.Union([Dimension, Schema.Literal("none")]) },
  SubmitAction: {},
  CreatedAction: { outcome: OutcomeActionItem },
  UpdateActionStatus: { actionId: ActionId, status: ActionStatus },
  UpdatedAction: { outcome: OutcomeActionItem },
  // Lead's Note on the Round
  GotRoundNote: { outcome: OutcomeRoundNote },
  NoteEditClicked: {},
  NoteDraftChanged: { text: Schema.String },
  NoteCancelClicked: {},
  SubmitNote: {},
  SavedNote: { outcome: OutcomeRoundNote },
});
export type Message = typeof Message.Type;

// ==========================================
// COMMANDS
// ==========================================

export const LoadSession = Command.define("LoadSession", {
  messages: [Message.GotSession],
  execute: Effect.suspend(() =>
    runSessionCall((api) => api.auth.session()).pipe(Effect.map((result) => Message.GotSession({ result }))),
  ),
});

export const CreateOrganization = Command.define("CreateOrganization", {
  args: { name: Schema.String },
  messages: [Message.GotSession],
  execute: ({ name }) =>
    runSessionCall((api) => api.auth.createOrganization({ payload: { name } })).pipe(
      Effect.map((result) => Message.GotSession({ result })),
    ),
});

export const ChooseOrganization = Command.define("ChooseOrganization", {
  args: { organizationId: OrganizationId },
  messages: [Message.GotSession],
  execute: ({ organizationId }) =>
    runSessionCall((api) => api.auth.chooseOrganization({ payload: { organizationId } })).pipe(
      Effect.map((result) => Message.GotSession({ result })),
    ),
});

/** Saves the Person's language (`locale`, `null` to follow the browser) or records the browser's language seen at sign-in (`detectedLocale`). */
export const UpdateOwnLanguage = Command.define("UpdateOwnLanguage", {
  args: {
    locale: Schema.optionalKey(Schema.NullOr(Locale)),
    detectedLocale: Schema.optionalKey(Locale),
  },
  messages: [Message.UpdatedOwnLanguage],
  execute: (args) => {
    const chosen = args.locale !== undefined;
    return runApi(
      (api) => api.directory.updateOwnLanguage({ payload: args }),
      () => Message.UpdatedOwnLanguage({ chosen, outcome: { _tag: "Success" } }),
      (failure) => Message.UpdatedOwnLanguage({ chosen, outcome: { _tag: "Failure", failure } }),
    );
  },
});

export const ListTeams = Command.define("ListTeams", {
  messages: [Message.GotTeams],
  execute: Effect.suspend(() =>
    runApi(
      (api) => api.directory.listTeams(),
      (teams) => Message.GotTeams({ outcome: { _tag: "Success", teams } }),
      (failure) => Message.GotTeams({ outcome: { _tag: "Failure", failure } }),
    ),
  ),
});

export const CreateTeam = Command.define("CreateTeam", {
  args: { name: TeamName, timeZone: TimeZone, leadEmail: EmailAddress },
  messages: [Message.CreatedTeam],
  execute: ({ name, timeZone, leadEmail }) =>
    runApi(
      (api) => api.directory.createTeam({ payload: { name, timeZone, leadEmail } }),
      (detail) => Message.CreatedTeam({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.CreatedTeam({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetTeam = Command.define("GetTeam", {
  args: { teamId: TeamId },
  messages: [Message.GotTeam],
  execute: ({ teamId }) =>
    runApi(
      (api) => api.directory.getTeam({ params: { teamId } }),
      (detail) => Message.GotTeam({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.GotTeam({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetTeamOverviewCmd = Command.define("GetTeamOverviewCmd", {
  args: { teamId: TeamId },
  messages: [Message.GotTeamOverview],
  execute: ({ teamId }) =>
    runApi(
      (api) => api.rounds.getTeamOverview({ params: { teamId } }),
      (overview) => Message.GotTeamOverview({ outcome: { _tag: "Success", overview } }),
      (failure) => Message.GotTeamOverview({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const UpdateTeam = Command.define("UpdateTeam", {
  args: { teamId: TeamId, name: TeamName, timeZone: TimeZone },
  messages: [Message.UpdatedTeam],
  execute: ({ teamId, name, timeZone }) =>
    runApi(
      (api) => api.directory.updateTeam({ params: { teamId }, payload: { name, timeZone } }),
      () => Message.UpdatedTeam({ outcome: { _tag: "Success" } }),
      (failure) => Message.UpdatedTeam({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const AddMember = Command.define("AddMember", {
  args: { teamId: TeamId, email: EmailAddress },
  messages: [Message.AddedMember],
  execute: ({ teamId, email }) =>
    runApi(
      (api) => api.directory.addMember({ params: { teamId }, payload: { email } }),
      () => Message.AddedMember({ outcome: { _tag: "Success" } }),
      (failure) => Message.AddedMember({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const AssignLead = Command.define("AssignLead", {
  args: { teamId: TeamId, email: EmailAddress },
  messages: [Message.AssignedLead],
  execute: ({ teamId, email }) =>
    runApi(
      (api) => api.directory.assignLead({ params: { teamId }, payload: { email } }),
      () => Message.AssignedLead({ outcome: { _tag: "Success" } }),
      (failure) => Message.AssignedLead({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const RemoveMember = Command.define("RemoveMember", {
  args: { teamId: TeamId, personId: PersonId },
  messages: [Message.RemovedMember],
  execute: ({ teamId, personId }) =>
    runApi(
      (api) => api.directory.removeMember({ params: { teamId, personId } }),
      () => Message.RemovedMember({ outcome: { _tag: "Success" } }),
      (failure) => Message.RemovedMember({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const RemoveLead = Command.define("RemoveLead", {
  args: { teamId: TeamId, personId: PersonId },
  messages: [Message.RemovedLead],
  execute: ({ teamId, personId }) =>
    runApi(
      (api) => api.directory.removeLead({ params: { teamId, personId } }),
      () => Message.RemovedLead({ outcome: { _tag: "Success" } }),
      (failure) => Message.RemovedLead({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetSettings = Command.define("GetSettings", {
  messages: [Message.GotSettings],
  execute: Effect.suspend(() =>
    runApi(
      (api) => api.directory.getSettings(),
      (settings) => Message.GotSettings({ outcome: { _tag: "Success", settings } }),
      (failure) => Message.GotSettings({ outcome: { _tag: "Failure", failure } }),
    ),
  ),
});

export const ListFailedEmails = Command.define("ListFailedEmails", {
  messages: [Message.GotFailedEmails],
  execute: Effect.suspend(() =>
    runApi(
      (api) => api.directory.listFailedEmails(),
      (list) => Message.GotFailedEmails({ outcome: { _tag: "Success", list } }),
      (failure) => Message.GotFailedEmails({ outcome: { _tag: "Failure", failure } }),
    ),
  ),
});

/** Sends a failed send again (ADR 0006). The update reads its state with `PollFailedEmailCmd`. */
export const ResendFailedEmailCmd = Command.define("ResendFailedEmailCmd", {
  args: { sendId: SendId },
  messages: [Message.ResentFailedEmail],
  execute: ({ sendId }) =>
    runApi(
      (api) => api.directory.resendFailedEmail({ params: { sendId } }),
      (status) => Message.ResentFailedEmail({ sendId, outcome: { _tag: "Success", status } }),
      (failure) => Message.ResentFailedEmail({ sendId, outcome: { _tag: "Failure", failure } }),
    ),
});

/** Reads a resent send's state after the poll interval. The update decides whether to read it again. */
export const PollFailedEmailCmd = Command.define("PollFailedEmailCmd", {
  args: { sendId: SendId },
  messages: [Message.PolledFailedEmail],
  execute: ({ sendId }) =>
    Effect.sleep(FAILED_EMAIL_POLL_INTERVAL).pipe(
      Effect.andThen(
        runApi(
          (api) => api.directory.getEmailStatus({ params: { sendId } }),
          (status) => Message.PolledFailedEmail({ sendId, outcome: { _tag: "Success", status } }),
          (failure) => Message.PolledFailedEmail({ sendId, outcome: { _tag: "Failure", failure } }),
        ),
      ),
    ),
});

/** The model with one row's Resend state replaced. */
const withFailedEmailResend = (model: Model, sendId: SendId, resend: FailedEmailResend): Model => ({
  ...model,
  failedEmailResends: { ...model.failedEmailResends, [sendId]: resend },
});

export const UpdateSettings = Command.define("UpdateSettings", {
  args: { minimumGroupSize: MinimumGroupSize },
  messages: [Message.UpdatedSettings],
  execute: ({ minimumGroupSize }) =>
    runApi(
      (api) => api.directory.updateSettings({ payload: { minimumGroupSize } }),
      () => Message.UpdatedSettings({ outcome: { _tag: "Success" } }),
      (failure) => Message.UpdatedSettings({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const UpdateAiProcessing = Command.define("UpdateAiProcessing", {
  args: { aiProcessing: Schema.Boolean },
  messages: [Message.UpdatedAiProcessing],
  execute: ({ aiProcessing }) =>
    runApi(
      (api) => api.directory.updateSettings({ payload: { aiProcessing } }),
      () => Message.UpdatedAiProcessing({ outcome: { _tag: "Success" } }),
      (failure) => Message.UpdatedAiProcessing({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const UpdateDefaultLanguage = Command.define("UpdateDefaultLanguage", {
  args: { defaultLocale: Locale },
  messages: [Message.UpdatedDefaultLanguage],
  execute: ({ defaultLocale }) =>
    runApi(
      (api) => api.directory.updateSettings({ payload: { defaultLocale } }),
      () => Message.UpdatedDefaultLanguage({ outcome: { _tag: "Success" } }),
      (failure) => Message.UpdatedDefaultLanguage({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GrantAdmin = Command.define("GrantAdmin", {
  args: { personId: PersonId },
  messages: [Message.GrantedAdmin],
  execute: ({ personId }) =>
    runApi(
      (api) => api.directory.grantAdmin({ params: { personId } }),
      () => Message.GrantedAdmin({ outcome: { _tag: "Success" } }),
      (failure) => Message.GrantedAdmin({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const RevokeAdmin = Command.define("RevokeAdmin", {
  args: { personId: PersonId },
  messages: [Message.RevokedAdmin],
  execute: ({ personId }) =>
    runApi(
      (api) => api.directory.revokeAdmin({ params: { personId } }),
      () => Message.RevokedAdmin({ outcome: { _tag: "Success" } }),
      (failure) => Message.RevokedAdmin({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const RemovePerson = Command.define("RemovePerson", {
  args: { personId: PersonId },
  messages: [Message.RemovedPerson],
  execute: ({ personId }) =>
    runApi(
      (api) => api.directory.removePerson({ params: { personId } }),
      () => Message.RemovedPerson({ outcome: { _tag: "Success" } }),
      (failure) => Message.RemovedPerson({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const ListPulses = Command.define("ListPulses", {
  args: { teamId: TeamId },
  messages: [Message.GotPulses],
  execute: ({ teamId }) =>
    runApi(
      (api) => api.pulses.listPulses({ params: { teamId } }),
      (pulses) => Message.GotPulses({ outcome: { _tag: "Success", pulses } }),
      (failure) => Message.GotPulses({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const CreatePulse = Command.define("CreatePulse", {
  args: { teamId: TeamId },
  messages: [Message.CreatedPulse],
  execute: ({ teamId }) =>
    runApi(
      (api) => api.pulses.createPulse({ params: { teamId } }),
      (detail) => Message.CreatedPulse({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.CreatedPulse({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetPulse = Command.define("GetPulse", {
  args: { teamId: TeamId, pulseId: PulseId },
  messages: [Message.GotPulse],
  execute: ({ teamId, pulseId }) =>
    runApi(
      (api) => api.pulses.getPulse({ params: { teamId, pulseId } }),
      (detail) => Message.GotPulse({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.GotPulse({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const UpdatePulseSettingsCmd = Command.define("UpdatePulseSettingsCmd", {
  args: { teamId: TeamId, pulseId: PulseId, settings: PulseSettings },
  messages: [Message.UpdatedPulse],
  execute: ({ teamId, pulseId, settings }) =>
    runApi(
      (api) => api.pulses.updatePulseSettings({ params: { teamId, pulseId }, payload: settings }),
      (detail) => Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.UpdatedPulse({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const SendTestInvitationCmd = Command.define("SendTestInvitationCmd", {
  args: { teamId: TeamId, pulseId: PulseId },
  messages: [Message.SentTestInvitation],
  execute: ({ teamId, pulseId }) =>
    runApi(
      (api) => api.pulses.sendTestInvitation({ params: { teamId, pulseId } }),
      (sent) =>
        Message.SentTestInvitation({
          outcome: { _tag: "Success", email: sent.email, sendId: sent.sendId, pulseId },
        }),
      (failure) => Message.SentTestInvitation({ outcome: { _tag: "Failure", failure } }),
    ),
});

/** Reads a test send's state after the poll interval. The update decides whether to read it again. */
export const PollTestSendCmd = Command.define("PollTestSendCmd", {
  args: { teamId: TeamId, pulseId: PulseId, sendId: SendId },
  messages: [Message.PolledTestSend],
  execute: ({ teamId, pulseId, sendId }) =>
    Effect.sleep(TEST_SEND_POLL_INTERVAL).pipe(
      Effect.andThen(
        runApi(
          (api) => api.pulses.getTestInvitation({ params: { teamId, pulseId, sendId } }),
          (status) => Message.PolledTestSend({ sendId, outcome: { _tag: "Success", status } }),
          (failure) => Message.PolledTestSend({ sendId, outcome: { _tag: "Failure", failure } }),
        ),
      ),
    ),
});

export const AddQuestionCmd = Command.define("AddQuestionCmd", {
  args: { teamId: TeamId, pulseId: PulseId, payload: NewPulseQuestion },
  messages: [Message.UpdatedPulse],
  execute: ({ teamId, pulseId, payload }) =>
    runApi(
      (api) =>
        api.pulses.addQuestion({
          params: { teamId, pulseId },
          payload,
        }),
      (detail) => Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.UpdatedPulse({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const EditQuestionCmd = Command.define("EditQuestionCmd", {
  args: { teamId: TeamId, pulseId: PulseId, questionId: QuestionId, payload: QuestionContent },
  messages: [Message.UpdatedPulse],
  execute: ({ teamId, pulseId, questionId, payload }) =>
    runApi(
      (api) =>
        api.pulses.editQuestion({
          params: { teamId, pulseId, questionId },
          payload,
        }),
      (detail) => Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.UpdatedPulse({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const RemoveQuestionCmd = Command.define("RemoveQuestionCmd", {
  args: { teamId: TeamId, pulseId: PulseId, questionId: QuestionId },
  messages: [Message.UpdatedPulse],
  execute: ({ teamId, pulseId, questionId }) =>
    runApi(
      (api) =>
        api.pulses.removeQuestion({
          params: { teamId, pulseId, questionId },
        }),
      (detail) => Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.UpdatedPulse({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const ReorderQuestionsCmd = Command.define("ReorderQuestionsCmd", {
  args: { teamId: TeamId, pulseId: PulseId, order: Schema.Array(QuestionId) },
  messages: [Message.UpdatedPulse],
  execute: ({ teamId, pulseId, order }) =>
    runApi(
      (api) =>
        api.pulses.reorderQuestions({
          params: { teamId, pulseId },
          payload: { order: Array.from(order) },
        }),
      (detail) => Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.UpdatedPulse({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const ListRoundsCmd = Command.define("ListRoundsCmd", {
  args: { teamId: TeamId, pulseId: PulseId },
  messages: [Message.GotRounds],
  execute: ({ teamId, pulseId }) =>
    runApi(
      (api) => api.rounds.listRounds({ params: { teamId, pulseId } }),
      (list) => Message.GotRounds({ outcome: { _tag: "Success", list } }),
      (failure) => Message.GotRounds({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetRoundDetailCmd = Command.define("GetRoundDetailCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.GotRoundDetail],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.rounds.getRound({ params: { teamId, roundId } }),
      (detail) => Message.GotRoundDetail({ roundId, outcome: { _tag: "Success", detail } }),
      (failure) => Message.GotRoundDetail({ roundId, outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetRoundRateCmd = Command.define("GetRoundRateCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.GotRoundRate],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.rounds.getResults({ params: { teamId, roundId } }),
      (result) => Message.GotRoundRate({ roundId, outcome: { _tag: "Success", result } }),
      (failure) => Message.GotRoundRate({ roundId, outcome: { _tag: "Failure", failure } }),
    ),
});

export const SkipWeekCmd = Command.define("SkipWeekCmd", {
  args: { teamId: TeamId, pulseId: PulseId, plannedOpenDate: Schema.String },
  messages: [Message.RoundCommandDone],
  execute: ({ teamId, pulseId, plannedOpenDate }) =>
    runApi(
      (api) => api.rounds.skipWeek({ params: { teamId, pulseId }, payload: { plannedOpenDate } }),
      () => Message.RoundCommandDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.RoundCommandDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const PausePulseCmd = Command.define("PausePulseCmd", {
  args: { teamId: TeamId, pulseId: PulseId },
  messages: [Message.RoundCommandDone],
  execute: ({ teamId, pulseId }) =>
    runApi(
      (api) => api.rounds.pausePulse({ params: { teamId, pulseId } }),
      () => Message.RoundCommandDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.RoundCommandDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const ResumePulseCmd = Command.define("ResumePulseCmd", {
  args: { teamId: TeamId, pulseId: PulseId },
  messages: [Message.RoundCommandDone],
  execute: ({ teamId, pulseId }) =>
    runApi(
      (api) => api.rounds.resumePulse({ params: { teamId, pulseId } }),
      () => Message.RoundCommandDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.RoundCommandDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const CloseRoundEarlyCmd = Command.define("CloseRoundEarlyCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.RoundCommandDone],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.rounds.closeRoundEarly({ params: { teamId, roundId } }),
      () => Message.RoundCommandDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.RoundCommandDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const CancelRoundCmd = Command.define("CancelRoundCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.RoundCommandDone],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.rounds.cancelRound({ params: { teamId, roundId } }),
      () => Message.RoundCommandDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.RoundCommandDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const ResendInvitationCmd = Command.define("ResendInvitationCmd", {
  args: { teamId: TeamId, roundId: RoundId, personId: PersonId },
  messages: [Message.RoundCommandDone],
  execute: ({ teamId, roundId, personId }) =>
    runApi(
      (api) => api.rounds.resendInvitation({ params: { teamId, roundId, personId } }),
      () => Message.RoundCommandDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.RoundCommandDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetResultsCmd = Command.define("GetResultsCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.GotResults],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.rounds.getResults({ params: { teamId, roundId } }),
      (result) => Message.GotResults({ outcome: { _tag: "Success", result } }),
      (failure) => Message.GotResults({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetMyHistoryCmd = Command.define("GetMyHistoryCmd", {
  messages: [Message.GotMyHistory],
  execute: Effect.suspend(() =>
    // The request carries nothing from this device: the kept answers are read only once the history has loaded.
    runApi(
      (api) => api.rounds.getMyHistory({}),
      (history) => {
        const storage = browserStorage();
        const kept = storage === null ? {} : readKeptAnswers(storage, Date.now());
        return Message.GotMyHistory({ outcome: { _tag: "Success", history, kept } });
      },
      (failure) => Message.GotMyHistory({ outcome: { _tag: "Failure", failure } }),
    ),
  ),
});

export const ClearKeptAnswersCmd = Command.define("ClearKeptAnswersCmd", {
  messages: [Message.ClearedKeptAnswers],
  execute: Effect.sync(() => {
    const storage = browserStorage();
    if (storage !== null) clearKeptAnswers(storage);
    return Message.ClearedKeptAnswers();
  }),
});

export const CopyGuideTextCmd = Command.define("CopyGuideTextCmd", {
  args: { text: Schema.String },
  messages: [Message.CopiedGuide],
  execute: ({ text }) =>
    Effect.tryPromise({
      try: () => navigator.clipboard.writeText(text),
      catch: (): "copyFailed" => "copyFailed",
    }).pipe(
      Effect.match({
        onSuccess: () => Message.CopiedGuide({ ok: true }),
        onFailure: () => Message.CopiedGuide({ ok: false }),
      }),
    ),
});

export const ShareResultsCmd = Command.define("ShareResultsCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.ResultsShareDone],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.rounds.shareResults({ params: { teamId, roundId } }),
      () => Message.ResultsShareDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.ResultsShareDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const RetryResultCmd = Command.define("RetryResultCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.RetryResultDone],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.rounds.retryResult({ params: { teamId, roundId } }),
      () => Message.RetryResultDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.RetryResultDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const ListActionsCmd = Command.define("ListActionsCmd", {
  args: { teamId: TeamId },
  messages: [Message.GotActions],
  execute: ({ teamId }) =>
    runApi(
      (api) => api.actions.listActions({ params: { teamId } }),
      (list) => Message.GotActions({ outcome: { _tag: "Success", list } }),
      (failure) => Message.GotActions({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const CreateActionCmd = Command.define("CreateActionCmd", {
  args: {
    teamId: TeamId,
    roundId: RoundId,
    title: Schema.String,
    ownerId: PersonId,
    dueDate: Schema.NullOr(Schema.String),
    dimension: Schema.NullOr(Dimension),
  },
  messages: [Message.CreatedAction],
  execute: ({ teamId, roundId, title, ownerId, dueDate, dimension }) =>
    runApi(
      (api) =>
        api.actions.createAction({
          params: { teamId },
          payload: { roundId, title, ownerId, dueDate, dimension },
        }),
      (action) => Message.CreatedAction({ outcome: { _tag: "Success", action } }),
      (failure) => Message.CreatedAction({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const UpdateActionCmd = Command.define("UpdateActionCmd", {
  args: {
    teamId: TeamId,
    actionId: ActionId,
    status: ActionStatus,
  },
  messages: [Message.UpdatedAction],
  execute: ({ teamId, actionId, status }) =>
    runApi(
      (api) =>
        api.actions.updateAction({
          params: { teamId, actionId },
          payload: { status },
        }),
      (action) => Message.UpdatedAction({ outcome: { _tag: "Success", action } }),
      (failure) => Message.UpdatedAction({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetRoundNoteCmd = Command.define("GetRoundNoteCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.GotRoundNote],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.notes.getRoundNote({ params: { teamId, roundId } }),
      (view) => Message.GotRoundNote({ outcome: { _tag: "Success", view } }),
      (failure) => Message.GotRoundNote({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const SaveRoundNoteCmd = Command.define("SaveRoundNoteCmd", {
  args: { teamId: TeamId, roundId: RoundId, text: Schema.String },
  messages: [Message.SavedNote],
  execute: ({ teamId, roundId, text }) =>
    runApi(
      (api) => api.notes.saveRoundNote({ params: { teamId, roundId }, payload: { text } }),
      (view) => Message.SavedNote({ outcome: { _tag: "Success", view } }),
      (failure) => Message.SavedNote({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const Navigate = Command.define("Navigate", {
  args: { url: Schema.String },
  messages: [Message.Navigated],
  execute: ({ url }) => Navigation.pushUrl(url).pipe(Effect.as(Message.Navigated())),
});

export const LoadExternalUrl = Command.define("LoadExternalUrl", {
  args: { href: Schema.String },
  messages: [Message.Navigated],
  execute: ({ href }) => Navigation.load(href).pipe(Effect.as(Message.Navigated())),
});

// ==========================================
// INIT
// ==========================================

/** The browser's language, read once at start-up. `null` when there is no browser or none of its languages is SurveyBeat's. */
const detectBrowserLocale = (): Locale | null =>
  typeof navigator === "undefined" ? null : (browserLocale(navigator.languages) ?? null);

export const initialModel = (url: Url): Model => {
  const route = urlToAppRoute(url);
  const timeZone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  return {
    url,
    route,
    session: { _tag: "Loading" },
    browserLocale: detectBrowserLocale(),
    languageBusy: false,
    languageFailure: Option.none(),
    teams: { _tag: "Loading" },
    createTeamName: "",
    createTeamTimeZone: timeZone,
    createTeamLeadEmail: "",
    createTeamBusy: false,
    createTeamFailure: Option.none(),
    teamDetail: { _tag: "Loading" },
    teamOverview: { _tag: "Loading" },
    renameName: "",
    renameTimeZone: timeZone,
    renameBusy: false,
    renameFailure: Option.none(),
    addMemberEmail: "",
    addMemberBusy: false,
    addMemberAdded: false,
    addMemberFailure: Option.none(),
    assignLeadEmail: "",
    assignLeadBusy: false,
    assignLeadAdded: false,
    assignLeadFailure: Option.none(),
    rosterBusy: false,
    rosterFailure: Option.none(),
    settings: { _tag: "Loading" },
    size: "3",
    sizeSaved: false,
    sizeBusy: false,
    sizeFailure: Option.none(),
    aiBusy: false,
    aiFailure: Option.none(),
    defaultLanguageBusy: false,
    defaultLanguageFailure: Option.none(),
    peopleBusy: false,
    peopleFailure: Option.none(),
    failedEmails: { _tag: "Loading" },
    failedEmailResends: {},
    pulses: { _tag: "Loading" },
    createPulseBusy: false,
    createPulseFailure: Option.none(),
    pulseDetail: { _tag: "Loading" },
    pulseActionBusy: false,
    pulseActionFailure: Option.none(),
    writingQuestion: false,
    editingQuestionId: Option.none(),
    formText: "",
    formKind: "Rating",
    formDimension: "none",
    formLowLabel: "",
    formHighLabel: "",
    formComment: true,
    formOptions: "",
    formBusy: false,
    formFailure: Option.none(),
    settingsName: "",
    settingsDay: "monday",
    settingsTime: "09:00",
    settingsWindow: 3,
    settingsReviewWindow: 3,
    settingsReminders: 1,
    settingsSaved: false,
    settingsBusy: false,
    settingsFailure: Option.none(),
    testSendBusy: false,
    testSendResult: Option.none(),
    rounds: { _tag: "Loading" },
    roundDetails: {},
    roundRates: {},
    roundConfirm: Option.none(),
    roundsSkipDate: "",
    roundsBusy: false,
    roundsFailure: Option.none(),
    results: { _tag: "Loading" },
    showTable: {},
    history: { _tag: "Loading" },
    guideCopy: "idle",
    shareBusy: false,
    shareFailure: Option.none(),
    retryBusy: false,
    retryFailure: Option.none(),
    actions: { _tag: "Loading" },
    actionTitle: "",
    actionOwnerId: Option.none(),
    actionDueDate: "",
    actionDimension: "none",
    actionBusy: false,
    actionFailure: Option.none(),
    roundNote: { _tag: "Loading" },
    noteDraft: "",
    noteEditing: false,
    noteBusy: false,
    noteFailure: Option.none(),
  };
};

export const loadActiveRouteCommand = (route: AppRoute) => {
  switch (route._tag) {
    case "Teams":
      return [ListTeams()];
    case "Team":
      return [GetTeam({ teamId: route.teamId }), GetTeamOverviewCmd({ teamId: route.teamId })];
    case "History":
      return [GetMyHistoryCmd()];
    case "Settings":
      return [GetSettings(), ListFailedEmails()];
    case "Pulses":
      return [ListPulses({ teamId: route.teamId })];
    case "Pulse":
      return [GetPulse({ teamId: route.teamId, pulseId: route.pulseId })];
    case "Rounds":
      // The Team loads first: its role decides which follow-up calls the Rounds screen makes.
      return [GetTeam({ teamId: route.teamId })];
    case "RoundResults":
      return [
        GetResultsCmd({ teamId: route.teamId, roundId: route.roundId }),
        ListActionsCmd({ teamId: route.teamId }),
        GetRoundNoteCmd({ teamId: route.teamId, roundId: route.roundId }),
        GetTeam({ teamId: route.teamId }),
      ];
    case "Privacy":
    case "NotFound":
      return [];
  }
};

export const init = (url: Url): Update.Return<Model, Message> => ({
  model: initialModel(url),
  commands: [LoadSession()],
});

// ==========================================
// UPDATE
// ==========================================

/** A language `<select>` value: "" follows the browser (`null`); anything else that is not a Locale is ignored (`undefined`). */
const languageChoice = (value: string): Locale | null | undefined => {
  if (value === "") return null;
  return Schema.is(Locale)(value) ? value : undefined;
};

/** True when a Note response belongs to the Round on screen. */
const isCurrentRoundNote = (model: Model, roundId: RoundId): boolean =>
  model.route._tag === "RoundResults" && model.route.roundId === roundId;

export const update = (model: Model, message: Message): Update.Return<Model, Message> => {
  switch (message._tag) {
    // ----------------------------------------
    // Navigation
    // ----------------------------------------
    case "UrlRequested": {
      const { request } = message;
      if (request._tag === "Internal") {
        const path =
          request.url.pathname + (Option.isSome(request.url.search) ? `?${request.url.search.value}` : "");
        if (request.url.pathname.startsWith("/auth/")) {
          return {
            model,
            commands: [LoadExternalUrl({ href: path })],
          };
        }
        return {
          model,
          commands: [Navigate({ url: path })],
        };
      } else {
        return {
          model,
          commands: [LoadExternalUrl({ href: request.href })],
        };
      }
    }

    case "UrlChanged": {
      const route = urlToAppRoute(message.url);
      const nextModel: Model = {
        ...model,
        url: message.url,
        route,
        teamDetail: { _tag: "Loading" },
        teamOverview: { _tag: "Loading" },
        history: { _tag: "Loading" },
        pulses: { _tag: "Loading" },
        pulseDetail: { _tag: "Loading" },
        testSendBusy: false,
        testSendResult: Option.none(),
        settings: { _tag: "Loading" },
        failedEmails: { _tag: "Loading" },
        failedEmailResends: {},
        teams: { _tag: "Loading" },
        results: { _tag: "Loading" },
        guideCopy: "idle",
        shareBusy: false,
        shareFailure: Option.none(),
        retryBusy: false,
        retryFailure: Option.none(),
        rounds: { _tag: "Loading" },
        roundDetails: {},
        roundRates: {},
        roundConfirm: Option.none(),
        roundsSkipDate: "",
        roundsBusy: false,
        roundsFailure: Option.none(),
        actions: { _tag: "Loading" },
        actionTitle: "",
        actionOwnerId: Option.none(),
        actionDueDate: "",
        actionDimension: "none",
        actionBusy: false,
        actionFailure: Option.none(),
        roundNote: { _tag: "Loading" },
        noteDraft: "",
        noteEditing: false,
        noteBusy: false,
        noteFailure: Option.none(),
      };
      if (model.session._tag === "SignedIn") {
        return {
          model: nextModel,
          commands: loadActiveRouteCommand(route),
        };
      }
      return { model: nextModel };
    }

    case "Navigated":
      return { model };

    // ----------------------------------------
    // Session
    // ----------------------------------------
    case "GotSession": {
      const sessionResult = message.result;
      const failedParam = Option.isSome(model.url.search) && model.url.search.value.includes("signin=failed");

      switch (sessionResult._tag) {
        case "SignedOut":
          return {
            model: {
              ...model,
              session: { _tag: "SignedOut", failed: failedParam },
            },
          };
        case "Failed":
          return {
            model: {
              ...model,
              session: { _tag: "Failed" },
            },
          };
        case "CreateOrganization":
          return {
            model: {
              ...model,
              session: { _tag: "CreateOrganization", name: "", busy: false },
            },
          };
        case "NotInOrganization":
          return {
            model: {
              ...model,
              session: { _tag: "NotInOrganization" },
            },
          };
        case "ChooseOrganization":
          return {
            model: {
              ...model,
              session: {
                _tag: "ChooseOrganization",
                organizations: sessionResult.organizations,
                busy: false,
              },
            },
          };
        case "SignedIn": {
          const nextModel: Model = {
            ...model,
            session: {
              _tag: "SignedIn",
              organization: sessionResult.organization,
              organizationAdmin: sessionResult.organizationAdmin,
              locale: sessionResult.locale,
              detectedLocale: sessionResult.detectedLocale,
              organizationLocale: sessionResult.organizationLocale,
            },
          };
          // A Person who has not chosen a language gets the browser's language recorded once (ADR 0018).
          const detect =
            sessionResult.locale === null &&
            model.browserLocale !== null &&
            model.browserLocale !== sessionResult.detectedLocale;
          return {
            model: nextModel,
            commands: [
              ...loadActiveRouteCommand(model.route),
              ...(detect ? [UpdateOwnLanguage({ detectedLocale: model.browserLocale })] : []),
            ],
          };
        }
      }
    }

    case "RetrySession":
      return {
        model: { ...model, session: { _tag: "Loading" } },
        commands: [LoadSession()],
      };

    case "CreateOrgNameChanged":
      if (model.session._tag === "CreateOrganization") {
        return {
          model: {
            ...model,
            session: { ...model.session, name: message.name },
          },
        };
      }
      return { model };

    case "SubmitCreateOrg":
      if (model.session._tag === "CreateOrganization") {
        const name = model.session.name.trim();
        if (name === "") return { model };
        return {
          model: {
            ...model,
            session: { ...model.session, busy: true },
          },
          commands: [CreateOrganization({ name })],
        };
      }
      return { model };

    case "ChooseOrgClicked":
      if (model.session._tag === "ChooseOrganization") {
        return {
          model: {
            ...model,
            session: { ...model.session, busy: true },
          },
          commands: [ChooseOrganization({ organizationId: message.organizationId })],
        };
      }
      return { model };

    case "LanguageChanged": {
      const choice = languageChoice(message.value);
      if (choice === undefined || model.languageBusy || model.session._tag !== "SignedIn") return { model };
      if (choice === model.session.locale) return { model };
      return {
        model: {
          ...model,
          session: { ...model.session, locale: choice },
          languageBusy: true,
          languageFailure: Option.none(),
        },
        commands: [UpdateOwnLanguage({ locale: choice })],
      };
    }

    case "UpdatedOwnLanguage": {
      const { chosen, outcome } = message;
      // Only a language the Person chose shows progress or a problem; a recorded browser language is best effort.
      const settled: Model = chosen ? { ...model, languageBusy: false } : model;
      if (outcome._tag === "Success") {
        return chosen ? { model: settled, commands: [LoadSession()] } : { model };
      }
      if (outcome.failure === "Unauthenticated") {
        return { model: settled, commands: [LoadSession()] };
      }
      if (!chosen) return { model };
      // LoadSession brings back the stored language, so the select shows what the server holds again.
      return {
        model: { ...settled, languageFailure: Option.some(outcome.failure) },
        commands: [LoadSession()],
      };
    }

    // ----------------------------------------
    // Teams screen
    // ----------------------------------------
    case "GotTeams": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        return {
          model: {
            ...model,
            teams: { _tag: "Loaded", teams: outcome.teams },
          },
        };
      }
      if (outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          teams: { _tag: "Failed", failure: outcome.failure },
        },
      };
    }

    case "CreateTeamNameChanged":
      return { model: { ...model, createTeamName: message.name } };

    case "CreateTeamTimeZoneChanged":
      return { model: { ...model, createTeamTimeZone: message.tz } };

    case "CreateTeamLeadEmailChanged":
      return { model: { ...model, createTeamLeadEmail: message.email } };

    case "SubmitCreateTeam": {
      const n = decodeName(model.createTeamName.trim());
      const z = decodeZone(model.createTeamTimeZone.trim());
      const e = decodeEmail(model.createTeamLeadEmail.trim());
      if (Option.isNone(n) || Option.isNone(z) || Option.isNone(e)) {
        return {
          model: { ...model, createTeamFailure: Option.some("Invalid") },
        };
      }
      return {
        model: { ...model, createTeamBusy: true, createTeamFailure: Option.none() },
        commands: [CreateTeam({ name: n.value, timeZone: z.value, leadEmail: e.value })],
      };
    }

    case "CreatedTeam": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        const nextUrl = teamHref(outcome.detail.team.id);
        return {
          model: { ...model, createTeamBusy: false },
          commands: [Navigate({ url: nextUrl })],
        };
      }
      if (outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          createTeamBusy: false,
          createTeamFailure: Option.some(outcome.failure),
        },
      };
    }

    // ----------------------------------------
    // Team detail screen
    // ----------------------------------------
    case "GotTeam": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        return {
          model: {
            ...model,
            teamDetail: { _tag: "Loaded", detail: outcome.detail },
            renameName: outcome.detail.team.name,
            renameTimeZone: outcome.detail.team.timeZone,
          },
          commands:
            model.route._tag === "Rounds"
              ? [ListRoundsCmd({ teamId: model.route.teamId, pulseId: model.route.pulseId })]
              : [],
        };
      }
      if (outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          teamDetail: { _tag: "Failed", failure: outcome.failure },
        },
      };
    }

    case "RenameNameChanged":
      return { model: { ...model, renameName: message.name } };

    case "RenameTimeZoneChanged":
      return { model: { ...model, renameTimeZone: message.tz } };

    case "SubmitRenameTeam": {
      if (model.teamDetail._tag !== "Loaded") return { model };
      const teamId = model.teamDetail.detail.team.id;
      const n = decodeName(model.renameName.trim());
      const z = decodeZone(model.renameTimeZone.trim());
      if (Option.isNone(n) || Option.isNone(z)) {
        return { model: { ...model, renameFailure: Option.some("Invalid") } };
      }
      return {
        model: { ...model, renameBusy: true, renameFailure: Option.none() },
        commands: [UpdateTeam({ teamId, name: n.value, timeZone: z.value })],
      };
    }

    case "UpdatedTeam": {
      if (model.teamDetail._tag !== "Loaded") return { model };
      const teamId = model.teamDetail.detail.team.id;
      if (message.outcome._tag === "Success") {
        return {
          model: { ...model, renameBusy: false },
          commands: [GetTeam({ teamId })],
        };
      }
      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          renameBusy: false,
          renameFailure: Option.some(message.outcome.failure),
        },
      };
    }

    case "AddMemberEmailChanged":
      return { model: { ...model, addMemberEmail: message.email, addMemberAdded: false } };

    case "SubmitAddMember": {
      if (model.teamDetail._tag !== "Loaded") return { model };
      const teamId = model.teamDetail.detail.team.id;
      const e = decodeEmail(model.addMemberEmail.trim());
      if (Option.isNone(e)) {
        return { model: { ...model, addMemberFailure: Option.some("Invalid") } };
      }
      return {
        model: { ...model, addMemberBusy: true, addMemberFailure: Option.none() },
        commands: [AddMember({ teamId, email: e.value })],
      };
    }

    case "AddedMember": {
      if (model.teamDetail._tag !== "Loaded") return { model };
      const teamId = model.teamDetail.detail.team.id;
      if (message.outcome._tag === "Success") {
        return {
          model: {
            ...model,
            addMemberBusy: false,
            addMemberAdded: true,
            addMemberEmail: "",
          },
          commands: [GetTeam({ teamId })],
        };
      }
      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          addMemberBusy: false,
          addMemberFailure: Option.some(message.outcome.failure),
        },
      };
    }

    case "AssignLeadEmailChanged":
      return { model: { ...model, assignLeadEmail: message.email, assignLeadAdded: false } };

    case "SubmitAssignLead": {
      if (model.teamDetail._tag !== "Loaded") return { model };
      const teamId = model.teamDetail.detail.team.id;
      const e = decodeEmail(model.assignLeadEmail.trim());
      if (Option.isNone(e)) {
        return { model: { ...model, assignLeadFailure: Option.some("Invalid") } };
      }
      return {
        model: { ...model, assignLeadBusy: true, assignLeadFailure: Option.none() },
        commands: [AssignLead({ teamId, email: e.value })],
      };
    }

    case "AssignedLead": {
      if (model.teamDetail._tag !== "Loaded") return { model };
      const teamId = model.teamDetail.detail.team.id;
      if (message.outcome._tag === "Success") {
        return {
          model: {
            ...model,
            assignLeadBusy: false,
            assignLeadAdded: true,
            assignLeadEmail: "",
          },
          commands: [GetTeam({ teamId })],
        };
      }
      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          assignLeadBusy: false,
          assignLeadFailure: Option.some(message.outcome.failure),
        },
      };
    }

    case "RemoveMemberClicked": {
      if (model.teamDetail._tag !== "Loaded") return { model };
      const teamId = model.teamDetail.detail.team.id;
      return {
        model: { ...model, rosterBusy: true, rosterFailure: Option.none() },
        commands: [RemoveMember({ teamId, personId: message.personId })],
      };
    }

    case "RemovedMember": {
      if (model.teamDetail._tag !== "Loaded") return { model };
      const teamId = model.teamDetail.detail.team.id;
      if (message.outcome._tag === "Success") {
        return {
          model: { ...model, rosterBusy: false },
          commands: [GetTeam({ teamId })],
        };
      }
      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          rosterBusy: false,
          rosterFailure: Option.some(message.outcome.failure),
        },
      };
    }

    case "RemoveLeadClicked": {
      if (model.teamDetail._tag !== "Loaded") return { model };
      const teamId = model.teamDetail.detail.team.id;
      return {
        model: { ...model, rosterBusy: true, rosterFailure: Option.none() },
        commands: [RemoveLead({ teamId, personId: message.personId })],
      };
    }

    case "RemovedLead": {
      if (model.teamDetail._tag !== "Loaded") return { model };
      const teamId = model.teamDetail.detail.team.id;
      if (message.outcome._tag === "Success") {
        return {
          model: { ...model, rosterBusy: false },
          commands: [GetTeam({ teamId })],
        };
      }
      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          rosterBusy: false,
          rosterFailure: Option.some(message.outcome.failure),
        },
      };
    }

    // ----------------------------------------
    // Settings screen
    // ----------------------------------------
    case "GotSettings": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        return {
          model: {
            ...model,
            settings: { _tag: "Loaded", settings: outcome.settings },
            size: String(outcome.settings.minimumGroupSize),
          },
        };
      }
      if (outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          settings: { _tag: "Failed", failure: outcome.failure },
        },
      };
    }

    case "GotFailedEmails": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        return { model: { ...model, failedEmails: { _tag: "Loaded", list: outcome.list } } };
      }
      if (outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return { model: { ...model, failedEmails: { _tag: "Failed", failure: outcome.failure } } };
    }

    case "ResendFailedEmailClicked": {
      const { sendId } = message;
      const current = model.failedEmailResends[sendId];
      // A send is resent once at a time: a click while its Resend is in flight, or while it is queued or sending, does nothing.
      if (
        model.failedEmails._tag !== "Loaded" ||
        current?._tag === "Resending" ||
        (current?._tag === "Resent" && current.state._tag !== "Failed") ||
        (current?._tag === "Failed" && current.failure === "EmailNotResendable")
      ) {
        return { model };
      }
      return {
        model: withFailedEmailResend(model, sendId, { _tag: "Resending" }),
        commands: [ResendFailedEmailCmd({ sendId })],
      };
    }

    case "ResentFailedEmail": {
      const { sendId, outcome } = message;
      // A reply for a row that is no longer waiting on its Resend (the admin navigated away since) is dropped.
      if (model.failedEmailResends[sendId]?._tag !== "Resending") return { model };
      if (outcome._tag === "Failure") {
        const failed = withFailedEmailResend(model, sendId, { _tag: "Failed", failure: outcome.failure });
        return outcome.failure === "Unauthenticated"
          ? { model: failed, commands: [LoadSession()] }
          : { model: failed };
      }
      const { state } = outcome.status;
      const next = withFailedEmailResend(model, sendId, {
        _tag: "Resent",
        state,
        polls: 0,
        statusUnavailable: false,
      });
      if (!failedEmailKeepsPolling(state, 0)) return { model: next };
      return { model: next, commands: [PollFailedEmailCmd({ sendId })] };
    }

    case "PolledFailedEmail": {
      const { sendId, outcome } = message;
      const current = model.failedEmailResends[sendId];
      // A read for a row that is no longer resent (the admin navigated away since) is dropped.
      if (current?._tag !== "Resent") return { model };
      if (outcome._tag === "Failure") {
        const failed = withFailedEmailResend(model, sendId, { ...current, statusUnavailable: true });
        return outcome.failure === "Unauthenticated"
          ? { model: failed, commands: [LoadSession()] }
          : { model: failed };
      }
      const polls = current.polls + 1;
      const { state } = outcome.status;
      const keepsPolling = failedEmailKeepsPolling(state, polls);
      const settled = state._tag === "Sent" || state._tag === "Failed";
      const next = withFailedEmailResend(model, sendId, {
        _tag: "Resent",
        state,
        polls,
        // Gave up while still queued or sending: say so, so the admin knows to reload.
        statusUnavailable: !keepsPolling && !settled,
      });
      if (!keepsPolling) return { model: next };
      return { model: next, commands: [PollFailedEmailCmd({ sendId })] };
    }

    case "SizeChanged":
      return { model: { ...model, size: message.size, sizeSaved: false } };

    case "SubmitSize": {
      const parsed = decodeSize(Number(model.size));
      if (Option.isNone(parsed)) {
        return { model: { ...model, sizeFailure: Option.some("Invalid") } };
      }
      return {
        model: { ...model, sizeBusy: true, sizeFailure: Option.none(), sizeSaved: false },
        commands: [UpdateSettings({ minimumGroupSize: parsed.value })],
      };
    }

    case "UpdatedSettings": {
      if (message.outcome._tag === "Success") {
        return {
          model: { ...model, sizeBusy: false, sizeSaved: true },
          commands: [GetSettings()],
        };
      }
      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          sizeBusy: false,
          sizeFailure: Option.some(message.outcome.failure),
        },
      };
    }

    case "AiProcessingToggled":
      // A click on the checkbox can arrive twice (label and input); ignore toggles while saving.
      if (model.aiBusy) return { model };
      return {
        model: { ...model, aiBusy: true, aiFailure: Option.none() },
        commands: [UpdateAiProcessing({ aiProcessing: message.isOn })],
      };

    case "UpdatedAiProcessing": {
      if (message.outcome._tag === "Success") {
        return {
          model: { ...model, aiBusy: false },
          commands: [GetSettings()],
        };
      }
      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: { ...model, aiBusy: false, aiFailure: Option.some(message.outcome.failure) },
      };
    }

    case "DefaultLanguageChanged": {
      const defaultLocale = Schema.is(Locale)(message.value) ? message.value : undefined;
      if (defaultLocale === undefined || model.defaultLanguageBusy) return { model };
      return {
        model: { ...model, defaultLanguageBusy: true, defaultLanguageFailure: Option.none() },
        commands: [UpdateDefaultLanguage({ defaultLocale })],
      };
    }

    case "UpdatedDefaultLanguage": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        // The default reaches every Person without a choice: reloading the session reloads the settings too.
        return {
          model: { ...model, defaultLanguageBusy: false },
          commands: [LoadSession()],
        };
      }
      if (outcome.failure === "Unauthenticated") {
        return { model: { ...model, defaultLanguageBusy: false }, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          defaultLanguageBusy: false,
          defaultLanguageFailure: Option.some(outcome.failure),
        },
      };
    }

    case "GrantAdminClicked":
      return {
        model: { ...model, peopleBusy: true, peopleFailure: Option.none() },
        commands: [GrantAdmin({ personId: message.personId })],
      };

    case "GrantedAdmin": {
      if (message.outcome._tag === "Success") {
        return {
          model: { ...model, peopleBusy: false },
          commands: [GetSettings()],
        };
      }
      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          peopleBusy: false,
          peopleFailure: Option.some(message.outcome.failure),
        },
      };
    }

    case "RevokeAdminClicked":
      return {
        model: { ...model, peopleBusy: true, peopleFailure: Option.none() },
        commands: [RevokeAdmin({ personId: message.personId })],
      };

    case "RevokedAdmin": {
      if (message.outcome._tag === "Success") {
        return {
          model: { ...model, peopleBusy: false },
          commands: [GetSettings()],
        };
      }
      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          peopleBusy: false,
          peopleFailure: Option.some(message.outcome.failure),
        },
      };
    }

    case "RemovePersonClicked":
      return {
        model: { ...model, peopleBusy: true, peopleFailure: Option.none() },
        commands: [RemovePerson({ personId: message.personId })],
      };

    case "RemovedPerson": {
      if (message.outcome._tag === "Success") {
        return {
          model: { ...model, peopleBusy: false },
          commands: [GetSettings()],
        };
      }
      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          peopleBusy: false,
          peopleFailure: Option.some(message.outcome.failure),
        },
      };
    }

    // ----------------------------------------
    // Pulses list screen
    // ----------------------------------------
    case "GotPulses": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        return {
          model: {
            ...model,
            pulses: { _tag: "Loaded", pulses: outcome.pulses },
          },
        };
      }
      if (outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          pulses: { _tag: "Failed", failure: outcome.failure },
        },
      };
    }

    case "CreatePulseClicked": {
      if (model.route._tag !== "Pulses") return { model };
      const teamId = model.route.teamId;
      return {
        model: { ...model, createPulseBusy: true, createPulseFailure: Option.none() },
        commands: [CreatePulse({ teamId })],
      };
    }

    case "CreatedPulse": {
      if (model.route._tag !== "Pulses") return { model };
      const teamId = model.route.teamId;
      if (message.outcome._tag === "Success") {
        const nextUrl = pulseHref(teamId, message.outcome.detail.id);
        return {
          model: { ...model, createPulseBusy: false },
          commands: [Navigate({ url: nextUrl })],
        };
      }
      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          createPulseBusy: false,
          createPulseFailure: Option.some(message.outcome.failure),
        },
      };
    }

    // ----------------------------------------
    // Pulse editor screen
    // ----------------------------------------
    case "GotPulse": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        const { detail } = outcome;
        return {
          model: {
            ...model,
            pulseDetail: { _tag: "Loaded", detail },
            settingsName: detail.settings.name,
            settingsDay: detail.settings.cadence.day,
            settingsTime: detail.settings.cadence.time,
            settingsWindow: detail.settings.answerWindowDays,
            settingsReviewWindow: detail.settings.reviewWindowDays,
            settingsReminders: detail.settings.reminders,
          },
        };
      }
      if (outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          pulseDetail: { _tag: "Failed", failure: outcome.failure },
        },
      };
    }

    case "MoveQuestionClicked": {
      if (model.pulseDetail._tag !== "Loaded") return { model };
      const { detail } = model.pulseDetail;
      const order: Array<QuestionId> = detail.questions.map((q) => q.questionId);
      const [moved] = order.splice(message.index, 1);
      if (moved === undefined) return { model };
      order.splice(message.index + message.by, 0, moved);
      return {
        model: { ...model, pulseActionBusy: true, pulseActionFailure: Option.none() },
        commands: [
          ReorderQuestionsCmd({
            teamId: detail.team.id,
            pulseId: detail.id,
            order,
          }),
        ],
      };
    }

    case "ToggleEditQuestion": {
      if (!Option.isSome(message.questionId)) {
        return {
          model: {
            ...model,
            editingQuestionId: Option.none(),
            formFailure: Option.none(),
          },
        };
      }
      const targetId = message.questionId.value;
      if (model.pulseDetail._tag !== "Loaded") return { model };
      const q = model.pulseDetail.detail.questions.find((question) => question.questionId === targetId);
      if (!q) return { model };
      return {
        model: {
          ...model,
          editingQuestionId: Option.some(targetId),
          formText: q.text,
          formKind: q.type._tag,
          formDimension: q.dimension ?? "none",
          formLowLabel: q.type._tag === "Rating" ? q.type.lowLabel : "",
          formHighLabel: q.type._tag === "Rating" ? q.type.highLabel : "",
          formComment: q.type._tag === "Rating" ? q.type.comment : true,
          formOptions: q.type._tag === "SingleChoice" ? q.type.options.join("\n") : "",
          formFailure: Option.none(),
        },
      };
    }

    case "RemoveQuestionClicked": {
      if (model.pulseDetail._tag !== "Loaded") return { model };
      const { detail } = model.pulseDetail;
      return {
        model: { ...model, pulseActionBusy: true, pulseActionFailure: Option.none() },
        commands: [
          RemoveQuestionCmd({
            teamId: detail.team.id,
            pulseId: detail.id,
            questionId: message.questionId,
          }),
        ],
      };
    }

    case "AddTemplateQuestionClicked": {
      if (model.pulseDetail._tag !== "Loaded") return { model };
      const { detail } = model.pulseDetail;
      return {
        model: { ...model, pulseActionBusy: true, pulseActionFailure: Option.none() },
        commands: [
          AddQuestionCmd({
            teamId: detail.team.id,
            pulseId: detail.id,
            payload: { _tag: "FromTemplate", key: message.key },
          }),
        ],
      };
    }

    case "ToggleWritingQuestion":
      return {
        model: {
          ...model,
          writingQuestion: message.writing,
          formText: "",
          formKind: "Rating",
          formDimension: "none",
          formLowLabel: "",
          formHighLabel: "",
          formComment: true,
          formOptions: "",
          formFailure: Option.none(),
        },
      };

    case "FormTextChanged":
      return { model: { ...model, formText: message.text } };

    case "FormKindChanged":
      return { model: { ...model, formKind: message.kind } };

    case "FormDimensionChanged":
      return { model: { ...model, formDimension: message.dim } };

    case "FormLowLabelChanged":
      return { model: { ...model, formLowLabel: message.low } };

    case "FormHighLabelChanged":
      return { model: { ...model, formHighLabel: message.high } };

    case "FormCommentToggled":
      return { model: { ...model, formComment: message.comment } };

    case "FormOptionsChanged":
      return { model: { ...model, formOptions: message.options } };

    case "SubmitQuestionForm": {
      if (model.pulseDetail._tag !== "Loaded") return { model };
      const { detail } = model.pulseDetail;
      const typed: QuestionType =
        model.formKind === "Rating"
          ? {
              _tag: "Rating",
              lowLabel: model.formLowLabel.trim(),
              highLabel: model.formHighLabel.trim(),
              comment: model.formComment,
            }
          : model.formKind === "SingleChoice"
            ? {
                _tag: "SingleChoice",
                options: model.formOptions
                  .split("\n")
                  .map((opt) => opt.trim())
                  .filter((opt) => opt !== ""),
              }
            : { _tag: "LongText" };

      const parsed = decodeContent({
        text: model.formText.trim(),
        dimension: model.formDimension === "none" ? null : model.formDimension,
        type: typed,
      });

      if (Option.isNone(parsed)) {
        return { model: { ...model, formFailure: Option.some("Invalid") } };
      }

      if (message.mode === "Add") {
        return {
          model: { ...model, formBusy: true, formFailure: Option.none() },
          commands: [
            AddQuestionCmd({
              teamId: detail.team.id,
              pulseId: detail.id,
              payload: { _tag: "Written", ...parsed.value },
            }),
          ],
        };
      } else {
        if (Option.isNone(model.editingQuestionId)) return { model };
        return {
          model: { ...model, formBusy: true, formFailure: Option.none() },
          commands: [
            EditQuestionCmd({
              teamId: detail.team.id,
              pulseId: detail.id,
              questionId: model.editingQuestionId.value,
              payload: parsed.value,
            }),
          ],
        };
      }
    }

    case "UpdatedPulse": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        return {
          model: {
            ...model,
            pulseDetail: { _tag: "Loaded", detail: outcome.detail },
            pulseActionBusy: false,
            writingQuestion: false,
            editingQuestionId: Option.none(),
            formBusy: false,
            formFailure: Option.none(),
            settingsBusy: false,
            settingsSaved: true,
            settingsFailure: Option.none(),
          },
        };
      }
      if (outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          pulseActionBusy: false,
          pulseActionFailure: Option.some(outcome.failure),
          formBusy: false,
          formFailure: Option.some(outcome.failure),
          settingsBusy: false,
          settingsFailure: Option.some(outcome.failure),
        },
      };
    }

    case "SettingsNameChanged":
      return { model: { ...model, settingsName: message.name, settingsSaved: false } };

    case "SettingsDayChanged":
      return { model: { ...model, settingsDay: message.day, settingsSaved: false } };

    case "SettingsTimeChanged":
      return { model: { ...model, settingsTime: message.time, settingsSaved: false } };

    case "SettingsWindowChanged":
      return {
        model: { ...model, settingsWindow: Number(message.days), settingsSaved: false },
      };

    case "SettingsReviewWindowChanged":
      return {
        model: { ...model, settingsReviewWindow: Number(message.days), settingsSaved: false },
      };

    case "SettingsRemindersChanged":
      return {
        model: { ...model, settingsReminders: Number(message.reminders), settingsSaved: false },
      };

    case "SubmitSettings": {
      if (model.pulseDetail._tag !== "Loaded") return { model };
      const { detail } = model.pulseDetail;
      const parsed = decodeSettings({
        ...detail.settings,
        name: model.settingsName.trim(),
        cadence: {
          _tag: "Weekly",
          day: model.settingsDay,
          time: model.settingsTime,
        },
        answerWindowDays: model.settingsWindow,
        reviewWindowDays: model.settingsReviewWindow,
        reminders: model.settingsReminders,
      });

      if (Option.isNone(parsed)) {
        return { model: { ...model, settingsFailure: Option.some("Invalid") } };
      }

      return {
        model: { ...model, settingsBusy: true, settingsFailure: Option.none(), settingsSaved: false },
        commands: [
          UpdatePulseSettingsCmd({
            teamId: detail.team.id,
            pulseId: detail.id,
            settings: parsed.value,
          }),
        ],
      };
    }

    case "SendTestInvitationClicked": {
      if (model.pulseDetail._tag !== "Loaded" || model.testSendBusy) return { model };
      const { detail } = model.pulseDetail;
      return {
        model: { ...model, testSendBusy: true, testSendResult: Option.none() },
        commands: [SendTestInvitationCmd({ teamId: detail.team.id, pulseId: detail.id })],
      };
    }

    case "SentTestInvitation": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        // Only the editor of the Pulse that was sent from shows the result; a send that returns after the user left is dropped.
        if (model.route._tag !== "Pulse" || model.route.pulseId !== outcome.pulseId) {
          return { model: { ...model, testSendBusy: false } };
        }
        return {
          model: {
            ...model,
            testSendBusy: false,
            testSendResult: Option.some({
              _tag: "Sent",
              email: outcome.email,
              sendId: outcome.sendId,
              statusUnavailable: false,
            }),
          },
          commands: [
            PollTestSendCmd({ teamId: model.route.teamId, pulseId: outcome.pulseId, sendId: outcome.sendId }),
          ],
        };
      }
      if (outcome.failure === "Unauthenticated") {
        return { model: { ...model, testSendBusy: false }, commands: [LoadSession()] };
      }
      return {
        model: {
          ...model,
          testSendBusy: false,
          testSendResult: Option.some({ _tag: "Failed", failure: outcome.failure }),
        },
      };
    }

    case "PolledTestSend": {
      const { sendId, outcome } = message;
      const current = Option.getOrUndefined(model.testSendResult);
      // Only the send on screen is updated; a read that returns after the user left or sent another test is dropped.
      if (current?._tag !== "Sent" || current.sendId !== sendId) return { model };
      if (outcome._tag === "Failure") {
        const failed: Model = {
          ...model,
          testSendResult: Option.some({ ...current, statusUnavailable: true }),
        };
        return outcome.failure === "Unauthenticated"
          ? { model: failed, commands: [LoadSession()] }
          : { model: failed };
      }
      const { status } = outcome;
      const next: Model = {
        ...model,
        testSendResult: Option.some({ ...current, status, statusUnavailable: false }),
      };
      if (model.route._tag !== "Pulse" || !testSendKeepsPolling(status)) return { model: next };
      return {
        model: next,
        commands: [PollTestSendCmd({ teamId: model.route.teamId, pulseId: model.route.pulseId, sendId })],
      };
    }

    // ----------------------------------------
    // Rounds screen
    // ----------------------------------------
    case "GotRounds": {
      const { outcome } = message;
      if (outcome._tag === "Failure") {
        if (outcome.failure === "Unauthenticated") {
          return { model, commands: [LoadSession()] };
        }
        return { model: { ...model, rounds: { _tag: "Failed", failure: outcome.failure } } };
      }
      const lead = isLead(model.teamDetail);
      const commands = [];
      if (lead && model.route._tag === "Rounds") {
        const teamId = model.route.teamId;
        for (const round of outcome.list.rounds) {
          if (round.status === "open") {
            commands.push(GetRoundDetailCmd({ teamId, roundId: round.id }));
          } else if (round.status === "closed" || round.status === "ready" || round.status === "shared") {
            commands.push(GetRoundRateCmd({ teamId, roundId: round.id }));
          }
        }
      }
      return {
        model: { ...model, rounds: { _tag: "Loaded", list: outcome.list } },
        commands,
      };
    }

    case "GotRoundDetail": {
      if (message.outcome._tag === "Failure") return { model };
      return {
        model: {
          ...model,
          roundDetails: { ...model.roundDetails, [message.roundId]: message.outcome.detail },
        },
      };
    }

    case "GotRoundRate": {
      if (message.outcome._tag === "Failure") return { model };
      return {
        model: {
          ...model,
          roundRates: { ...model.roundRates, [message.roundId]: message.outcome.result.responseRate },
        },
      };
    }

    case "SkipDateChanged":
      return { model: { ...model, roundsSkipDate: message.date } };

    case "SkipWeekClicked": {
      if (model.route._tag !== "Rounds") return { model };
      return {
        model: { ...model, roundsBusy: true, roundsFailure: Option.none() },
        commands: [
          SkipWeekCmd({
            teamId: model.route.teamId,
            pulseId: model.route.pulseId,
            plannedOpenDate: message.plannedOpenDate,
          }),
        ],
      };
    }

    case "SubmitSkipDate": {
      if (model.route._tag !== "Rounds" || model.roundsSkipDate.trim() === "") return { model };
      return {
        model: { ...model, roundsBusy: true, roundsFailure: Option.none() },
        commands: [
          SkipWeekCmd({
            teamId: model.route.teamId,
            pulseId: model.route.pulseId,
            plannedOpenDate: model.roundsSkipDate.trim(),
          }),
        ],
      };
    }

    case "PausePulseClicked": {
      if (model.route._tag !== "Rounds") return { model };
      return {
        model: { ...model, roundsBusy: true, roundsFailure: Option.none() },
        commands: [PausePulseCmd({ teamId: model.route.teamId, pulseId: model.route.pulseId })],
      };
    }

    case "ResumePulseClicked": {
      if (model.route._tag !== "Rounds") return { model };
      return {
        model: { ...model, roundsBusy: true, roundsFailure: Option.none() },
        commands: [ResumePulseCmd({ teamId: model.route.teamId, pulseId: model.route.pulseId })],
      };
    }

    case "RoundConfirmRequested":
      return {
        model: {
          ...model,
          roundConfirm: Option.some({ kind: message.kind, roundId: message.roundId }),
          roundsFailure: Option.none(),
        },
      };

    case "RoundConfirmDismissed":
      return { model: { ...model, roundConfirm: Option.none() } };

    case "RoundConfirmed": {
      if (model.route._tag !== "Rounds" || Option.isNone(model.roundConfirm)) return { model };
      const { kind, roundId } = model.roundConfirm.value;
      const teamId = model.route.teamId;
      return {
        model: { ...model, roundConfirm: Option.none(), roundsBusy: true, roundsFailure: Option.none() },
        commands: [
          kind === "close" ? CloseRoundEarlyCmd({ teamId, roundId }) : CancelRoundCmd({ teamId, roundId }),
        ],
      };
    }

    case "ResendInvitationClicked": {
      if (model.route._tag !== "Rounds") return { model };
      return {
        model: { ...model, roundsBusy: true, roundsFailure: Option.none() },
        commands: [
          ResendInvitationCmd({
            teamId: model.route.teamId,
            roundId: message.roundId,
            personId: message.personId,
          }),
        ],
      };
    }

    case "RoundCommandDone": {
      const { outcome } = message;
      if (outcome._tag === "Failure") {
        if (outcome.failure === "Unauthenticated") {
          return { model, commands: [LoadSession()] };
        }
        return { model: { ...model, roundsBusy: false, roundsFailure: Option.some(outcome.failure) } };
      }
      const reload =
        model.route._tag === "Rounds"
          ? [ListRoundsCmd({ teamId: model.route.teamId, pulseId: model.route.pulseId })]
          : [];
      return {
        model: { ...model, roundsBusy: false, roundDetails: {}, roundRates: {}, roundsSkipDate: "" },
        commands: reload,
      };
    }

    case "GotTeamOverview": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        // A response for a Team the user has since navigated away from is stale: drop it.
        const isCurrentTeam = model.route._tag === "Team" && model.route.teamId === outcome.overview.teamId;
        if (!isCurrentTeam) return { model };
        return {
          model: {
            ...model,
            teamOverview: { _tag: "Loaded", overview: outcome.overview },
          },
        };
      }
      return {
        model: {
          ...model,
          teamOverview: { _tag: "Failed", failure: outcome.failure },
        },
      };
    }

    // ----------------------------------------
    // History screen
    // ----------------------------------------
    case "GotMyHistory": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        // A response that arrives after the user has left the History screen is stale: drop it.
        if (model.route._tag !== "History") return { model };
        return {
          model: {
            ...model,
            history: { _tag: "Loaded", history: outcome.history, kept: outcome.kept, cleared: false },
          },
        };
      }
      if (outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }
      return {
        model: { ...model, history: { _tag: "Failed", failure: outcome.failure } },
      };
    }

    case "ClearKeptAnswersClicked":
      if (model.history._tag !== "Loaded") return { model };
      return { model, commands: [ClearKeptAnswersCmd()] };

    case "ClearedKeptAnswers":
      if (model.history._tag !== "Loaded") return { model };
      return {
        model: { ...model, history: { ...model.history, kept: {}, cleared: true } },
      };

    // ----------------------------------------
    // Results screen
    // ----------------------------------------
    case "GotResults": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        return {
          model: {
            ...model,
            guideCopy: "idle",
            results: { _tag: "Loaded", result: outcome.result },
          },
        };
      }
      return {
        model: {
          ...model,
          guideCopy: "idle",
          results: { _tag: "Failed", failure: outcome.failure },
        },
      };
    }

    case "ToggleResultsTable": {
      const current = model.showTable[message.key] ?? false;
      return {
        model: {
          ...model,
          showTable: {
            ...model.showTable,
            [message.key]: !current,
          },
        },
      };
    }

    case "CopyGuide":
      return {
        model: { ...model, guideCopy: "idle" },
        commands: [CopyGuideTextCmd({ text: message.text })],
      };

    case "CopiedGuide":
      return { model: { ...model, guideCopy: message.ok ? "copied" : "failed" } };
    case "ShareResultsClicked": {
      if (model.route._tag !== "RoundResults" || model.shareBusy) return { model };
      return {
        model: { ...model, shareBusy: true, shareFailure: Option.none() },
        commands: [ShareResultsCmd({ teamId: model.route.teamId, roundId: model.route.roundId })],
      };
    }

    case "ResultsShareDone": {
      const { outcome } = message;
      if (outcome._tag === "Failure") {
        return { model: { ...model, shareBusy: false, shareFailure: Option.some(outcome.failure) } };
      }
      // Sharing changes what the page shows, so reload the Results the same way the page loads them.
      const reload =
        model.route._tag === "RoundResults"
          ? [GetResultsCmd({ teamId: model.route.teamId, roundId: model.route.roundId })]
          : [];
      return { model: { ...model, shareBusy: false, shareFailure: Option.none() }, commands: reload };
    }

    case "RetryResultClicked": {
      if (model.route._tag !== "RoundResults" || model.retryBusy) return { model };
      return {
        model: { ...model, retryBusy: true, retryFailure: Option.none() },
        commands: [RetryResultCmd({ teamId: model.route.teamId, roundId: model.route.roundId })],
      };
    }

    case "RetryResultDone": {
      const { outcome } = message;
      if (outcome._tag === "Failure") {
        return { model: { ...model, retryBusy: false, retryFailure: Option.some(outcome.failure) } };
      }
      // A retry that succeeds changes what the page shows, so reload the Results as the page loads them.
      const reload =
        model.route._tag === "RoundResults"
          ? [GetResultsCmd({ teamId: model.route.teamId, roundId: model.route.roundId })]
          : [];
      return { model: { ...model, retryBusy: false, retryFailure: Option.none() }, commands: reload };
    }

    // ----------------------------------------
    // Actions
    // ----------------------------------------
    case "GotActions": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        return {
          model: {
            ...model,
            actions: { _tag: "Loaded", actions: outcome.list.actions },
          },
        };
      }
      return {
        model: {
          ...model,
          actions: { _tag: "Failed", failure: outcome.failure },
        },
      };
    }

    case "ActionTitleChanged":
      return { model: { ...model, actionTitle: message.title } };

    case "ActionOwnerChanged":
      return { model: { ...model, actionOwnerId: Option.some(message.personId) } };

    case "ActionDueDateChanged":
      return { model: { ...model, actionDueDate: message.dueDate } };

    case "ActionDimensionChanged":
      return { model: { ...model, actionDimension: message.dimension } };

    case "SubmitAction": {
      if (model.route._tag !== "RoundResults" || model.actionTitle.trim() === "") {
        return { model };
      }
      const teamId = model.route.teamId;
      const roundId = model.route.roundId;
      const roster = model.teamDetail._tag === "Loaded" ? model.teamDetail.detail.roster : [];
      const ownerId = Option.getOrElse(model.actionOwnerId, () => roster[0]?.personId);
      if (ownerId === undefined) return { model };
      const dueDate = model.actionDueDate.trim() !== "" ? model.actionDueDate.trim() : null;
      const dimension = model.actionDimension !== "none" ? model.actionDimension : null;
      return {
        model: { ...model, actionBusy: true, actionFailure: Option.none() },
        commands: [
          CreateActionCmd({
            teamId,
            roundId,
            title: model.actionTitle.trim(),
            ownerId,
            dueDate,
            dimension,
          }),
        ],
      };
    }

    case "CreatedAction": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        const nextActions =
          model.actions._tag === "Loaded"
            ? LoadedActions.Loaded({ actions: [...model.actions.actions, outcome.action] })
            : model.actions;
        return {
          model: {
            ...model,
            actions: nextActions,
            actionTitle: "",
            actionDueDate: "",
            actionDimension: "none",
            actionBusy: false,
            actionFailure: Option.none(),
          },
        };
      }
      return {
        model: {
          ...model,
          actionBusy: false,
          actionFailure: Option.some(outcome.failure),
        },
      };
    }

    case "UpdateActionStatus": {
      if (model.route._tag !== "RoundResults") return { model };
      return {
        model,
        commands: [
          UpdateActionCmd({
            teamId: model.route.teamId,
            actionId: message.actionId,
            status: message.status,
          }),
        ],
      };
    }

    case "UpdatedAction": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        const nextActions =
          model.actions._tag === "Loaded"
            ? LoadedActions.Loaded({
                actions: model.actions.actions.map((a: ActionItem) =>
                  a.id === outcome.action.id ? outcome.action : a,
                ),
              })
            : model.actions;
        return { model: { ...model, actions: nextActions } };
      }
      return { model: { ...model, actionFailure: Option.some(outcome.failure) } };
    }

    // ----------------------------------------
    // Lead's Note on the Round
    // ----------------------------------------
    case "GotRoundNote": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        // Drop a late response for a Round the person has already left.
        if (!isCurrentRoundNote(model, outcome.view.roundId)) return { model };
        return {
          model: {
            ...model,
            roundNote: LoadedNote.Loaded({ note: outcome.view.note }),
          },
        };
      }
      return {
        model: {
          ...model,
          roundNote: LoadedNote.Failed({ failure: outcome.failure }),
        },
      };
    }

    case "NoteEditClicked": {
      const current =
        model.roundNote._tag === "Loaded" && model.roundNote.note !== null ? model.roundNote.note.text : "";
      return {
        model: { ...model, noteDraft: current, noteEditing: true, noteFailure: Option.none() },
      };
    }

    case "NoteDraftChanged":
      return { model: { ...model, noteDraft: message.text } };

    case "NoteCancelClicked":
      return { model: { ...model, noteEditing: false, noteFailure: Option.none() } };

    case "SubmitNote": {
      if (model.route._tag !== "RoundResults" || model.noteBusy || model.noteDraft.length > NOTE_MAX_LENGTH) {
        return { model };
      }
      return {
        model: { ...model, noteBusy: true, noteFailure: Option.none() },
        commands: [
          SaveRoundNoteCmd({
            teamId: model.route.teamId,
            roundId: model.route.roundId,
            text: model.noteDraft,
          }),
        ],
      };
    }

    case "SavedNote": {
      const { outcome } = message;
      if (outcome._tag === "Success") {
        if (!isCurrentRoundNote(model, outcome.view.roundId)) return { model };
        return {
          model: {
            ...model,
            roundNote: LoadedNote.Loaded({ note: outcome.view.note }),
            noteDraft: "",
            noteEditing: false,
            noteBusy: false,
            noteFailure: Option.none(),
          },
        };
      }
      return {
        model: {
          ...model,
          noteBusy: false,
          noteFailure: Option.some(outcome.failure),
        },
      };
    }
  }
};

// ==========================================
// VIEW
// ==========================================

/**
 * The language a Model is shown in (ADR 0018): a signed-in Person's own choice, then the browser's
 * language, then the Organization's default. Other screens have no Person, so they use the browser's
 * language or English.
 */
export const localeOf = (model: Model): Locale => {
  if (model.session._tag === "SignedIn") {
    return resolveLocale({
      person: model.session.locale,
      browser: model.browserLocale,
      organization: model.session.organizationLocale,
    });
  }
  return model.browserLocale ?? "en";
};

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  // The browser app has one reader, so the language follows the model: every message below reads the live binding.
  setLocale(localeOf(model));

  if (model.route._tag === "Privacy") {
    return {
      title: message("privacy.title"),
      body: privacyView(h),
    };
  }

  // Session states
  if (model.session._tag === "Loading") {
    return {
      title: message("app.title"),
      body: screenView(message("app.loading"), [], h),
    };
  }

  if (model.session._tag === "SignedOut") {
    return {
      title: message("signIn.title"),
      body: signInView(model.session.failed, h),
    };
  }

  if (model.session._tag === "Failed") {
    return {
      title: message("app.title"),
      body: failedView(Message.RetrySession(), h),
    };
  }

  if (model.session._tag === "CreateOrganization") {
    return {
      title: message("createOrganization.title"),
      body: createOrganizationView(
        model.session.name,
        model.session.busy,
        (name) => Message.CreateOrgNameChanged({ name }),
        Message.SubmitCreateOrg(),
        h,
      ),
    };
  }

  if (model.session._tag === "NotInOrganization") {
    return {
      title: message("notInOrganization.title"),
      body: notInOrganizationView(h),
    };
  }

  if (model.session._tag === "ChooseOrganization") {
    return {
      title: message("chooseOrganization.title"),
      body: chooseOrganizationView(
        model.session.organizations,
        model.session.busy,
        (id) => Message.ChooseOrgClicked({ organizationId: id }),
        h,
      ),
    };
  }

  // Signed In
  const { organization, organizationAdmin, locale } = model.session;
  const shellTitle = message("signedIn.title", { organization: organization.name });

  let screenContent = null;
  switch (model.route._tag) {
    case "Teams":
    case "NotFound":
      screenContent = teamsScreenView(
        {
          teams: model.teams,
          organizationAdmin,
          createName: model.createTeamName,
          createTimeZone: model.createTeamTimeZone,
          createLeadEmail: model.createTeamLeadEmail,
          createBusy: model.createTeamBusy,
          createFailure: Option.getOrUndefined(model.createTeamFailure),
        },
        {
          onNameChange: (name) => Message.CreateTeamNameChanged({ name }),
          onTimeZoneChange: (tz) => Message.CreateTeamTimeZoneChanged({ tz }),
          onLeadEmailChange: (email) => Message.CreateTeamLeadEmailChanged({ email }),
          onSubmitCreate: Message.SubmitCreateTeam(),
        },
        h,
      );
      break;

    case "Team":
      screenContent = teamScreenView(
        {
          team: model.teamDetail,
          renameName: model.renameName,
          renameTimeZone: model.renameTimeZone,
          renameBusy: model.renameBusy,
          renameFailure: Option.getOrUndefined(model.renameFailure),
          addMemberEmail: model.addMemberEmail,
          addMemberBusy: model.addMemberBusy,
          addMemberAdded: model.addMemberAdded,
          addMemberFailure: Option.getOrUndefined(model.addMemberFailure),
          assignLeadEmail: model.assignLeadEmail,
          assignLeadBusy: model.assignLeadBusy,
          assignLeadAdded: model.assignLeadAdded,
          assignLeadFailure: Option.getOrUndefined(model.assignLeadFailure),
          rosterBusy: model.rosterBusy,
          rosterFailure: Option.getOrUndefined(model.rosterFailure),
        },
        {
          onRenameNameChange: (name) => Message.RenameNameChanged({ name }),
          onRenameTimeZoneChange: (tz) => Message.RenameTimeZoneChanged({ tz }),
          onSubmitRename: Message.SubmitRenameTeam(),
          onAddMemberEmailChange: (email) => Message.AddMemberEmailChanged({ email }),
          onSubmitAddMember: Message.SubmitAddMember(),
          onAssignLeadEmailChange: (email) => Message.AssignLeadEmailChanged({ email }),
          onSubmitAssignLead: Message.SubmitAssignLead(),
          onRemoveMember: (personId) => Message.RemoveMemberClicked({ personId }),
          onRemoveLead: (personId) => Message.RemoveLeadClicked({ personId }),
        },
        teamOverviewView(
          model.teamOverview,
          model.showTable["overview"] ?? false,
          Message.ToggleResultsTable({ key: "overview" }),
          h,
        ),
        h,
      );
      break;

    case "History":
      screenContent = historyView(model.history, { onClear: Message.ClearKeptAnswersClicked() }, h);
      break;

    case "Settings":
      if (!organizationAdmin) {
        // Fallback to teams if not admin
        screenContent = teamsScreenView(
          {
            teams: model.teams,
            organizationAdmin: false,
            createName: model.createTeamName,
            createTimeZone: model.createTeamTimeZone,
            createLeadEmail: model.createTeamLeadEmail,
            createBusy: model.createTeamBusy,
            createFailure: Option.getOrUndefined(model.createTeamFailure),
          },
          {
            onNameChange: (name) => Message.CreateTeamNameChanged({ name }),
            onTimeZoneChange: (tz) => Message.CreateTeamTimeZoneChanged({ tz }),
            onLeadEmailChange: (email) => Message.CreateTeamLeadEmailChanged({ email }),
            onSubmitCreate: Message.SubmitCreateTeam(),
          },
          h,
        );
      } else {
        screenContent = settingsScreenView(
          {
            settings: model.settings,
            size: model.size,
            sizeSaved: model.sizeSaved,
            sizeBusy: model.sizeBusy,
            sizeFailure: Option.getOrUndefined(model.sizeFailure),
            aiBusy: model.aiBusy,
            aiFailure: Option.getOrUndefined(model.aiFailure),
            defaultLanguageBusy: model.defaultLanguageBusy,
            defaultLanguageFailure: Option.getOrUndefined(model.defaultLanguageFailure),
            peopleBusy: model.peopleBusy,
            peopleFailure: Option.getOrUndefined(model.peopleFailure),
            failedEmails: model.failedEmails,
            failedEmailResends: model.failedEmailResends,
          },
          {
            onSizeChange: (size) => Message.SizeChanged({ size }),
            onSubmitSize: Message.SubmitSize(),
            onAiProcessingToggle: (isOn) => Message.AiProcessingToggled({ isOn }),
            onDefaultLanguageChange: (value) => Message.DefaultLanguageChanged({ value }),
            onGrantAdmin: (personId) => Message.GrantAdminClicked({ personId }),
            onRevokeAdmin: (personId) => Message.RevokeAdminClicked({ personId }),
            onRemovePerson: (personId) => Message.RemovePersonClicked({ personId }),
            onResendFailedEmail: (sendId) => Message.ResendFailedEmailClicked({ sendId }),
          },
          h,
        );
      }
      break;

    case "Pulses":
      screenContent = pulsesScreenView(
        {
          teamId: model.route.teamId,
          pulses: model.pulses,
          createBusy: model.createPulseBusy,
          createFailure: Option.getOrUndefined(model.createPulseFailure),
        },
        {
          onCreatePulse: Message.CreatePulseClicked(),
        },
        h,
      );
      break;

    case "Pulse":
      screenContent = pulseEditorView(
        {
          teamId: model.route.teamId,
          pulse: model.pulseDetail,
          actionBusy: model.pulseActionBusy,
          actionFailure: Option.getOrUndefined(model.pulseActionFailure),
          writingQuestion: model.writingQuestion,
          editingQuestionId: model.editingQuestionId,
          formText: model.formText,
          formKind: model.formKind,
          formDimension: model.formDimension,
          formLowLabel: model.formLowLabel,
          formHighLabel: model.formHighLabel,
          formComment: model.formComment,
          formOptions: model.formOptions,
          formBusy: model.formBusy,
          formFailure: Option.getOrUndefined(model.formFailure),
          settingsName: model.settingsName,
          settingsDay: model.settingsDay,
          settingsTime: model.settingsTime,
          settingsWindow: model.settingsWindow,
          settingsReviewWindow: model.settingsReviewWindow,
          settingsReminders: model.settingsReminders,
          settingsSaved: model.settingsSaved,
          settingsBusy: model.settingsBusy,
          settingsFailure: Option.getOrUndefined(model.settingsFailure),
          testSendBusy: model.testSendBusy,
          testSendResult: Option.getOrUndefined(model.testSendResult),
        },
        {
          onMoveQuestion: (index, by) => Message.MoveQuestionClicked({ index, by }),
          onToggleEditQuestion: (questionId) => Message.ToggleEditQuestion({ questionId }),
          onRemoveQuestion: (questionId) => Message.RemoveQuestionClicked({ questionId }),
          onAddFromTemplate: (key) => Message.AddTemplateQuestionClicked({ key }),
          onToggleWriting: (writing) => Message.ToggleWritingQuestion({ writing }),
          onFormTextChange: (text) => Message.FormTextChanged({ text }),
          onFormKindChange: (kind) =>
            Message.FormKindChanged({
              kind: kind === "Rating" || kind === "SingleChoice" ? kind : "LongText",
            }),
          onFormDimensionChange: (dim) =>
            Message.FormDimensionChanged({
              dim: Schema.is(Dimension)(dim) ? dim : "none",
            }),
          onFormLowLabelChange: (low) => Message.FormLowLabelChanged({ low }),
          onFormHighLabelChange: (high) => Message.FormHighLabelChanged({ high }),
          onFormCommentToggle: (comment) => Message.FormCommentToggled({ comment }),
          onFormOptionsChange: (options) => Message.FormOptionsChanged({ options }),
          onSubmitQuestionForm: (mode) => Message.SubmitQuestionForm({ mode }),
          onSettingsNameChange: (name) => Message.SettingsNameChanged({ name }),
          onSettingsDayChange: (day) =>
            Message.SettingsDayChanged({
              day: Schema.is(Weekday)(day) ? day : "friday",
            }),
          onSettingsTimeChange: (time) => Message.SettingsTimeChanged({ time }),
          onSettingsWindowChange: (days) => Message.SettingsWindowChanged({ days }),
          onSettingsReviewWindowChange: (days) => Message.SettingsReviewWindowChanged({ days }),
          onSettingsRemindersChange: (reminders) => Message.SettingsRemindersChanged({ reminders }),
          onSubmitSettings: Message.SubmitSettings(),
          onSendTest: Message.SendTestInvitationClicked(),
        },
        h,
      );
      break;

    case "Rounds":
      screenContent = roundsScreenView(
        {
          teamId: model.route.teamId,
          pulseId: model.route.pulseId,
          team: model.teamDetail,
          rounds: model.rounds,
          details: model.roundDetails,
          rates: model.roundRates,
          confirm: Option.getOrUndefined(model.roundConfirm),
          skipDate: model.roundsSkipDate,
          busy: model.roundsBusy,
          failure: Option.getOrUndefined(model.roundsFailure),
        },
        {
          onSkipWeek: (plannedOpenDate) => Message.SkipWeekClicked({ plannedOpenDate }),
          onSkipDateChange: (date) => Message.SkipDateChanged({ date }),
          onSubmitSkipDate: Message.SubmitSkipDate(),
          onPause: Message.PausePulseClicked(),
          onResume: Message.ResumePulseClicked(),
          onAskConfirm: (kind, roundId) => Message.RoundConfirmRequested({ kind, roundId }),
          onConfirm: Message.RoundConfirmed(),
          onDismissConfirm: Message.RoundConfirmDismissed(),
          onResend: (roundId, personId) => Message.ResendInvitationClicked({ roundId, personId }),
        },
        h,
      );
      break;

    case "RoundResults":
      screenContent = resultsScreenView(
        {
          results: model.results,
          actions: model.actions,
          teamDetail: model.teamDetail,
          showTable: model.showTable,
          guideCopy: model.guideCopy,
          shareBusy: model.shareBusy,
          shareFailure: model.shareFailure,
          retryBusy: model.retryBusy,
          retryFailure: model.retryFailure,
          actionTitle: model.actionTitle,
          actionOwnerId: model.actionOwnerId,
          actionDueDate: model.actionDueDate,
          actionDimension: model.actionDimension,
          actionBusy: model.actionBusy,
          actionFailure: model.actionFailure,
          roundNote: model.roundNote,
          noteDraft: model.noteDraft,
          noteEditing: model.noteEditing,
          noteBusy: model.noteBusy,
          noteFailure: model.noteFailure,
        },
        {
          onToggleTable: (key) => Message.ToggleResultsTable({ key }),
          onNoteEdit: Message.NoteEditClicked(),
          onNoteDraftChange: (text) => Message.NoteDraftChanged({ text }),
          onNoteCancel: Message.NoteCancelClicked(),
          onSubmitNote: Message.SubmitNote(),
          onCopyGuide: (text) => Message.CopyGuide({ text }),
          onShareResults: Message.ShareResultsClicked(),
          onRetryResult: Message.RetryResultClicked(),
          onActionTitleChange: (title) => Message.ActionTitleChanged({ title }),
          onActionOwnerChange: (personId) =>
            Message.ActionOwnerChanged({ personId: PersonId.make(personId) }),
          onActionDueDateChange: (date) => Message.ActionDueDateChanged({ dueDate: date }),
          onActionDimensionChange: (dim) =>
            Message.ActionDimensionChanged({
              dimension: Schema.is(Dimension)(dim) ? dim : "none",
            }),
          onSubmitAction: Message.SubmitAction(),
          onUpdateActionStatus: (actionId, status) => Message.UpdateActionStatus({ actionId, status }),
        },
        h,
      );
      break;
  }

  return {
    title: shellTitle,
    body: shellView(
      shellTitle,
      organizationAdmin,
      [screenContent],
      {
        value: locale,
        busy: model.languageBusy,
        failure: Option.getOrUndefined(model.languageFailure),
        onChange: (value) => Message.LanguageChanged({ value }),
      },
      h,
      model.route._tag === "RoundResults",
    ),
  };
};
