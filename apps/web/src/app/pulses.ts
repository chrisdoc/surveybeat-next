import {
  Dimension,
  PulseDetail,
  PulseList,
  PulseSettings,
  type PulseWarning,
  QuestionContent,
  type QuestionId,
  type QuestionType,
  TemplateQuestionKey,
  type TeamId,
  Weekday,
} from "@surveybeat/domain";
import { Option, Predicate, Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";
import { message, pluralMessage } from "../messages/index.ts";
import { Failure } from "./api.ts";
import {
  appButton,
  buttonClass,
  checkboxField,
  type Child,
  linkButton,
  problemView,
  selectField,
  textField,
  textareaField,
} from "./components.ts";
import { pulseHref, pulsesHref, teamHref } from "./routes.ts";

export const LoadedPulses = defineTaggedUnion({
  Loading: {},
  Loaded: { pulses: PulseList },
  Failed: { failure: Failure },
});
export type LoadedPulses = typeof LoadedPulses.Type;

export const LoadedPulse = defineTaggedUnion({
  Loading: {},
  Loaded: { detail: PulseDetail },
  Failed: { failure: Failure },
});
export type LoadedPulse = typeof LoadedPulse.Type;

export const dimensionName = (dimension: Dimension | null): string =>
  dimension === null ? message("dimension.none") : message(`dimension.${dimension}`);

export const typeName = (type: QuestionType): string => message(`questionType.${type._tag}`);

export const warningMessage = (warning: PulseWarning): string => {
  switch (warning._tag) {
    case "TooManyQuestions":
      return message("pulse.warning.TooManyQuestions", warning);
    case "TooLong":
      return message("pulse.warning.TooLong", warning);
    case "NoOneTap":
      return message("pulse.warning.NoOneTap");
    case "TeamBelowMinimumGroupSize":
      return message("pulse.warning.TeamBelowMinimumGroupSize", warning);
  }
};

export const WEEKDAYS = () => Weekday.literals.map((day) => [day, message(`weekday.${day}`)] as const);
export const WINDOWS = () =>
  [1, 2, 3, 4, 5, 6].map((days) => [days, pluralMessage("pulse.settings.days", days)] as const);
export const REMINDERS = () =>
  [0, 1, 2].map((count) => [count, pluralMessage("pulse.settings.reminderCount", count)] as const);

export type Kind = QuestionType["_tag"];
export const KINDS = () =>
  (["Rating", "SingleChoice", "LongText"] as const).map(
    (kind) => [kind, message(`questionType.${kind}`)] as const,
  );
export const DIMENSIONS = () => [
  ["none", message("dimension.none")] as const,
  ...Dimension.literals.map((dimension) => [dimension, message(`dimension.${dimension}`)] as const),
];

export const decodeSettings = Schema.decodeUnknownOption(PulseSettings);
export const decodeContent = Schema.decodeUnknownOption(QuestionContent);

export const pulsesScreenView = <Message>(
  state: {
    readonly teamId: TeamId;
    readonly pulses: LoadedPulses;
    readonly createBusy: boolean;
    readonly createFailure?: Failure | undefined;
  },
  actions: {
    readonly onCreatePulse: Message;
  },
  h: HtmlBuilder<Message>,
): Html => {
  const children: Array<Child> = [
    h.a([h.Href(teamHref(state.teamId)), h.Class("text-sm underline")], [message("pulses.back")]),
  ];

  if (state.pulses._tag === "Failed") {
    children.push(problemView(state.pulses.failure, h)!);
    return h.section([h.Class("mt-6")], children);
  }

  if (state.pulses._tag !== "Loaded") {
    return h.section([h.Class("mt-6")], children);
  }

  const { pulses } = state.pulses;
  children.push(
    h.h2([h.Class("mt-2 text-xl font-semibold")], [message("pulses.title", { team: pulses.team.name })]),
  );

  if (pulses.pulses.length === 0) {
    children.push(h.p([h.Class("mt-2 text-gray-600")], [message("pulses.empty")]));
  } else {
    children.push(
      h.ul(
        [h.Class("mt-3 flex flex-col gap-2")],
        pulses.pulses.map((pulse) =>
          h.li(
            [],
            [
              h.a(
                [
                  h.Href(pulseHref(state.teamId, pulse.id)),
                  h.Class("flex justify-between rounded border px-3 py-2"),
                ],
                [
                  h.span([], [pulse.name]),
                  h.span(
                    [h.Class("text-sm text-gray-600")],
                    [
                      message("pulses.summary", {
                        day: message(`weekday.${pulse.cadence.day}`),
                        time: pulse.cadence.time,
                        questions: pluralMessage("pulse.questionCount", pulse.questionCount),
                        seconds: pulse.estimatedSeconds,
                      }),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  children.push(h.p([h.Class("mt-6 text-sm text-gray-600")], [message("pulses.create.intro")]));
  if (state.createFailure) {
    children.push(problemView(state.createFailure, h)!);
  }
  children.push(
    appButton(
      {
        text: message("pulses.create.action"),
        isDisabled: state.createBusy,
        className: `mt-2 ${buttonClass}`,
        onClick: actions.onCreatePulse,
      },
      h,
    ),
  );

  return h.section([h.Class("mt-6")], children);
};

export const questionFormView = <Message>(
  config: {
    readonly title: string;
    readonly action: string;
    readonly text: string;
    readonly kind: Kind;
    readonly dimension: Dimension | "none";
    readonly lowLabel: string;
    readonly highLabel: string;
    readonly comment: boolean;
    readonly options: string;
    readonly busy: boolean;
    readonly failure?: Failure | undefined;
  },
  actions: {
    readonly onTextChange: (text: string) => Message;
    readonly onKindChange: (kind: string) => Message;
    readonly onDimensionChange: (dimension: string) => Message;
    readonly onLowLabelChange: (low: string) => Message;
    readonly onHighLabelChange: (high: string) => Message;
    readonly onCommentToggle: (comment: boolean) => Message;
    readonly onOptionsChange: (options: string) => Message;
    readonly onSubmit: Message;
  },
  h: HtmlBuilder<Message>,
): Html =>
  h.form(
    [h.Class("mt-4 flex flex-col gap-3 rounded border p-3"), h.OnSubmit(actions.onSubmit)],
    [
      h.h4([h.Class("font-medium")], [config.title]),
      textField(
        {
          id: "q-text",
          label: message("question.text"),
          value: config.text,
          isDisabled: config.busy,
          onInput: actions.onTextChange,
        },
        h,
      ),
      selectField(
        {
          id: "q-type",
          label: message("question.type"),
          value: config.kind,
          options: KINDS(),
          isDisabled: config.busy,
          onChange: actions.onKindChange,
        },
        h,
      ),
      config.kind === "Rating"
        ? h.div(
            [h.Class("flex flex-col gap-3")],
            [
              textField(
                {
                  id: "q-low-label",
                  label: message("question.lowLabel"),
                  value: config.lowLabel,
                  isDisabled: config.busy,
                  onInput: actions.onLowLabelChange,
                },
                h,
              ),
              textField(
                {
                  id: "q-high-label",
                  label: message("question.highLabel"),
                  value: config.highLabel,
                  isDisabled: config.busy,
                  onInput: actions.onHighLabelChange,
                },
                h,
              ),
              checkboxField(
                {
                  id: "q-comment",
                  label: message("question.comment"),
                  isChecked: config.comment,
                  isDisabled: config.busy,
                  onToggle: actions.onCommentToggle,
                },
                h,
              ),
            ],
          )
        : null,
      config.kind === "SingleChoice"
        ? textareaField(
            {
              id: "q-options",
              label: message("question.options"),
              value: config.options,
              isDisabled: config.busy,
              rows: 4,
              onInput: actions.onOptionsChange,
            },
            h,
          )
        : null,
      config.kind === "LongText"
        ? h.p([h.Class("text-sm text-gray-600")], [message("question.longText.help")])
        : null,
      selectField(
        {
          id: "q-dimension",
          label: message("question.dimension"),
          value: config.dimension,
          options: DIMENSIONS(),
          isDisabled: config.busy,
          onChange: actions.onDimensionChange,
        },
        h,
      ),
      problemView(config.failure, h),
      appButton(
        {
          text: config.action,
          type: "submit",
          isDisabled: config.busy,
        },
        h,
      ),
    ].filter(Predicate.isNotNull),
  );

export const pulseEditorView = <Message>(
  state: {
    readonly teamId: TeamId;
    readonly pulse: LoadedPulse;
    readonly actionBusy: boolean;
    readonly actionFailure?: Failure | undefined;
    readonly writingQuestion: boolean;
    readonly editingQuestionId: Option.Option<QuestionId>;
    readonly formText: string;
    readonly formKind: Kind;
    readonly formDimension: Dimension | "none";
    readonly formLowLabel: string;
    readonly formHighLabel: string;
    readonly formComment: boolean;
    readonly formOptions: string;
    readonly formBusy: boolean;
    readonly formFailure?: Failure | undefined;
    readonly settingsName: string;
    readonly settingsDay: Weekday;
    readonly settingsTime: string;
    readonly settingsWindow: number;
    readonly settingsReminders: number;
    readonly settingsSaved: boolean;
    readonly settingsBusy: boolean;
    readonly settingsFailure?: Failure | undefined;
  },
  actions: {
    readonly onMoveQuestion: (index: number, by: -1 | 1) => Message;
    readonly onToggleEditQuestion: (questionId: Option.Option<QuestionId>) => Message;
    readonly onRemoveQuestion: (questionId: QuestionId) => Message;
    readonly onAddFromTemplate: (key: TemplateQuestionKey) => Message;
    readonly onToggleWriting: (writing: boolean) => Message;
    readonly onFormTextChange: (text: string) => Message;
    readonly onFormKindChange: (kind: string) => Message;
    readonly onFormDimensionChange: (dim: string) => Message;
    readonly onFormLowLabelChange: (low: string) => Message;
    readonly onFormHighLabelChange: (high: string) => Message;
    readonly onFormCommentToggle: (comment: boolean) => Message;
    readonly onFormOptionsChange: (options: string) => Message;
    readonly onSubmitQuestionForm: (mode: "Add" | "Edit") => Message;
    readonly onSettingsNameChange: (name: string) => Message;
    readonly onSettingsDayChange: (day: string) => Message;
    readonly onSettingsTimeChange: (time: string) => Message;
    readonly onSettingsWindowChange: (days: string) => Message;
    readonly onSettingsRemindersChange: (reminders: string) => Message;
    readonly onSubmitSettings: Message;
  },
  h: HtmlBuilder<Message>,
): Html => {
  const children: Array<Child> = [
    h.a([h.Href(pulsesHref(state.teamId)), h.Class("text-sm underline")], [message("pulse.back")]),
  ];

  if (state.pulse._tag === "Failed") {
    children.push(problemView(state.pulse.failure, h)!);
    return h.section([h.Class("mt-6")], children);
  }

  if (state.pulse._tag !== "Loaded") {
    return h.section([h.Class("mt-6")], children);
  }

  const { detail } = state.pulse;
  children.push(h.h2([h.Class("mt-2 text-xl font-semibold")], [detail.settings.name]));
  children.push(h.p([h.Class("text-sm text-gray-600")], [detail.team.name]));
  children.push(
    h.p(
      [h.Role("status"), h.Class("mt-4")],
      [
        message("pulse.estimate", {
          questions: pluralMessage("pulse.questionCount", detail.questions.length),
          seconds: detail.estimatedSeconds,
        }),
      ],
    ),
  );

  // Warnings
  if (detail.warnings.length > 0) {
    children.push(
      h.ul(
        [h.Class("mt-2 flex flex-col gap-1")],
        detail.warnings.map((warning) =>
          h.li([h.Class("rounded bg-amber-50 px-3 py-2 text-sm text-amber-900")], [warningMessage(warning)]),
        ),
      ),
    );
  }

  // Questions
  children.push(h.h3([h.Class("mt-6 text-lg font-medium")], [message("pulse.questions")]));
  const orderLength = detail.questions.length;
  children.push(
    h.ol(
      [h.Class("mt-2 flex flex-col gap-2")],
      detail.questions.map((question, index) => {
        const isEditing =
          Option.isSome(state.editingQuestionId) && state.editingQuestionId.value === question.questionId;
        return h.li(
          [h.Class("rounded border px-3 py-2")],
          [
            h.p([], [message("pulse.question.number", { number: index + 1 }), question.text]),
            h.p(
              [h.Class("text-sm text-gray-600")],
              [
                message("pulse.question.meta", {
                  type: typeName(question.type),
                  dimension: dimensionName(question.dimension),
                  seconds: question.estimatedSeconds,
                }),
              ],
            ),
            h.div(
              [h.Class("mt-1 flex gap-4")],
              [
                appButton(
                  {
                    text: message("pulse.question.up"),
                    isDisabled: state.actionBusy || index === 0,
                    className: linkButton,
                    onClick: actions.onMoveQuestion(index, -1),
                  },
                  h,
                ),
                appButton(
                  {
                    text: message("pulse.question.down"),
                    isDisabled: state.actionBusy || index === orderLength - 1,
                    className: linkButton,
                    onClick: actions.onMoveQuestion(index, 1),
                  },
                  h,
                ),
                question.hasAnswers
                  ? null
                  : appButton(
                      {
                        text: message("pulse.question.edit"),
                        isDisabled: state.actionBusy,
                        className: linkButton,
                        onClick: actions.onToggleEditQuestion(
                          isEditing ? Option.none() : Option.some(question.questionId),
                        ),
                      },
                      h,
                    ),
                appButton(
                  {
                    text: message("pulse.question.remove"),
                    isDisabled: state.actionBusy,
                    className: linkButton,
                    onClick: actions.onRemoveQuestion(question.questionId),
                  },
                  h,
                ),
              ].filter(Predicate.isNotNull),
            ),
            question.hasAnswers
              ? h.p([h.Class("text-sm text-gray-600")], [message("pulse.question.answered")])
              : null,
            isEditing
              ? questionFormView(
                  {
                    title: message("pulse.question.edit"),
                    action: message("pulse.question.save"),
                    text: state.formText,
                    kind: state.formKind,
                    dimension: state.formDimension,
                    lowLabel: state.formLowLabel,
                    highLabel: state.formHighLabel,
                    comment: state.formComment,
                    options: state.formOptions,
                    busy: state.formBusy,
                    failure: state.formFailure,
                  },
                  {
                    onTextChange: actions.onFormTextChange,
                    onKindChange: actions.onFormKindChange,
                    onDimensionChange: actions.onFormDimensionChange,
                    onLowLabelChange: actions.onFormLowLabelChange,
                    onHighLabelChange: actions.onFormHighLabelChange,
                    onCommentToggle: actions.onFormCommentToggle,
                    onOptionsChange: actions.onFormOptionsChange,
                    onSubmit: actions.onSubmitQuestionForm("Edit"),
                  },
                  h,
                )
              : null,
          ].filter(Predicate.isNotNull),
        );
      }),
    ),
  );

  // Template Questions
  if (detail.templateQuestions.length > 0) {
    children.push(h.h3([h.Class("mt-6 text-lg font-medium")], [message("pulse.template.title")]));
    children.push(
      h.ul(
        [h.Class("mt-2 flex flex-col gap-2")],
        detail.templateQuestions.map((templateQ) =>
          h.li(
            [h.Class("flex items-center justify-between rounded border px-3 py-2")],
            [
              h.span(
                [],
                [
                  templateQ.text,
                  h.span([h.Class("text-sm text-gray-600")], [dimensionName(templateQ.dimension)]),
                ],
              ),
              appButton(
                {
                  text: message("pulse.template.add"),
                  isDisabled: state.actionBusy,
                  className: linkButton,
                  onClick: actions.onAddFromTemplate(templateQ.key),
                },
                h,
              ),
            ],
          ),
        ),
      ),
    );
  }

  // Write a Question
  if (state.writingQuestion) {
    children.push(
      questionFormView(
        {
          title: message("pulse.write.title"),
          action: message("pulse.write.action"),
          text: state.formText,
          kind: state.formKind,
          dimension: state.formDimension,
          lowLabel: state.formLowLabel,
          highLabel: state.formHighLabel,
          comment: state.formComment,
          options: state.formOptions,
          busy: state.formBusy,
          failure: state.formFailure,
        },
        {
          onTextChange: actions.onFormTextChange,
          onKindChange: actions.onFormKindChange,
          onDimensionChange: actions.onFormDimensionChange,
          onLowLabelChange: actions.onFormLowLabelChange,
          onHighLabelChange: actions.onFormHighLabelChange,
          onCommentToggle: actions.onFormCommentToggle,
          onOptionsChange: actions.onFormOptionsChange,
          onSubmit: actions.onSubmitQuestionForm("Add"),
        },
        h,
      ),
    );
  } else {
    children.push(
      appButton(
        {
          text: message("pulse.write.title"),
          className: `mt-4 ${buttonClass}`,
          onClick: actions.onToggleWriting(true),
        },
        h,
      ),
    );
  }

  // Settings form
  children.push(
    h.form(
      [h.Class("mt-4 flex flex-col gap-3"), h.OnSubmit(actions.onSubmitSettings)],
      [
        h.h3([h.Class("text-lg font-medium")], [message("pulse.settings.title")]),
        textField(
          {
            id: "pulse-setting-name",
            label: message("pulse.settings.name"),
            value: state.settingsName,
            isDisabled: state.settingsBusy,
            onInput: actions.onSettingsNameChange,
          },
          h,
        ),
        selectField(
          {
            id: "pulse-setting-day",
            label: message("pulse.settings.day"),
            value: state.settingsDay,
            options: WEEKDAYS(),
            isDisabled: state.settingsBusy,
            onChange: actions.onSettingsDayChange,
          },
          h,
        ),
        textField(
          {
            id: "pulse-setting-time",
            label: message("pulse.settings.time"),
            value: state.settingsTime,
            type: "time",
            isDisabled: state.settingsBusy,
            onInput: actions.onSettingsTimeChange,
          },
          h,
        ),
        h.p([h.Class("text-sm text-gray-600")], [message("pulse.settings.time.help")]),
        selectField(
          {
            id: "pulse-setting-window",
            label: message("pulse.settings.answerWindow"),
            value: state.settingsWindow,
            options: WINDOWS(),
            isDisabled: state.settingsBusy,
            onChange: actions.onSettingsWindowChange,
          },
          h,
        ),
        selectField(
          {
            id: "pulse-setting-reminders",
            label: message("pulse.settings.reminders"),
            value: state.settingsReminders,
            options: REMINDERS(),
            isDisabled: state.settingsBusy,
            onChange: actions.onSettingsRemindersChange,
          },
          h,
        ),
        h.p([h.Class("text-sm text-gray-600")], [message("pulse.settings.anonymous")]),
        h.p([h.Class("text-sm text-gray-600")], [message("pulse.settings.invitation")]),
        problemView(state.settingsFailure, h),
        state.settingsSaved ? h.p([h.Role("status")], [message("pulse.settings.saved")]) : null,
        appButton(
          {
            text: message("pulse.settings.save"),
            type: "submit",
            isDisabled: state.settingsBusy,
          },
          h,
        ),
      ].filter(Predicate.isNotNull),
    ),
  );

  return h.section([h.Class("mt-6")], children);
};
