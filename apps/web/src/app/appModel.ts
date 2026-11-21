import { Popover } from "@foldkit/ui";
import {
  ActionId,
  ActionItem,
  ActionList,
  ActionStatus,
  Dimension,
  FailedEmails,
  FailedEmailStatus,
  Locale,
  MemberHistory,
  OrganizationId,
  OrganizationSettings,
  PersonId,
  PulseDetail,
  PulseId,
  PulseList,
  QuestionId,
  RoundDetail,
  RoundId,
  RoundList,
  RoundNoteView,
  RoundResult,
  SendId,
  TeamDetail,
  TeamOverview,
  TeamSummary,
  TemplateQuestionKey,
  TestSendStatus,
  Weekday,
} from "@surveybeat/domain";
import { Schema } from "effect";
import { Navigation } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Url } from "foldkit/url";
import { Failure } from "./api.ts";
import {
  FailedEmailResend,
  LoadedFailedEmails,
  LoadedSettings,
  LoadedTeam,
  LoadedTeams,
} from "./directory.ts";
import { LoadedHistory } from "./history.ts";
import { KeptAnswers } from "./keptAnswers.ts";
import { LoadedOverview } from "./overview.ts";
import { PasskeyCapabilities, PasskeyItem } from "./passkeyClient.ts";
import { LoadedPasskeys } from "./passkeysView.ts";
import { LoadedPulse, LoadedPulses, TestSendResult } from "./pulses.ts";
import { GuideCopy, LoadedActions, LoadedNote, LoadedResults } from "./results.ts";
import { LoadedRounds, RoundConfirm } from "./rounds.ts";
import { AppRoute } from "./routes.ts";
import { SessionModel, SessionResult } from "./session.ts";

export const Model = Schema.Struct({
  url: Url,
  route: AppRoute,
  session: SessionModel,

  browserLocale: Schema.Option(Locale),
  passkeyCapabilities: PasskeyCapabilities,
  passkeySignInBusy: Schema.Boolean,
  passkeys: Schema.Struct({
    list: LoadedPasskeys,
    busy: Schema.Boolean,
    notice: Schema.NullOr(Schema.String),
    failure: Schema.Option(Failure),
    editingId: Schema.Option(Schema.String),
    editingName: Schema.String,
    pendingDeleteId: Schema.Option(Schema.String),
  }),

  navMenu: Popover.Model,
  accountMenu: Popover.Model,

  teams: LoadedTeams,
  createTeamName: Schema.String,
  createTeamTimeZone: Schema.String,
  createTeamLeadEmail: Schema.String,
  createTeamBusy: Schema.Boolean,
  createTeamFailure: Schema.Option(Failure),
  createTeamOpen: Schema.Boolean,

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
  renameOpen: Schema.Boolean,
  addMemberOpen: Schema.Boolean,
  assignLeadOpen: Schema.Boolean,

  pendingRemove: Schema.Option(
    Schema.Struct({
      kind: Schema.Literals(["member", "lead"]),
      personId: PersonId,
      email: Schema.String,
    }),
  ),
  pendingRemovePerson: Schema.Option(Schema.Struct({ personId: PersonId, email: Schema.String })),
  pendingErasePerson: Schema.Option(Schema.Struct({ personId: PersonId, email: Schema.String })),
  erasePersonConfirmation: Schema.String,
  selfErase: Schema.Struct({
    open: Schema.Boolean,
    confirmation: Schema.String,
    busy: Schema.Boolean,
    failure: Schema.Option(Failure),
  }),
  emailChange: Schema.Struct({
    step: Schema.Literals(["closed", "address", "code", "done"]),
    email: Schema.String,
    code: Schema.String,
    busy: Schema.Boolean,
    failure: Schema.Option(Failure),
  }),
  correctEmail: Schema.Struct({
    pending: Schema.Option(Schema.Struct({ personId: PersonId, email: Schema.String })),
    value: Schema.String,
    busy: Schema.Boolean,
    failure: Schema.Option(Failure),
  }),
  offboardingDownloaded: Schema.Boolean,
  offboarding: Schema.Struct({
    open: Schema.Boolean,
    confirmation: Schema.String,
    busy: Schema.Boolean,
    failure: Schema.Option(Failure),
  }),

  settings: LoadedSettings,
  size: Schema.String,
  sizeSaved: Schema.Boolean,
  sizeBusy: Schema.Boolean,
  sizeFailure: Schema.Option(Failure),
  sizeOpen: Schema.Boolean,
  aiBusy: Schema.Boolean,
  aiFailure: Schema.Option(Failure),
  peopleBusy: Schema.Boolean,
  peopleFailure: Schema.Option(Failure),
  failedEmails: LoadedFailedEmails,

  failedEmailResends: Schema.Record(Schema.String, FailedEmailResend),

  pulses: LoadedPulses,

  homePulses: Schema.Record(Schema.String, PulseList),
  homeRounds: Schema.Record(Schema.String, RoundList),
  homeActions: Schema.Record(Schema.String, Schema.Array(ActionItem)),
  createPulseBusy: Schema.Boolean,
  createPulseFailure: Schema.Option(Failure),

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

  rounds: LoadedRounds,
  roundDetails: Schema.Record(Schema.String, RoundDetail),
  roundRates: Schema.Record(Schema.String, Schema.NullOr(Schema.Finite)),
  roundConfirm: Schema.Option(RoundConfirm),
  roundsSkipDate: Schema.String,
  roundsSkipOpen: Schema.Boolean,
  roundsBusy: Schema.Boolean,
  roundsFailure: Schema.Option(Failure),

  results: LoadedResults,
  showTable: Schema.Record(Schema.String, Schema.Boolean),

  history: LoadedHistory,
  guideCopy: GuideCopy,
  shareBusy: Schema.Boolean,
  shareFailure: Schema.Option(Failure),
  retryBusy: Schema.Boolean,
  retryFailure: Schema.Option(Failure),

  actions: LoadedActions,
  actionTitle: Schema.String,
  actionOwnerId: Schema.Option(PersonId),
  actionDueDate: Schema.String,
  actionDimension: Schema.Union([Dimension, Schema.Literal("none")]),
  actionBusy: Schema.Boolean,
  actionFailure: Schema.Option(Failure),
  actionFormOpen: Schema.Boolean,
  pendingDropId: Schema.Option(ActionId),

  roundNote: LoadedNote,
  noteDraft: Schema.String,
  noteEditing: Schema.Boolean,
  noteBusy: Schema.Boolean,
  noteFailure: Schema.Option(Failure),
});

export type Model = typeof Model.Type;

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

export const OutcomePasskeys = Schema.Union([
  Schema.TaggedStruct("Success", { passkeys: Schema.Array(PasskeyItem) }),
  Schema.TaggedStruct("Failure", { failure: Failure }),
]);

export const Message = defineMessageUnion({
  UrlRequested: { request: Navigation.UrlRequest },
  UrlChanged: { url: Url },
  Navigated: {},

  GotSession: { result: SessionResult },
  RetrySession: {},
  GotPasskeyCapabilities: { capabilities: PasskeyCapabilities },
  SignInWithPasskeyClicked: {},
  PasskeySignedIn: { verified: Schema.Boolean },
  SignInEmailChanged: { email: Schema.String },
  SignInCodeChanged: { code: Schema.String },
  SubmitSignInEmail: {},
  SubmitSignInCode: {},
  SignInCodeSent: { sent: Schema.Boolean },
  SignInCodeChecked: { verified: Schema.Boolean },
  CreateOrgNameChanged: { name: Schema.String },
  SubmitCreateOrg: {},
  ChooseOrgClicked: { organizationId: OrganizationId },

  GotNavMenuMessage: { message: Popover.Message },
  GotAccountMenuMessage: { message: Popover.Message },

  GotTeams: { outcome: OutcomeTeams },
  CreateTeamNameChanged: { name: Schema.String },
  CreateTeamTimeZoneChanged: { tz: Schema.String },
  CreateTeamLeadEmailChanged: { email: Schema.String },
  SubmitCreateTeam: {},
  CreatedTeam: { outcome: OutcomeTeamDetail },

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
  ToggleForm: {
    form: Schema.Literals([
      "createTeam",
      "renameTeam",
      "addMember",
      "assignLead",
      "skipWeek",
      "commitAction",
      "minimumSize",
    ]),
  },
  RemoveMemberClicked: { personId: PersonId },
  RemovedMember: { outcome: OutcomeVoid },
  RemoveLeadClicked: { personId: PersonId },
  RemovedLead: { outcome: OutcomeVoid },

  GotSettings: { outcome: OutcomeSettings },
  SizeChanged: { size: Schema.String },
  SubmitSize: {},
  UpdatedSettings: { outcome: OutcomeVoid },
  AiProcessingToggled: { isOn: Schema.Boolean },
  UpdatedAiProcessing: { outcome: OutcomeVoid },
  GotFailedEmails: { outcome: OutcomeFailedEmails },
  ResendFailedEmailClicked: { sendId: SendId },
  ResentFailedEmail: { sendId: SendId, outcome: OutcomeFailedEmailStatus },
  PolledFailedEmail: { sendId: SendId, outcome: OutcomeFailedEmailStatus },
  GrantAdminClicked: { personId: PersonId },
  GrantedAdmin: { outcome: OutcomeVoid },
  RevokeAdminClicked: { personId: PersonId },
  RevokedAdmin: { outcome: OutcomeVoid },
  RemovePersonClicked: { personId: PersonId },
  ConfirmRemove: {},
  DismissRemove: {},
  AskDropAction: { actionId: ActionId },
  ConfirmDropAction: {},
  DismissDropAction: {},
  RemovedPerson: { outcome: OutcomeVoid },
  ErasePersonClicked: { personId: PersonId },
  ErasePersonConfirmationChanged: { value: Schema.String },
  ConfirmErasePerson: {},
  DismissErasePerson: {},
  ErasedPerson: { outcome: OutcomeVoid },
  SelfEraseOpened: {},
  SelfEraseConfirmationChanged: { value: Schema.String },
  SelfEraseDismissed: {},
  SelfEraseSubmitted: {},
  SelfErased: { outcome: OutcomeVoid },
  LeftAfterErasure: {},
  EmailChangeOpened: {},
  EmailChangeAddressChanged: { value: Schema.String },
  EmailChangeCodeRequested: {},
  EmailChangeCodeSent: { outcome: OutcomeVoid },
  EmailChangeCodeChanged: { value: Schema.String },
  EmailChangeConfirmed: {},
  EmailChangeFinished: { outcome: OutcomeVoid },
  EmailChangeOtherAddress: {},
  EmailChangeDismissed: {},
  CorrectEmailClicked: { personId: PersonId },
  CorrectEmailChanged: { value: Schema.String },
  CorrectEmailSubmitted: {},
  CorrectedEmail: { outcome: OutcomeVoid },
  CorrectEmailDismissed: {},
  OffboardingDownloaded: {},
  OffboardingOpened: {},
  OffboardingConfirmationChanged: { value: Schema.String },
  OffboardingDismissed: {},
  OffboardingSubmitted: {},
  FinishPendingOffboarding: {},
  OffboardedOrganization: { outcome: OutcomeVoid },

  GotPasskeys: { outcome: OutcomePasskeys },
  AddPasskeyClicked: {},
  AddedPasskey: { cancelled: Schema.Boolean, outcome: OutcomeVoid },
  PasskeyRenameStarted: { id: Schema.String, name: Schema.String },
  PasskeyRenameChanged: { value: Schema.String },
  PasskeyRenameSaved: {},
  PasskeyRenameCancelled: {},
  PasskeyRenamed: { outcome: OutcomeVoid },
  PasskeyDeleteRequested: { id: Schema.String },
  PasskeyDeleteConfirmed: {},
  PasskeyDeleteCancelled: {},
  PasskeyDeleted: { outcome: OutcomeVoid },

  GotPulses: { outcome: OutcomePulses },
  CreatePulseClicked: {},
  CreatedPulse: { outcome: OutcomePulseDetail },

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

  GotMyHistory: { outcome: OutcomeMyHistory },
  ClearKeptAnswersClicked: {},
  ClearedKeptAnswers: {},

  GotResults: { outcome: OutcomeResults },
  ToggleResultsTable: { key: Schema.String },
  CopyGuide: { text: Schema.String },
  CopiedGuide: { ok: Schema.Boolean },
  ShareResultsClicked: {},
  ResultsShareDone: { outcome: OutcomeVoid },
  RetryResultClicked: {},
  RetryResultDone: { outcome: OutcomeVoid },

  GotActions: { outcome: OutcomeActions },
  ActionTitleChanged: { title: Schema.String },
  ActionOwnerChanged: { personId: PersonId },
  ActionDueDateChanged: { dueDate: Schema.String },
  ActionDimensionChanged: { dimension: Schema.Union([Dimension, Schema.Literal("none")]) },
  SubmitAction: {},
  CreatedAction: { outcome: OutcomeActionItem },
  UpdateActionStatus: { actionId: ActionId, status: ActionStatus },
  UpdatedAction: { outcome: OutcomeActionItem },

  GotRoundNote: { outcome: OutcomeRoundNote },
  NoteEditClicked: {},
  NoteDraftChanged: { text: Schema.String },
  NoteCancelClicked: {},
  SubmitNote: {},
  SavedNote: { outcome: OutcomeRoundNote },
});

export type Message = typeof Message.Type;
