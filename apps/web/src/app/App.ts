import { Popover } from "@foldkit/ui";
import { browserLocale } from "@surveybeat/domain";
import { Option, Schema, Stream } from "effect";
import { Subscription } from "foldkit";
import type { Update } from "foldkit";
import type { Url } from "foldkit/url";
import type { Model } from "./appModel.ts";
import { Message } from "./appModel.ts";
import { DetectPasskeyCapabilities, LoadSession } from "./appCommands.ts";
import { authenticateWithPasskey, defaultPasskeyCapabilities } from "./passkeyClient.ts";
import { updatePasskeys } from "./appUpdatePasskeys.ts";
import { updateSession } from "./appUpdateSession.ts";
import { updateTeams } from "./appUpdateTeams.ts";
import { updateSettings } from "./appUpdateSettings.ts";
import { updatePulses } from "./appUpdatePulses.ts";
import { updateRounds } from "./appUpdateRounds.ts";
import { updateResults } from "./appUpdateResults.ts";
import { urlToAppRoute } from "./routes.ts";

export {
  Model,
  OutcomeResults,
  OutcomeActions,
  OutcomeActionItem,
  OutcomeRoundNote,
  OutcomeRounds,
  OutcomeRoundDetail,
  OutcomeTeams,
  OutcomeTeamDetail,
  OutcomeTeamOverview,
  OutcomeMyHistory,
  OutcomeSettings,
  OutcomePulses,
  OutcomePulseDetail,
  OutcomeTestSent,
  OutcomeTestSendStatus,
  OutcomeFailedEmails,
  OutcomeFailedEmailStatus,
  OutcomeVoid,
  OutcomePasskeys,
  Message,
} from "./appModel.ts";

export {
  LoadSession,
  DetectPasskeyCapabilities,
  SignInWithPasskey,
  ListPasskeysCmd,
  AddPasskeyCmd,
  RenamePasskeyCmd,
  DeletePasskeyCmd,
  SendSignInCode,
  VerifySignInCode,
  CreateOrganization,
  ChooseOrganization,
  ListTeams,
  CreateTeam,
  GetTeam,
  GetTeamOverviewCmd,
  UpdateTeam,
  AddMember,
  AssignLead,
  RemoveMember,
  RemoveLead,
  GetSettings,
  ListFailedEmails,
  ResendFailedEmailCmd,
  PollFailedEmailCmd,
  UpdateSettings,
  UpdateAiProcessing,
  GrantAdmin,
  RevokeAdmin,
  RemovePerson,
  ErasePersonData,
  EraseOwnPersonData,
  EraseOwnAccountData,
  RequestEmailChange,
  ConfirmEmailChange,
  CorrectPersonEmail,
  OffboardOrganization,
  LeaveAfterErasureCmd,
  ListPulses,
  CreatePulse,
  GetPulse,
  UpdatePulseSettingsCmd,
  SendTestInvitationCmd,
  PollTestSendCmd,
  AddQuestionCmd,
  EditQuestionCmd,
  RemoveQuestionCmd,
  ReorderQuestionsCmd,
  ListRoundsCmd,
  GetRoundDetailCmd,
  GetRoundRateCmd,
  SkipWeekCmd,
  PausePulseCmd,
  ResumePulseCmd,
  CloseRoundEarlyCmd,
  CancelRoundCmd,
  ResendInvitationCmd,
  GetResultsCmd,
  GetMyHistoryCmd,
  ClearKeptAnswersCmd,
  CopyGuideTextCmd,
  ShareResultsCmd,
  RetryResultCmd,
  ListActionsCmd,
  CreateActionCmd,
  UpdateActionCmd,
  GetRoundNoteCmd,
  SaveRoundNoteCmd,
  Navigate,
  LoadExternalUrl,
  loadActiveRouteCommand,
} from "./appCommands.ts";

export { localeOf, view } from "./appView.ts";

export const initialModel = (url: Url, languages: readonly string[]): Model => {
  const route = urlToAppRoute(url);
  const timeZone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

  return {
    url,
    route,
    session: { _tag: "Loading" },
    browserLocale: Option.fromNullishOr(browserLocale(languages)),
    passkeyCapabilities: defaultPasskeyCapabilities,
    passkeySignInBusy: false,
    passkeys: {
      list: { _tag: "Idle" },
      busy: false,
      notice: null,
      failure: Option.none(),
      editingId: Option.none(),
      editingName: "",
      pendingDeleteId: Option.none(),
    },
    navMenu: Popover.init({ id: "nav-menu" }),
    accountMenu: Popover.init({ id: "account-menu" }),
    teams: { _tag: "Loading" },
    createTeamName: "",
    createTeamTimeZone: timeZone,
    createTeamLeadEmail: "",
    createTeamBusy: false,
    createTeamFailure: Option.none(),
    createTeamOpen: false,
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
    renameOpen: false,
    addMemberOpen: false,
    assignLeadOpen: false,
    pendingRemove: Option.none(),
    pendingRemovePerson: Option.none(),
    pendingErasePerson: Option.none(),
    erasePersonConfirmation: "",
    selfErase: { open: false, confirmation: "", busy: false, failure: Option.none() },
    emailChange: { step: "closed", email: "", code: "", busy: false, failure: Option.none() },
    correctEmail: { pending: Option.none(), value: "", busy: false, failure: Option.none() },
    offboardingDownloaded: false,
    offboarding: { open: false, confirmation: "", busy: false, failure: Option.none() },
    settings: { _tag: "Loading" },
    size: "3",
    sizeSaved: false,
    sizeBusy: false,
    sizeFailure: Option.none(),
    sizeOpen: false,
    aiBusy: false,
    aiFailure: Option.none(),
    peopleBusy: false,
    peopleFailure: Option.none(),
    failedEmails: { _tag: "Loading" },
    failedEmailResends: {},
    pulses: { _tag: "Loading" },
    homePulses: {},
    homeRounds: {},
    homeActions: {},
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
    roundsSkipOpen: false,
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
    actionFormOpen: false,
    pendingDropId: Option.none(),
    roundNote: { _tag: "Loading" },
    noteDraft: "",
    noteEditing: false,
    noteBusy: false,
    noteFailure: Option.none(),
  };
};

export const init = (url: Url): Update.Return<Model, Message> => ({
  model: initialModel(url, typeof navigator === "undefined" ? [] : navigator.languages),
  commands: [LoadSession(), DetectPasskeyCapabilities()],
});

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  conditionalPasskey: entry(
    { active: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        active:
          model.session._tag === "SignedOut" &&
          model.session.stage === "email" &&
          !model.session.busy &&
          !model.passkeySignInBusy &&
          model.passkeyCapabilities.conditionalGet,
      }),
      dependenciesToStream: ({ active }) => {
        if (!active) {
          return Stream.empty;
        }

        return Stream.fromEffect(authenticateWithPasskey({ conditional: true })).pipe(
          Stream.flatMap((outcome) => {
            if (outcome._tag === "Cancelled") {
              return Stream.empty;
            }

            return Stream.succeed(Message.PasskeySignedIn({ verified: outcome._tag === "Verified" }));
          }),
        );
      },
    },
  ),
}));

export const update = (model: Model, message: Message): Update.Return<Model, Message> => {
  switch (message._tag) {
    case "UrlRequested":
    case "UrlChanged":
    case "Navigated":
    case "GotSession":
    case "RetrySession":
    case "GotPasskeyCapabilities":
    case "SignInWithPasskeyClicked":
    case "PasskeySignedIn":
    case "SignInEmailChanged":
    case "SignInCodeChanged":
    case "SubmitSignInEmail":
    case "SubmitSignInCode":
    case "SignInCodeSent":
    case "SignInCodeChecked":
    case "CreateOrgNameChanged":
    case "SubmitCreateOrg":
    case "ChooseOrgClicked":
    case "GotNavMenuMessage":
    case "GotAccountMenuMessage": {
      return updateSession(model, message);
    }

    case "GotTeams":
    case "CreateTeamNameChanged":
    case "CreateTeamTimeZoneChanged":
    case "CreateTeamLeadEmailChanged":
    case "SubmitCreateTeam":
    case "CreatedTeam":
    case "GotTeam":
    case "RenameNameChanged":
    case "RenameTimeZoneChanged":
    case "SubmitRenameTeam":
    case "UpdatedTeam":
    case "AddMemberEmailChanged":
    case "SubmitAddMember":
    case "AddedMember":
    case "AssignLeadEmailChanged":
    case "SubmitAssignLead":
    case "AssignedLead":
    case "RemoveMemberClicked":
    case "RemovedMember":
    case "RemoveLeadClicked":
    case "ConfirmRemove":
    case "DismissRemove":
    case "RemovedLead": {
      return updateTeams(model, message);
    }

    case "GotSettings":
    case "GotFailedEmails":
    case "ResendFailedEmailClicked":
    case "ResentFailedEmail":
    case "PolledFailedEmail":
    case "SizeChanged":
    case "SubmitSize":
    case "UpdatedSettings":
    case "AiProcessingToggled":
    case "UpdatedAiProcessing":
    case "GrantAdminClicked":
    case "GrantedAdmin":
    case "RevokeAdminClicked":
    case "RevokedAdmin":
    case "RemovePersonClicked":
    case "AskDropAction":
    case "DismissDropAction":
    case "ConfirmDropAction":
    case "ToggleForm":
    case "RemovedPerson":
    case "ErasePersonClicked":
    case "ErasePersonConfirmationChanged":
    case "DismissErasePerson":
    case "ConfirmErasePerson":
    case "ErasedPerson":
    case "SelfEraseOpened":
    case "SelfEraseConfirmationChanged":
    case "SelfEraseDismissed":
    case "SelfEraseSubmitted":
    case "SelfErased":
    case "LeftAfterErasure":
    case "EmailChangeOpened":
    case "EmailChangeAddressChanged":
    case "EmailChangeCodeRequested":
    case "EmailChangeCodeSent":
    case "EmailChangeCodeChanged":
    case "EmailChangeConfirmed":
    case "EmailChangeFinished":
    case "EmailChangeOtherAddress":
    case "EmailChangeDismissed":
    case "CorrectEmailClicked":
    case "CorrectEmailChanged":
    case "CorrectEmailSubmitted":
    case "CorrectedEmail":
    case "CorrectEmailDismissed":
    case "OffboardingDownloaded":
    case "OffboardingOpened":
    case "OffboardingConfirmationChanged":
    case "OffboardingDismissed":
    case "OffboardingSubmitted":
    case "FinishPendingOffboarding":
    case "OffboardedOrganization": {
      return updateSettings(model, message, update);
    }

    case "GotPasskeys":
    case "AddPasskeyClicked":
    case "AddedPasskey":
    case "PasskeyRenameStarted":
    case "PasskeyRenameChanged":
    case "PasskeyRenameSaved":
    case "PasskeyRenameCancelled":
    case "PasskeyRenamed":
    case "PasskeyDeleteRequested":
    case "PasskeyDeleteConfirmed":
    case "PasskeyDeleteCancelled":
    case "PasskeyDeleted": {
      return updatePasskeys(model, message);
    }

    case "GotPulses":
    case "CreatePulseClicked":
    case "CreatedPulse":
    case "GotPulse":
    case "MoveQuestionClicked":
    case "ToggleEditQuestion":
    case "RemoveQuestionClicked":
    case "AddTemplateQuestionClicked":
    case "ToggleWritingQuestion":
    case "FormTextChanged":
    case "FormKindChanged":
    case "FormDimensionChanged":
    case "FormLowLabelChanged":
    case "FormHighLabelChanged":
    case "FormCommentToggled":
    case "FormOptionsChanged":
    case "SubmitQuestionForm":
    case "UpdatedPulse":
    case "SettingsNameChanged":
    case "SettingsDayChanged":
    case "SettingsTimeChanged":
    case "SettingsWindowChanged":
    case "SettingsReviewWindowChanged":
    case "SettingsRemindersChanged":
    case "SubmitSettings":
    case "SendTestInvitationClicked":
    case "SentTestInvitation":
    case "PolledTestSend": {
      return updatePulses(model, message);
    }

    case "GotRounds":
    case "GotRoundDetail":
    case "GotRoundRate":
    case "SkipDateChanged":
    case "SkipWeekClicked":
    case "SubmitSkipDate":
    case "PausePulseClicked":
    case "ResumePulseClicked":
    case "RoundConfirmRequested":
    case "RoundConfirmDismissed":
    case "RoundConfirmed":
    case "ResendInvitationClicked":
    case "RoundCommandDone":
    case "GotTeamOverview":
    case "GotMyHistory":
    case "ClearKeptAnswersClicked":
    case "ClearedKeptAnswers": {
      return updateRounds(model, message);
    }

    case "GotResults":
    case "ToggleResultsTable":
    case "CopyGuide":
    case "CopiedGuide":
    case "ShareResultsClicked":
    case "ResultsShareDone":
    case "RetryResultClicked":
    case "RetryResultDone":
    case "GotActions":
    case "ActionTitleChanged":
    case "ActionOwnerChanged":
    case "ActionDueDateChanged":
    case "ActionDimensionChanged":
    case "SubmitAction":
    case "CreatedAction":
    case "UpdateActionStatus":
    case "UpdatedAction":
    case "GotRoundNote":
    case "NoteEditClicked":
    case "NoteDraftChanged":
    case "NoteCancelClicked":
    case "SubmitNote":
    case "SavedNote": {
      return updateResults(model, message);
    }
  }
};
