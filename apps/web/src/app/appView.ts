import type { Locale } from "@surveybeat/domain";
import { Dimension, PersonId, resolveLocale, Weekday } from "@surveybeat/domain";
import { Option, Schema } from "effect";
import type { Document, HtmlBuilder } from "foldkit/html";
import { message, setLocale } from "../messages/locale.ts";
import type { Model } from "./appModel.ts";
import { Message } from "./appModel.ts";
import { attentionItems, firstRunChecklist, navSectionOf } from "./appNav.ts";
import { pageShell, privacyContent, privacyView, screenView } from "./components.ts";
import type { Child } from "./components.ts";
import { emailChangeView } from "./emailChange.ts";
import { selfErasureView } from "./erasure.ts";
import { settingsScreenView, shellView, teamScreenView, teamsScreenView } from "./directory.ts";
import { historyView } from "./history.ts";
import { teamOverviewView } from "./overview.ts";
import { passkeysView } from "./passkeysView.ts";
import { pulseEditorView, pulsesScreenView } from "./pulses.ts";
import { resultsScreenView } from "./results.ts";
import { roundsScreenView } from "./rounds.ts";
import { screenTitle } from "./titles.ts";
import {
  chooseOrganizationView,
  createOrganizationView,
  failedView,
  notInOrganizationView,
  signInView,
} from "./session.ts";

export const localeOf = (model: Model): Locale => {
  if (model.session._tag === "SignedIn") {
    return resolveLocale({
      person: model.session.locale,
      browser: Option.getOrNull(model.browserLocale),
      organization: model.session.organizationLocale,
    });
  }

  return Option.getOrElse(model.browserLocale, () => "en");
};

const selfErasureOf = (model: Model, kind: "person" | "account", h: HtmlBuilder<Message>): Child =>
  selfErasureView(
    {
      open: model.selfErase.open,
      confirmation: model.selfErase.confirmation,
      busy: model.selfErase.busy,
      failure: Option.getOrUndefined(model.selfErase.failure),
    },
    kind,
    {
      onOpen: Message.SelfEraseOpened(),
      onConfirmationChange: (value) => Message.SelfEraseConfirmationChanged({ value }),
      onSubmit: Message.SelfEraseSubmitted(),
      onCancel: Message.SelfEraseDismissed(),
    },
    h,
  );

const emailChangeOf = (model: Model, h: HtmlBuilder<Message>): Child =>
  emailChangeView(
    {
      step: model.emailChange.step,
      email: model.emailChange.email,
      code: model.emailChange.code,
      busy: model.emailChange.busy,
      failure: Option.getOrUndefined(model.emailChange.failure),
    },
    {
      onOpen: Message.EmailChangeOpened(),
      onEmailChange: (value) => Message.EmailChangeAddressChanged({ value }),
      onSendCode: Message.EmailChangeCodeRequested(),
      onCodeChange: (value) => Message.EmailChangeCodeChanged({ value }),
      onConfirm: Message.EmailChangeConfirmed(),
      onOtherAddress: Message.EmailChangeOtherAddress(),
      onCancel: Message.EmailChangeDismissed(),
    },
    h,
  );

const passkeysOf = (model: Model, h: HtmlBuilder<Message>): Child =>
  passkeysView(
    {
      list: model.passkeys.list,
      supported: model.passkeyCapabilities.supported,
      busy: model.passkeys.busy,
      notice: model.passkeys.notice,
      failure: Option.getOrUndefined(model.passkeys.failure),
      editingId: Option.getOrUndefined(model.passkeys.editingId),
      editingName: model.passkeys.editingName,
      pendingDeleteId: Option.getOrUndefined(model.passkeys.pendingDeleteId),
    },
    {
      onAdd: Message.AddPasskeyClicked(),
      onStartRename: (id, name) => Message.PasskeyRenameStarted({ id, name }),
      onRenameChange: (value) => Message.PasskeyRenameChanged({ value }),
      onSaveRename: Message.PasskeyRenameSaved(),
      onCancelRename: Message.PasskeyRenameCancelled(),
      onAskDelete: (id) => Message.PasskeyDeleteRequested({ id }),
      onConfirmDelete: Message.PasskeyDeleteConfirmed(),
      onCancelDelete: Message.PasskeyDeleteCancelled(),
    },
    h,
  );

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  setLocale(localeOf(model));

  if (
    model.route._tag === "Privacy" &&
    (model.session._tag === "CreateOrganization" || model.session._tag === "NotInOrganization")
  ) {
    return {
      title: message("privacy.title"),
      body: pageShell(
        { privacyCurrent: true },
        privacyContent(h, true, [
          passkeysOf(model, h),
          emailChangeOf(model, h),
          selfErasureOf(model, "account", h),
        ]),
        h,
      ),
    };
  }

  if (model.route._tag === "Privacy" && model.session._tag !== "SignedIn") {
    return {
      title: message("privacy.title"),
      body: privacyView(h),
    };
  }

  if (model.session._tag === "Loading") {
    return {
      title: message("app.title"),
      body: screenView(message("app.loading"), [], h),
    };
  }

  if (model.session._tag === "SignedOut") {
    return {
      title: message("signIn.title"),
      body: signInView(
        {
          failed: model.session.failed,
          stage: model.session.stage,
          email: model.session.email,
          code: model.session.code,
          busy: model.session.busy,
          notice: model.session.notice,
          passkeySupported: model.passkeyCapabilities.supported,
          passkeyBusy: model.passkeySignInBusy,
        },
        {
          onEmail: (email) => Message.SignInEmailChanged({ email }),
          onCode: (code) => Message.SignInCodeChanged({ code }),
          onSubmitEmail: Message.SubmitSignInEmail(),
          onSubmitCode: Message.SubmitSignInCode(),
          onSignInWithPasskey: Message.SignInWithPasskeyClicked(),
        },
        h,
      ),
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
      title: message("title.session", { screen: message("createOrganization.title") }),
      body: createOrganizationView(
        model.session.name,
        model.session.busy,
        (name) => Message.CreateOrgNameChanged({ name }),
        Message.SubmitCreateOrg(),
        h,
      ),
    };
  }

  const pendingOffboarding = {
    busy: model.offboarding.busy,
    failure: Option.getOrUndefined(model.offboarding.failure),
    onFinish: Message.FinishPendingOffboarding(),
  };

  if (model.session._tag === "NotInOrganization") {
    return {
      title: message("title.session", { screen: message("notInOrganization.title") }),
      body: notInOrganizationView(pendingOffboarding, h),
    };
  }

  if (model.session._tag === "ChooseOrganization") {
    return {
      title: message("title.session", { screen: message("chooseOrganization.title") }),
      body: chooseOrganizationView(
        model.session.organizations,
        model.session.busy,
        (id) => Message.ChooseOrgClicked({ organizationId: id }),
        pendingOffboarding,
        h,
      ),
    };
  }

  const { organization, organizationAdmin } = model.session;

  const shellTitle = screenTitle({
    route: model.route,
    organizationName: organization.name,
    organizationAdmin,
    teamDetail: model.teamDetail,
    pulses: model.pulses,
    pulseDetail: model.pulseDetail,
  });

  let screenContent = null;

  switch (model.route._tag) {
    case "Teams":
    case "NotFound": {
      screenContent = teamsScreenView(
        {
          teams: model.teams,
          attention: attentionItems(model),
          organizationAdmin,
          createName: model.createTeamName,
          createTimeZone: model.createTeamTimeZone,
          createLeadEmail: model.createTeamLeadEmail,
          createBusy: model.createTeamBusy,
          createFailure: Option.getOrUndefined(model.createTeamFailure),
          createOpen: model.createTeamOpen,
        },
        {
          onNameChange: (name) => Message.CreateTeamNameChanged({ name }),
          onTimeZoneChange: (tz) => Message.CreateTeamTimeZoneChanged({ tz }),
          onLeadEmailChange: (email) => Message.CreateTeamLeadEmailChanged({ email }),
          onSubmitCreate: Message.SubmitCreateTeam(),
          onToggleCreate: Message.ToggleForm({ form: "createTeam" }),
        },
        h,
      );
      break;
    }

    case "Team": {
      screenContent = teamScreenView(
        {
          team: model.teamDetail,
          checklist: firstRunChecklist(model),
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
          renameOpen: model.renameOpen,
          addMemberOpen: model.addMemberOpen,
          assignLeadOpen: model.assignLeadOpen,
          pendingRemove: Option.getOrUndefined(model.pendingRemove),
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
          onToggleRename: Message.ToggleForm({ form: "renameTeam" }),
          onToggleAddMember: Message.ToggleForm({ form: "addMember" }),
          onToggleAssignLead: Message.ToggleForm({ form: "assignLead" }),
          onConfirmRemove: Message.ConfirmRemove(),
          onCancelRemove: Message.DismissRemove(),
        },
        teamOverviewView(
          model.teamOverview,
          model.showTable.overview ?? false,
          Message.ToggleResultsTable({ key: "overview" }),
          h,
        ),
        h,
      );
      break;
    }

    case "Privacy": {
      screenContent = h.div(
        [],
        privacyContent(h, true, [
          passkeysOf(model, h),
          emailChangeOf(model, h),
          selfErasureOf(model, "person", h),
        ]),
      );
      break;
    }

    case "History": {
      screenContent = historyView(model.history, { onClear: Message.ClearKeptAnswersClicked() }, h);
      break;
    }

    case "Settings": {
      screenContent = !organizationAdmin
        ? teamsScreenView(
            {
              teams: model.teams,
              attention: attentionItems(model),
              organizationAdmin: false,
              createName: model.createTeamName,
              createTimeZone: model.createTeamTimeZone,
              createLeadEmail: model.createTeamLeadEmail,
              createBusy: model.createTeamBusy,
              createFailure: Option.getOrUndefined(model.createTeamFailure),
              createOpen: model.createTeamOpen,
            },
            {
              onNameChange: (name) => Message.CreateTeamNameChanged({ name }),
              onTimeZoneChange: (tz) => Message.CreateTeamTimeZoneChanged({ tz }),
              onLeadEmailChange: (email) => Message.CreateTeamLeadEmailChanged({ email }),
              onSubmitCreate: Message.SubmitCreateTeam(),
              onToggleCreate: Message.ToggleForm({ form: "createTeam" }),
            },
            h,
          )
        : settingsScreenView(
            {
              settings: model.settings,
              size: model.size,
              sizeSaved: model.sizeSaved,
              sizeBusy: model.sizeBusy,
              sizeFailure: Option.getOrUndefined(model.sizeFailure),
              sizeOpen: model.sizeOpen,
              aiBusy: model.aiBusy,
              aiFailure: Option.getOrUndefined(model.aiFailure),
              peopleBusy: model.peopleBusy,
              peopleFailure: Option.getOrUndefined(model.peopleFailure),
              pendingRemovePerson: Option.getOrUndefined(model.pendingRemovePerson),
              pendingErasePerson: Option.getOrUndefined(model.pendingErasePerson),
              erasePersonConfirmation: model.erasePersonConfirmation,
              correctEmail: {
                pending: Option.getOrUndefined(model.correctEmail.pending),
                value: model.correctEmail.value,
                busy: model.correctEmail.busy,
                failure: Option.getOrUndefined(model.correctEmail.failure),
              },
              failedEmails: model.failedEmails,
              failedEmailResends: model.failedEmailResends,
              offboardingDownloaded: model.offboardingDownloaded,
              offboarding: {
                open: model.offboarding.open,
                confirmation: model.offboarding.confirmation,
                busy: model.offboarding.busy,
                failure: Option.getOrUndefined(model.offboarding.failure),
              },
            },
            {
              onSizeChange: (size) => Message.SizeChanged({ size }),
              onToggleSize: Message.ToggleForm({ form: "minimumSize" }),
              onSubmitSize: Message.SubmitSize(),
              onAiProcessingToggle: (isOn) => Message.AiProcessingToggled({ isOn }),
              onGrantAdmin: (personId) => Message.GrantAdminClicked({ personId }),
              onRevokeAdmin: (personId) => Message.RevokeAdminClicked({ personId }),
              onRemovePerson: (personId) => Message.RemovePersonClicked({ personId }),
              onConfirmRemovePerson: Message.ConfirmRemove(),
              onCancelRemovePerson: Message.DismissRemove(),
              onErasePerson: (personId) => Message.ErasePersonClicked({ personId }),
              onErasePersonConfirmationChange: (value) => Message.ErasePersonConfirmationChanged({ value }),
              onConfirmErasePerson: Message.ConfirmErasePerson(),
              onCancelErasePerson: Message.DismissErasePerson(),
              onCorrectEmail: (personId) => Message.CorrectEmailClicked({ personId }),
              onCorrectEmailChange: (value) => Message.CorrectEmailChanged({ value }),
              onSubmitCorrectEmail: Message.CorrectEmailSubmitted(),
              onCancelCorrectEmail: Message.CorrectEmailDismissed(),
              onResendFailedEmail: (sendId) => Message.ResendFailedEmailClicked({ sendId }),
              onOffboardingDownloaded: Message.OffboardingDownloaded(),
              onOffboardingOpen: Message.OffboardingOpened(),
              onOffboardingConfirmationChange: (value) => Message.OffboardingConfirmationChanged({ value }),
              onOffboardingSubmit: Message.OffboardingSubmitted(),
              onOffboardingCancel: Message.OffboardingDismissed(),
            },
            h,
          );

      break;
    }

    case "Pulses": {
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
    }

    case "Pulse": {
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
    }

    case "Rounds": {
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
          skipOpen: model.roundsSkipOpen,
          busy: model.roundsBusy,
          failure: Option.getOrUndefined(model.roundsFailure),
        },
        {
          onSkipWeek: (plannedOpenDate) => Message.SkipWeekClicked({ plannedOpenDate }),
          onSkipDateChange: (date) => Message.SkipDateChanged({ date }),
          onSubmitSkipDate: Message.SubmitSkipDate(),
          onToggleSkip: Message.ToggleForm({ form: "skipWeek" }),
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
    }

    case "RoundResults": {
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
          actionFormOpen: model.actionFormOpen,
          pendingDropId: Option.getOrUndefined(model.pendingDropId),
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
          onToggleActionForm: Message.ToggleForm({ form: "commitAction" }),
          onAskDrop: (actionId) => Message.AskDropAction({ actionId }),
          onConfirmDrop: Message.ConfirmDropAction(),
          onCancelDrop: Message.DismissDropAction(),
          onUpdateActionStatus: (actionId, status) => Message.UpdateActionStatus({ actionId, status }),
        },
        h,
      );
      break;
    }
  }

  return {
    title: shellTitle,
    body: shellView(
      {
        organizationName: organization.name,
        organizationAdmin,
        section: navSectionOf(model.route, organizationAdmin),
        privacyCurrent: model.route._tag === "Privacy",
        navMenu: model.navMenu,
        accountMenu: model.accountMenu,
        onNavMenu: (message) => Message.GotNavMenuMessage({ message }),
        onAccountMenu: (message) => Message.GotAccountMenuMessage({ message }),
      },
      [screenContent],
      h,
      model.route._tag === "RoundResults" ||
        model.route._tag === "Teams" ||
        model.route._tag === "Team" ||
        model.route._tag === "Rounds" ||
        model.route._tag === "History",
    ),
  };
};
