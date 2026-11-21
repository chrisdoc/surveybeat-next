import type { QuestionId, QuestionType } from "@surveybeat/domain";
import { Option } from "effect";
import type { Update } from "foldkit";
import type { Model, Message } from "./appModel.ts";
import {
  LoadSession,
  CreatePulse,
  UpdatePulseSettingsCmd,
  SendTestInvitationCmd,
  PollTestSendCmd,
  AddQuestionCmd,
  EditQuestionCmd,
  RemoveQuestionCmd,
  ReorderQuestionsCmd,
  ListRoundsCmd,
  ListActionsCmd,
  Navigate,
} from "./appCommands.ts";
import { decodeContent, decodeSettings, testSendKeepsPolling } from "./pulses.ts";
import { pulseHref } from "./routes.ts";

type PulsesMessage = Extract<
  Message,
  {
    _tag:
      | "GotPulses"
      | "CreatePulseClicked"
      | "CreatedPulse"
      | "GotPulse"
      | "MoveQuestionClicked"
      | "ToggleEditQuestion"
      | "RemoveQuestionClicked"
      | "AddTemplateQuestionClicked"
      | "ToggleWritingQuestion"
      | "FormTextChanged"
      | "FormKindChanged"
      | "FormDimensionChanged"
      | "FormLowLabelChanged"
      | "FormHighLabelChanged"
      | "FormCommentToggled"
      | "FormOptionsChanged"
      | "SubmitQuestionForm"
      | "UpdatedPulse"
      | "SettingsNameChanged"
      | "SettingsDayChanged"
      | "SettingsTimeChanged"
      | "SettingsWindowChanged"
      | "SettingsReviewWindowChanged"
      | "SettingsRemindersChanged"
      | "SubmitSettings"
      | "SendTestInvitationClicked"
      | "SentTestInvitation"
      | "PolledTestSend";
  }
>;

export const updatePulses = (model: Model, message: PulsesMessage): Update.Return<Model, Message> => {
  switch (message._tag) {
    case "GotPulses": {
      const { outcome } = message;

      if (outcome._tag === "Success") {
        return {
          model: {
            ...model,
            pulses: { _tag: "Loaded", pulses: outcome.pulses },
            homePulses:
              model.route._tag === "Teams"
                ? { ...model.homePulses, [outcome.pulses.team.id]: outcome.pulses }
                : model.homePulses,
          },
          commands:
            model.route._tag === "Team" && outcome.pulses.pulses[0] !== undefined
              ? [ListRoundsCmd({ teamId: model.route.teamId, pulseId: outcome.pulses.pulses[0].id })]
              : model.route._tag === "Teams"
                ? [
                    ...outcome.pulses.pulses.map((pulse) =>
                      ListRoundsCmd({ teamId: outcome.pulses.team.id, pulseId: pulse.id }),
                    ),
                    ListActionsCmd({ teamId: outcome.pulses.team.id }),
                  ]
                : [],
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
      if (model.route._tag !== "Pulses") {
        return { model };
      }

      const teamId = model.route.teamId;

      return {
        model: { ...model, createPulseBusy: true, createPulseFailure: Option.none() },
        commands: [CreatePulse({ teamId })],
      };
    }

    case "CreatedPulse": {
      if (model.route._tag !== "Pulses") {
        return { model };
      }

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
      if (model.pulseDetail._tag !== "Loaded") {
        return { model };
      }

      const { detail } = model.pulseDetail;
      const order: QuestionId[] = detail.questions.map((q) => q.questionId);
      const [moved] = order.splice(message.index, 1);

      if (moved === undefined) {
        return { model };
      }

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

      if (model.pulseDetail._tag !== "Loaded") {
        return { model };
      }

      const q = model.pulseDetail.detail.questions.find((question) => question.questionId === targetId);

      if (!q) {
        return { model };
      }

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
      if (model.pulseDetail._tag !== "Loaded") {
        return { model };
      }

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
      if (model.pulseDetail._tag !== "Loaded") {
        return { model };
      }

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

    case "ToggleWritingQuestion": {
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
    }

    case "FormTextChanged": {
      return { model: { ...model, formText: message.text } };
    }

    case "FormKindChanged": {
      return { model: { ...model, formKind: message.kind } };
    }

    case "FormDimensionChanged": {
      return { model: { ...model, formDimension: message.dim } };
    }

    case "FormLowLabelChanged": {
      return { model: { ...model, formLowLabel: message.low } };
    }

    case "FormHighLabelChanged": {
      return { model: { ...model, formHighLabel: message.high } };
    }

    case "FormCommentToggled": {
      return { model: { ...model, formComment: message.comment } };
    }

    case "FormOptionsChanged": {
      return { model: { ...model, formOptions: message.options } };
    }

    case "SubmitQuestionForm": {
      if (model.pulseDetail._tag !== "Loaded") {
        return { model };
      }

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
      }

      if (Option.isNone(model.editingQuestionId)) {
        return { model };
      }

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

    case "SettingsNameChanged": {
      return { model: { ...model, settingsName: message.name, settingsSaved: false } };
    }

    case "SettingsDayChanged": {
      return { model: { ...model, settingsDay: message.day, settingsSaved: false } };
    }

    case "SettingsTimeChanged": {
      return { model: { ...model, settingsTime: message.time, settingsSaved: false } };
    }

    case "SettingsWindowChanged": {
      return {
        model: { ...model, settingsWindow: Number(message.days), settingsSaved: false },
      };
    }

    case "SettingsReviewWindowChanged": {
      return {
        model: { ...model, settingsReviewWindow: Number(message.days), settingsSaved: false },
      };
    }

    case "SettingsRemindersChanged": {
      return {
        model: { ...model, settingsReminders: Number(message.reminders), settingsSaved: false },
      };
    }

    case "SubmitSettings": {
      if (model.pulseDetail._tag !== "Loaded") {
        return { model };
      }

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
      if (model.pulseDetail._tag !== "Loaded" || model.testSendBusy) {
        return { model };
      }

      const { detail } = model.pulseDetail;

      return {
        model: { ...model, testSendBusy: true, testSendResult: Option.none() },
        commands: [SendTestInvitationCmd({ teamId: detail.team.id, pulseId: detail.id })],
      };
    }

    case "SentTestInvitation": {
      const { outcome } = message;

      if (outcome._tag === "Success") {
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

      if (current?._tag !== "Sent" || current.sendId !== sendId) {
        return { model };
      }

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

      if (model.route._tag !== "Pulse" || !testSendKeepsPolling(status)) {
        return { model: next };
      }

      return {
        model: next,
        commands: [PollTestSendCmd({ teamId: model.route.teamId, pulseId: model.route.pulseId, sendId })],
      };
    }
  }
};
