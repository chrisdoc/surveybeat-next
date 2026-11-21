import type { ActionItem } from "@surveybeat/domain";
import { Policy } from "@surveybeat/domain";
import { Option } from "effect";
import type { Update } from "foldkit";
import type { Model, Message } from "./appModel.ts";
import {
  GetResultsCmd,
  CopyGuideTextCmd,
  ShareResultsCmd,
  RetryResultCmd,
  CreateActionCmd,
  UpdateActionCmd,
  SaveRoundNoteCmd,
} from "./appCommands.ts";
import { isCurrentRoundNote } from "./appNav.ts";
import { LoadedActions, LoadedNote } from "./results.ts";

type ResultsMessage = Extract<
  Message,
  {
    _tag:
      | "GotResults"
      | "ToggleResultsTable"
      | "CopyGuide"
      | "CopiedGuide"
      | "ShareResultsClicked"
      | "ResultsShareDone"
      | "RetryResultClicked"
      | "RetryResultDone"
      | "GotActions"
      | "ActionTitleChanged"
      | "ActionOwnerChanged"
      | "ActionDueDateChanged"
      | "ActionDimensionChanged"
      | "SubmitAction"
      | "CreatedAction"
      | "UpdateActionStatus"
      | "UpdatedAction"
      | "GotRoundNote"
      | "NoteEditClicked"
      | "NoteDraftChanged"
      | "NoteCancelClicked"
      | "SubmitNote"
      | "SavedNote";
  }
>;

export const updateResults = (model: Model, message: ResultsMessage): Update.Return<Model, Message> => {
  switch (message._tag) {
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

    case "CopyGuide": {
      return {
        model: { ...model, guideCopy: "idle" },
        commands: [CopyGuideTextCmd({ text: message.text })],
      };
    }

    case "CopiedGuide": {
      return { model: { ...model, guideCopy: message.ok ? "copied" : "failed" } };
    }

    case "ShareResultsClicked": {
      if (model.route._tag !== "RoundResults" || model.shareBusy) {
        return { model };
      }

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

      const reload =
        model.route._tag === "RoundResults"
          ? [GetResultsCmd({ teamId: model.route.teamId, roundId: model.route.roundId })]
          : [];

      return { model: { ...model, shareBusy: false, shareFailure: Option.none() }, commands: reload };
    }

    case "RetryResultClicked": {
      if (model.route._tag !== "RoundResults" || model.retryBusy) {
        return { model };
      }

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

      const reload =
        model.route._tag === "RoundResults"
          ? [GetResultsCmd({ teamId: model.route.teamId, roundId: model.route.roundId })]
          : [];

      return { model: { ...model, retryBusy: false, retryFailure: Option.none() }, commands: reload };
    }

    case "GotActions": {
      const { outcome } = message;

      if (outcome._tag === "Success") {
        return {
          model: {
            ...model,
            actions: { _tag: "Loaded", actions: outcome.list.actions },
            homeActions:
              model.route._tag === "Teams"
                ? { ...model.homeActions, [outcome.list.teamId]: outcome.list.actions }
                : model.homeActions,
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

    case "ActionTitleChanged": {
      return { model: { ...model, actionTitle: message.title } };
    }

    case "ActionOwnerChanged": {
      return { model: { ...model, actionOwnerId: Option.some(message.personId) } };
    }

    case "ActionDueDateChanged": {
      return { model: { ...model, actionDueDate: message.dueDate } };
    }

    case "ActionDimensionChanged": {
      return { model: { ...model, actionDimension: message.dimension } };
    }

    case "SubmitAction": {
      if (model.route._tag !== "RoundResults" || model.actionTitle.trim() === "") {
        return { model };
      }

      const teamId = model.route.teamId;
      const roundId = model.route.roundId;
      const roster = model.teamDetail._tag === "Loaded" ? model.teamDetail.detail.roster : [];
      const ownerId = Option.getOrElse(model.actionOwnerId, () => roster[0]?.personId);

      if (ownerId === undefined) {
        return { model };
      }

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
      if (model.route._tag !== "RoundResults") {
        return { model };
      }

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

    case "GotRoundNote": {
      const { outcome } = message;

      if (outcome._tag === "Success") {
        if (!isCurrentRoundNote(model, outcome.view.roundId)) {
          return { model };
        }

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

    case "NoteDraftChanged": {
      return { model: { ...model, noteDraft: message.text } };
    }

    case "NoteCancelClicked": {
      return { model: { ...model, noteEditing: false, noteFailure: Option.none() } };
    }

    case "SubmitNote": {
      if (
        model.route._tag !== "RoundResults" ||
        model.noteBusy ||
        model.noteDraft.length > Policy.text.noteMaxLength
      ) {
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
        if (!isCurrentRoundNote(model, outcome.view.roundId)) {
          return { model };
        }

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
