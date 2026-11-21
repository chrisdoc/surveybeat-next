import { Option } from "effect";
import type { Update } from "foldkit";
import type { Model } from "./appModel.ts";
import { Message } from "./appModel.ts";
import {
  LoadSession,
  GetSettings,
  ResendFailedEmailCmd,
  PollFailedEmailCmd,
  withFailedEmailResend,
  UpdateSettings,
  UpdateAiProcessing,
  GrantAdmin,
  RevokeAdmin,
  ErasePersonData,
  EraseOwnPersonData,
  EraseOwnAccountData,
  RequestEmailChange,
  ConfirmEmailChange,
  CorrectPersonEmail,
  OffboardOrganization,
  LeaveAfterErasureCmd,
} from "./appCommands.ts";
import { decodeEmail, decodeSize, failedEmailKeepsPolling } from "./directory.ts";

type SettingsMessage = Extract<
  Message,
  {
    _tag:
      | "GotSettings"
      | "GotFailedEmails"
      | "ResendFailedEmailClicked"
      | "ResentFailedEmail"
      | "PolledFailedEmail"
      | "SizeChanged"
      | "SubmitSize"
      | "UpdatedSettings"
      | "AiProcessingToggled"
      | "UpdatedAiProcessing"
      | "GrantAdminClicked"
      | "GrantedAdmin"
      | "RevokeAdminClicked"
      | "RevokedAdmin"
      | "RemovePersonClicked"
      | "AskDropAction"
      | "DismissDropAction"
      | "ConfirmDropAction"
      | "ToggleForm"
      | "RemovedPerson"
      | "ErasePersonClicked"
      | "ErasePersonConfirmationChanged"
      | "DismissErasePerson"
      | "ConfirmErasePerson"
      | "ErasedPerson"
      | "SelfEraseOpened"
      | "SelfEraseConfirmationChanged"
      | "SelfEraseDismissed"
      | "SelfEraseSubmitted"
      | "SelfErased"
      | "LeftAfterErasure"
      | "EmailChangeOpened"
      | "EmailChangeAddressChanged"
      | "EmailChangeCodeRequested"
      | "EmailChangeCodeSent"
      | "EmailChangeCodeChanged"
      | "EmailChangeConfirmed"
      | "EmailChangeFinished"
      | "EmailChangeOtherAddress"
      | "EmailChangeDismissed"
      | "CorrectEmailClicked"
      | "CorrectEmailChanged"
      | "CorrectEmailSubmitted"
      | "CorrectedEmail"
      | "CorrectEmailDismissed"
      | "OffboardingDownloaded"
      | "OffboardingOpened"
      | "OffboardingConfirmationChanged"
      | "OffboardingDismissed"
      | "OffboardingSubmitted"
      | "FinishPendingOffboarding"
      | "OffboardedOrganization";
  }
>;

export const updateSettings = (
  model: Model,
  message: SettingsMessage,
  update: (current: Model, command: Message) => Update.Return<Model, Message>,
): Update.Return<Model, Message> => {
  switch (message._tag) {
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

      if (model.failedEmailResends[sendId]?._tag !== "Resending") {
        return { model };
      }

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

      if (!failedEmailKeepsPolling(state, 0)) {
        return { model: next };
      }

      return { model: next, commands: [PollFailedEmailCmd({ sendId })] };
    }

    case "PolledFailedEmail": {
      const { sendId, outcome } = message;
      const current = model.failedEmailResends[sendId];

      if (current?._tag !== "Resent") {
        return { model };
      }

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

        statusUnavailable: !keepsPolling && !settled,
      });

      if (!keepsPolling) {
        return { model: next };
      }

      return { model: next, commands: [PollFailedEmailCmd({ sendId })] };
    }

    case "SizeChanged": {
      return { model: { ...model, size: message.size, sizeSaved: false } };
    }

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

    case "AiProcessingToggled": {
      if (model.aiBusy) {
        return { model };
      }

      return {
        model: { ...model, aiBusy: true, aiFailure: Option.none() },
        commands: [UpdateAiProcessing({ aiProcessing: message.isOn })],
      };
    }

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

    case "GrantAdminClicked": {
      return {
        model: { ...model, peopleBusy: true, peopleFailure: Option.none() },
        commands: [GrantAdmin({ personId: message.personId })],
      };
    }

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

    case "RevokeAdminClicked": {
      return {
        model: { ...model, peopleBusy: true, peopleFailure: Option.none() },
        commands: [RevokeAdmin({ personId: message.personId })],
      };
    }

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

    case "RemovePersonClicked": {
      const person =
        model.settings._tag === "Loaded"
          ? model.settings.settings.people.find((row) => row.personId === message.personId)
          : undefined;

      return {
        model: {
          ...model,
          peopleFailure: Option.none(),
          pendingRemovePerson: Option.some({
            personId: message.personId,
            email: person?.email ?? "",
          }),
        },
      };
    }

    case "AskDropAction": {
      return { model: { ...model, pendingDropId: Option.some(message.actionId) } };
    }

    case "DismissDropAction": {
      return { model: { ...model, pendingDropId: Option.none() } };
    }

    case "ConfirmDropAction": {
      if (Option.isNone(model.pendingDropId)) {
        return { model };
      }

      return update(
        model,
        Message.UpdateActionStatus({ actionId: model.pendingDropId.value, status: "dropped" }),
      );
    }

    case "ToggleForm": {
      switch (message.form) {
        case "createTeam": {
          return { model: { ...model, createTeamOpen: !model.createTeamOpen } };
        }

        case "renameTeam": {
          return { model: { ...model, renameOpen: !model.renameOpen } };
        }

        case "addMember": {
          return { model: { ...model, addMemberOpen: !model.addMemberOpen } };
        }

        case "assignLead": {
          return { model: { ...model, assignLeadOpen: !model.assignLeadOpen } };
        }

        case "skipWeek": {
          return { model: { ...model, roundsSkipOpen: !model.roundsSkipOpen } };
        }

        case "commitAction": {
          return { model: { ...model, actionFormOpen: !model.actionFormOpen } };
        }

        case "minimumSize": {
          return { model: { ...model, sizeOpen: !model.sizeOpen } };
        }
      }

      return { model };
    }

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

    case "ErasePersonClicked": {
      const loaded = model.settings._tag === "Loaded" ? model.settings.settings : undefined;

      const person =
        loaded?.people.find((row) => row.personId === message.personId) ??
        loaded?.removedPeople.find((row) => row.personId === message.personId);

      return {
        model: {
          ...model,
          peopleFailure: Option.none(),
          erasePersonConfirmation: "",
          pendingErasePerson: Option.some({ personId: message.personId, email: person?.email ?? "" }),
        },
      };
    }

    case "ErasePersonConfirmationChanged": {
      return { model: { ...model, erasePersonConfirmation: message.value, peopleFailure: Option.none() } };
    }

    case "DismissErasePerson": {
      return {
        model: {
          ...model,
          pendingErasePerson: Option.none(),
          erasePersonConfirmation: "",
          peopleFailure: Option.none(),
        },
      };
    }

    case "ConfirmErasePerson": {
      if (Option.isNone(model.pendingErasePerson)) {
        return { model };
      }

      const confirmation = decodeEmail(model.erasePersonConfirmation.trim());

      if (Option.isNone(confirmation)) {
        return { model: { ...model, peopleFailure: Option.some("ErasureNotConfirmed") } };
      }

      return {
        model: { ...model, peopleBusy: true, peopleFailure: Option.none() },
        commands: [
          ErasePersonData({
            personId: model.pendingErasePerson.value.personId,
            confirmation: confirmation.value,
          }),
        ],
      };
    }

    case "ErasedPerson": {
      if (message.outcome._tag === "Success") {
        return {
          model: {
            ...model,
            peopleBusy: false,
            pendingErasePerson: Option.none(),
            erasePersonConfirmation: "",
          },
          commands: [GetSettings()],
        };
      }

      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: { ...model, peopleBusy: false, peopleFailure: Option.some(message.outcome.failure) },
      };
    }

    case "SelfEraseOpened": {
      return {
        model: { ...model, selfErase: { open: true, confirmation: "", busy: false, failure: Option.none() } },
      };
    }

    case "SelfEraseConfirmationChanged": {
      return {
        model: {
          ...model,
          selfErase: { ...model.selfErase, confirmation: message.value, failure: Option.none() },
        },
      };
    }

    case "SelfEraseDismissed": {
      return {
        model: {
          ...model,
          selfErase: { open: false, confirmation: "", busy: false, failure: Option.none() },
        },
      };
    }

    case "SelfEraseSubmitted": {
      const confirmation = decodeEmail(model.selfErase.confirmation.trim());

      if (Option.isNone(confirmation)) {
        return {
          model: { ...model, selfErase: { ...model.selfErase, failure: Option.some("ErasureNotConfirmed") } },
        };
      }

      return {
        model: { ...model, selfErase: { ...model.selfErase, busy: true, failure: Option.none() } },
        commands: [
          model.session._tag === "SignedIn"
            ? EraseOwnPersonData({ confirmation: confirmation.value })
            : EraseOwnAccountData({ confirmation: confirmation.value }),
        ],
      };
    }

    case "SelfErased": {
      if (message.outcome._tag === "Success") {
        return { model, commands: [LeaveAfterErasureCmd()] };
      }

      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          selfErase: { ...model.selfErase, busy: false, failure: Option.some(message.outcome.failure) },
        },
      };
    }

    case "LeftAfterErasure": {
      return { model };
    }

    case "EmailChangeOpened": {
      return {
        model: {
          ...model,
          emailChange: { step: "address", email: "", code: "", busy: false, failure: Option.none() },
        },
      };
    }

    case "EmailChangeAddressChanged": {
      return {
        model: {
          ...model,
          emailChange: { ...model.emailChange, email: message.value, failure: Option.none() },
        },
      };
    }

    case "EmailChangeCodeRequested": {
      const email = model.emailChange.email.trim();

      if (email === "") {
        return { model };
      }

      return {
        model: { ...model, emailChange: { ...model.emailChange, busy: true, failure: Option.none() } },
        commands: [RequestEmailChange({ email })],
      };
    }

    case "EmailChangeCodeSent": {
      if (message.outcome._tag === "Success") {
        return {
          model: {
            ...model,
            emailChange: {
              ...model.emailChange,
              step: "code",
              code: "",
              busy: false,
              failure: Option.none(),
            },
          },
        };
      }

      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          emailChange: { ...model.emailChange, busy: false, failure: Option.some(message.outcome.failure) },
        },
      };
    }

    case "EmailChangeCodeChanged": {
      return {
        model: {
          ...model,
          emailChange: { ...model.emailChange, code: message.value, failure: Option.none() },
        },
      };
    }

    case "EmailChangeConfirmed": {
      const otp = model.emailChange.code.trim();

      if (otp === "") {
        return { model };
      }

      return {
        model: { ...model, emailChange: { ...model.emailChange, busy: true, failure: Option.none() } },
        commands: [ConfirmEmailChange({ email: model.emailChange.email.trim(), otp })],
      };
    }

    case "EmailChangeFinished": {
      if (message.outcome._tag === "Success") {
        return {
          model: {
            ...model,
            emailChange: {
              ...model.emailChange,
              step: "done",
              code: "",
              busy: false,
              failure: Option.none(),
            },
          },
        };
      }

      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          emailChange: { ...model.emailChange, busy: false, failure: Option.some(message.outcome.failure) },
        },
      };
    }

    case "EmailChangeOtherAddress": {
      return {
        model: {
          ...model,
          emailChange: {
            ...model.emailChange,
            step: "address",
            code: "",
            busy: false,
            failure: Option.none(),
          },
        },
      };
    }

    case "EmailChangeDismissed": {
      return {
        model: {
          ...model,
          emailChange: { step: "closed", email: "", code: "", busy: false, failure: Option.none() },
        },
      };
    }

    case "CorrectEmailClicked": {
      const loaded = model.settings._tag === "Loaded" ? model.settings.settings : undefined;

      const person =
        loaded?.people.find((row) => row.personId === message.personId) ??
        loaded?.removedPeople.find((row) => row.personId === message.personId);

      return {
        model: {
          ...model,
          correctEmail: {
            pending: Option.some({ personId: message.personId, email: person?.email ?? "" }),
            value: "",
            busy: false,
            failure: Option.none(),
          },
        },
      };
    }

    case "CorrectEmailChanged": {
      return {
        model: {
          ...model,
          correctEmail: { ...model.correctEmail, value: message.value, failure: Option.none() },
        },
      };
    }

    case "CorrectEmailSubmitted": {
      const email = model.correctEmail.value.trim();

      if (Option.isNone(model.correctEmail.pending) || email === "") {
        return { model };
      }

      return {
        model: { ...model, correctEmail: { ...model.correctEmail, busy: true, failure: Option.none() } },
        commands: [CorrectPersonEmail({ personId: model.correctEmail.pending.value.personId, email })],
      };
    }

    case "CorrectedEmail": {
      if (message.outcome._tag === "Success") {
        return {
          model: {
            ...model,
            correctEmail: { pending: Option.none(), value: "", busy: false, failure: Option.none() },
          },
          commands: [GetSettings()],
        };
      }

      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          correctEmail: { ...model.correctEmail, busy: false, failure: Option.some(message.outcome.failure) },
        },
      };
    }

    case "CorrectEmailDismissed": {
      return {
        model: {
          ...model,
          correctEmail: { pending: Option.none(), value: "", busy: false, failure: Option.none() },
        },
      };
    }

    case "OffboardingDownloaded": {
      return { model: { ...model, offboardingDownloaded: true } };
    }

    case "OffboardingOpened": {
      if (!model.offboardingDownloaded) {
        return { model };
      }

      return {
        model: {
          ...model,
          offboarding: { open: true, confirmation: "", busy: false, failure: Option.none() },
        },
      };
    }

    case "OffboardingConfirmationChanged": {
      return {
        model: {
          ...model,
          offboarding: { ...model.offboarding, confirmation: message.value, failure: Option.none() },
        },
      };
    }

    case "OffboardingDismissed": {
      return {
        model: {
          ...model,
          offboarding: { open: false, confirmation: "", busy: false, failure: Option.none() },
        },
      };
    }

    case "OffboardingSubmitted": {
      if (
        !model.offboardingDownloaded ||
        !model.offboarding.open ||
        model.offboarding.busy ||
        model.offboarding.confirmation.trim() === ""
      ) {
        return { model };
      }

      return {
        model: { ...model, offboarding: { ...model.offboarding, busy: true, failure: Option.none() } },
        commands: [OffboardOrganization({ confirmation: model.offboarding.confirmation })],
      };
    }

    case "FinishPendingOffboarding": {
      if (
        model.offboarding.busy ||
        (model.session._tag !== "NotInOrganization" && model.session._tag !== "ChooseOrganization")
      ) {
        return { model };
      }

      return {
        model: { ...model, offboarding: { ...model.offboarding, busy: true, failure: Option.none() } },
        commands: [OffboardOrganization({ confirmation: "" })],
      };
    }

    case "OffboardedOrganization": {
      if (message.outcome._tag === "Success") {
        return { model, commands: [LeaveAfterErasureCmd()] };
      }

      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          offboarding: { ...model.offboarding, busy: false, failure: Option.some(message.outcome.failure) },
        },
      };
    }
  }
};
