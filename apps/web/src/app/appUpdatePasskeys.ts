import { Option } from "effect";
import type { Update } from "foldkit";
import { message as translate } from "../messages/locale.ts";
import type { Message, Model } from "./appModel.ts";
import {
  AddPasskeyCmd,
  DeletePasskeyCmd,
  ListPasskeysCmd,
  LoadSession,
  RenamePasskeyCmd,
} from "./appCommands.ts";

export type PasskeyMessage = Extract<
  Message,
  {
    _tag:
      | "GotPasskeys"
      | "AddPasskeyClicked"
      | "AddedPasskey"
      | "PasskeyRenameStarted"
      | "PasskeyRenameChanged"
      | "PasskeyRenameSaved"
      | "PasskeyRenameCancelled"
      | "PasskeyRenamed"
      | "PasskeyDeleteRequested"
      | "PasskeyDeleteConfirmed"
      | "PasskeyDeleteCancelled"
      | "PasskeyDeleted";
  }
>;

export const updatePasskeys = (model: Model, message: PasskeyMessage): Update.Return<Model, Message> => {
  switch (message._tag) {
    case "GotPasskeys": {
      if (message.outcome._tag === "Success") {
        return {
          model: {
            ...model,
            passkeys: {
              ...model.passkeys,
              list: { _tag: "Loaded", passkeys: message.outcome.passkeys },
            },
          },
        };
      }

      return {
        model: {
          ...model,
          passkeys: {
            ...model.passkeys,
            list: { _tag: "Failed", failure: message.outcome.failure },
          },
        },
      };
    }

    case "AddPasskeyClicked": {
      if (model.passkeys.busy || !model.passkeyCapabilities.supported) {
        return { model };
      }

      return {
        model: {
          ...model,
          passkeys: {
            ...model.passkeys,
            busy: true,
            notice: null,
            failure: Option.none(),
            editingId: Option.none(),
            pendingDeleteId: Option.none(),
          },
        },
        commands: [AddPasskeyCmd()],
      };
    }

    case "AddedPasskey": {
      if (message.cancelled) {
        return {
          model: { ...model, passkeys: { ...model.passkeys, busy: false } },
        };
      }

      if (message.outcome._tag === "Success") {
        return {
          model: {
            ...model,
            passkeys: {
              ...model.passkeys,
              busy: false,
              notice: translate("passkeys.added"),
              failure: Option.none(),
            },
          },
          commands: [ListPasskeysCmd()],
        };
      }

      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          passkeys: {
            ...model.passkeys,
            busy: false,
            failure: Option.some(message.outcome.failure),
          },
        },
      };
    }

    case "PasskeyRenameStarted": {
      return {
        model: {
          ...model,
          passkeys: {
            ...model.passkeys,
            editingId: Option.some(message.id),
            editingName: message.name,
            pendingDeleteId: Option.none(),
            notice: null,
            failure: Option.none(),
          },
        },
      };
    }

    case "PasskeyRenameChanged": {
      return {
        model: {
          ...model,
          passkeys: { ...model.passkeys, editingName: message.value, failure: Option.none() },
        },
      };
    }

    case "PasskeyRenameCancelled": {
      return {
        model: {
          ...model,
          passkeys: {
            ...model.passkeys,
            editingId: Option.none(),
            editingName: "",
            failure: Option.none(),
          },
        },
      };
    }

    case "PasskeyRenameSaved": {
      if (
        Option.isNone(model.passkeys.editingId) ||
        model.passkeys.busy ||
        model.passkeys.editingName.trim() === ""
      ) {
        return { model };
      }

      return {
        model: {
          ...model,
          passkeys: { ...model.passkeys, busy: true, notice: null, failure: Option.none() },
        },
        commands: [
          RenamePasskeyCmd({
            id: model.passkeys.editingId.value,
            name: model.passkeys.editingName.trim(),
          }),
        ],
      };
    }

    case "PasskeyRenamed": {
      if (message.outcome._tag === "Success") {
        return {
          model: {
            ...model,
            passkeys: {
              ...model.passkeys,
              busy: false,
              editingId: Option.none(),
              editingName: "",
              notice: translate("passkeys.renamed"),
              failure: Option.none(),
            },
          },
          commands: [ListPasskeysCmd()],
        };
      }

      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          passkeys: {
            ...model.passkeys,
            busy: false,
            failure: Option.some(message.outcome.failure),
          },
        },
      };
    }

    case "PasskeyDeleteRequested": {
      return {
        model: {
          ...model,
          passkeys: {
            ...model.passkeys,
            pendingDeleteId: Option.some(message.id),
            editingId: Option.none(),
            notice: null,
            failure: Option.none(),
          },
        },
      };
    }

    case "PasskeyDeleteCancelled": {
      return {
        model: {
          ...model,
          passkeys: { ...model.passkeys, pendingDeleteId: Option.none(), failure: Option.none() },
        },
      };
    }

    case "PasskeyDeleteConfirmed": {
      if (Option.isNone(model.passkeys.pendingDeleteId) || model.passkeys.busy) {
        return { model };
      }

      return {
        model: {
          ...model,
          passkeys: { ...model.passkeys, busy: true, notice: null, failure: Option.none() },
        },
        commands: [DeletePasskeyCmd({ id: model.passkeys.pendingDeleteId.value })],
      };
    }

    case "PasskeyDeleted": {
      if (message.outcome._tag === "Success") {
        return {
          model: {
            ...model,
            passkeys: {
              ...model.passkeys,
              busy: false,
              pendingDeleteId: Option.none(),
              notice: translate("passkeys.removed"),
              failure: Option.none(),
            },
          },
          commands: [ListPasskeysCmd()],
        };
      }

      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          passkeys: {
            ...model.passkeys,
            busy: false,
            failure: Option.some(message.outcome.failure),
          },
        },
      };
    }
  }
};
