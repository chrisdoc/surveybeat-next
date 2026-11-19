import {
  Dimension,
  minutes,
  Policy,
  PulseDetail,
  PulseList,
  PulseSettings,
  QuestionContent,
  SendId,
  TestSendStatus,
  Weekday,
} from "@surveybeat/domain";
import type {
  TemplateQuestionKey,
  FailureReason,
  PulseWarning,
  QuestionId,
  QuestionType,
  TeamId,
} from "@surveybeat/domain";
import { Duration, Option, Predicate, Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";
import { formatDuration, formatNumber, formatRoundDate, message, pluralMessage } from "../messages/locale.ts";
import { Failure } from "./api.ts";
import {
  appButton,
  badge,
  buttonClass,
  checkboxField,
  emptyState,
  dangerLinkButton,
  linkButton,
  pageTitle,
  problemView,
  secondaryButtonClass,
  selectField,
  subSectionTitle,
  textField,
  textareaField,
  breadcrumbs,
  linkClass,
} from "./components.ts";
import type { Child } from "./components.ts";
import { pulseHref, roundsHref, teamHref } from "./routes.ts";

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

export const TestSendResult = Schema.Union([
  Schema.TaggedStruct("Sent", {
    email: Schema.String,
    sendId: SendId,
    status: Schema.optionalKey(TestSendStatus),
    statusUnavailable: Schema.Boolean,
  }),
  Schema.TaggedStruct("Failed", { failure: Failure }),
]);

export type TestSendResult = typeof TestSendResult.Type;

export const TEST_SEND_POLL_INTERVAL = Duration.seconds(Policy.testSend.pollSeconds);

export const TEST_SEND_STALLED_MILLIS = minutes(Policy.testSend.stalledMinutes);

export const TEST_SEND_GIVE_UP_MILLIS = minutes(Policy.testSend.giveUpMinutes);

export const testSendKeepsPolling = (status: TestSendStatus): boolean =>
  (status.state._tag === "Queued" || status.state._tag === "Sending") &&
  status.checkedAt - status.queuedAt < TEST_SEND_GIVE_UP_MILLIS;

export type TestSendNotice =
  | { readonly _tag: "Queued" }
  | { readonly _tag: "Retrying"; readonly code: string }
  | { readonly _tag: "Stalled"; readonly minutes: number }
  | { readonly _tag: "Sending" }
  | { readonly _tag: "Sent" }
  | { readonly _tag: "Failed"; readonly reason: FailureReason; readonly code: string | null };

export const testSendNotice = (status: TestSendStatus): TestSendNotice => {
  const { state } = status;

  switch (state._tag) {
    case "Queued": {
      const waited = status.checkedAt - status.queuedAt;

      if (waited >= TEST_SEND_STALLED_MILLIS) {
        return { _tag: "Stalled", minutes: Math.floor(waited / 60_000) };
      }

      return state.lastCode === null ? { _tag: "Queued" } : { _tag: "Retrying", code: state.lastCode };
    }

    case "Sending": {
      return { _tag: "Sending" };
    }

    case "Sent": {
      return { _tag: "Sent" };
    }

    case "Failed": {
      return { _tag: "Failed", reason: state.reason, code: state.code };
    }
  }
};

export const failureReasonText = (reason: FailureReason): string => {
  switch (reason) {
    case "unknown": {
      return message("email.reason.unknown");
    }

    case "rejected": {
      return message("email.reason.rejected");
    }

    case "abandoned": {
      return message("email.reason.abandoned");
    }

    case "bounced": {
      return message("email.reason.bounced");
    }

    case "complained": {
      return message("email.reason.complained");
    }
  }
};

export const testSendNoticeText = (notice: TestSendNotice): string => {
  switch (notice._tag) {
    case "Queued": {
      return message("pulse.test.status.queued");
    }

    case "Retrying": {
      return message("pulse.test.status.retrying", { code: notice.code });
    }

    case "Stalled": {
      return pluralMessage("pulse.test.status.stalled", notice.minutes);
    }

    case "Sending": {
      return message("pulse.test.status.sending");
    }

    case "Sent": {
      return message("pulse.test.status.sent");
    }

    case "Failed": {
      return notice.code === null
        ? message("pulse.test.status.failed", { reason: failureReasonText(notice.reason) })
        : message("pulse.test.status.failedCode", {
            reason: failureReasonText(notice.reason),
            code: notice.code,
          });
    }
  }
};

export const dimensionName = (dimension: Dimension | null): string =>
  dimension === null ? message("dimension.none") : message(`dimension.${dimension}`);

export const typeName = (type: QuestionType): string => message(`questionType.${type._tag}`);

export const warningMessage = (warning: PulseWarning): string => {
  switch (warning._tag) {
    case "TooManyQuestions": {
      return message("pulse.warning.TooManyQuestions", warning);
    }

    case "TooLong": {
      return message("pulse.warning.TooLong", warning);
    }

    case "NoOneTap": {
      return message("pulse.warning.NoOneTap");
    }

    case "TeamBelowMinimumGroupSize": {
      return pluralMessage("pulse.warning.TeamBelowMinimumGroupSize", warning.members, {
        minimumGroupSize: warning.minimumGroupSize,
      });
    }
  }
};

export const WEEKDAYS = () => Weekday.literals.map((day) => [day, message(`weekday.${day}`)] as const);

export const WINDOWS = () =>
  [1, 2, 3, 4, 5, 6].map((days) => [days, pluralMessage("pulse.settings.days", days)] as const);

export const REMINDERS = () =>
  [0, 1, 2].map((count) => [count, pluralMessage("pulse.settings.reminderCount", count)] as const);

export const REVIEW_WINDOWS = () =>
  [0, 1, 2, 3, 4, 5, 6, 7].map(
    (days) =>
      [
        days,
        days === 0 ? message("pulse.settings.reviewWindow.none") : pluralMessage("pulse.settings.days", days),
      ] as const,
  );

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
  const children: Child[] = [
    h.a([h.Href(teamHref(state.teamId)), h.Class(linkClass)], [message("pulses.back")]),
  ];

  if (state.pulses._tag === "Failed") {
    children.push(problemView(state.pulses.failure, h));

    return h.section([], children);
  }

  if (state.pulses._tag !== "Loaded") {
    return h.section([], children);
  }

  const { pulses } = state.pulses;
  children.push(
    h.div([h.Class("mt-4")], [pageTitle(message("pulses.title", { team: pulses.team.name }), h)]),
  );

  if (pulses.pulses.length === 0) {
    children.push(emptyState({ title: message("pulses.empty.title"), body: message("pulses.empty") }, h));
  } else {
    children.push(
      h.ul(
        [h.Class("mt-6 flex flex-col gap-3")],
        pulses.pulses.map((pulse) =>
          h.keyed("li")(
            pulse.id,
            [],
            [
              h.a(
                [
                  h.Href(pulseHref(state.teamId, pulse.id)),
                  h.Class(
                    "flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-panel border border-line bg-surface px-6 py-4 font-semibold hover:border-primary",
                  ),
                ],
                [
                  h.span(
                    [h.Class("flex min-w-0 flex-wrap items-center gap-2")],
                    [
                      h.span([h.Class("min-w-0 break-words")], [pulse.name]),
                      pulse.paused === true ? badge("neutral", [message("pulses.paused")], h) : null,
                    ].filter(Predicate.isNotNull),
                  ),
                  h.span(
                    [h.Class("flex flex-col gap-1 text-sm font-normal text-muted sm:items-end")],
                    [
                      h.span(
                        [],
                        [
                          message("pulses.summary", {
                            day: message(`weekday.${pulse.cadence.day}`),
                            time: pulse.cadence.time,
                            questions: pluralMessage("pulse.questionCount", pulse.questionCount),
                            duration: formatDuration(pulse.estimatedSeconds),
                          }),
                        ],
                      ),
                      pulse.nextRoundDate === undefined
                        ? null
                        : h.span(
                            [],
                            [
                              pulse.nextRoundDate === null
                                ? message("pulses.noRound")
                                : message("pulses.nextRound", { date: formatRoundDate(pulse.nextRoundDate) }),
                            ],
                          ),
                    ].filter(Predicate.isNotNull),
                  ),
                  h.span([h.AriaHidden(true), h.Class("text-xl text-muted")], ["›"]),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  children.push(h.p([h.Class("mt-8 text-muted")], [message("pulses.create.intro")]));

  if (state.createFailure) {
    children.push(problemView(state.createFailure, h));
  }

  children.push(
    appButton(
      {
        text: message("pulses.create.action"),
        isDisabled: state.createBusy,
        className: `mt-3 ${buttonClass}`,
        onClick: actions.onCreatePulse,
      },
      h,
    ),
  );

  return h.section([], children);
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
    [
      h.Class("mt-4 flex flex-col gap-4 rounded-panel border border-line bg-subtle p-6"),
      h.OnSubmit(actions.onSubmit),
    ],
    [
      subSectionTitle(config.title, h, 3),
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
        ? h.p(
            [h.Class("text-sm text-muted")],
            [message("question.longText.help", { max: formatNumber(Policy.text.longTextMaxLength) })],
          )
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

const testSendStatusView = <Message>(
  result: Extract<TestSendResult, { readonly _tag: "Sent" }>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class("flex flex-col gap-1 text-sm text-muted")],
    [
      h.p(
        [h.Role("status")],
        [
          result.status === undefined
            ? message("pulse.test.status.queued")
            : testSendNoticeText(testSendNotice(result.status)),
        ],
      ),
      result.statusUnavailable ? h.p([], [message("pulse.test.status.unavailable")]) : null,
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
    readonly settingsReviewWindow: number;
    readonly settingsReminders: number;
    readonly settingsSaved: boolean;
    readonly settingsBusy: boolean;
    readonly settingsFailure?: Failure | undefined;
    readonly testSendBusy: boolean;
    readonly testSendResult?: TestSendResult | undefined;
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
    readonly onSettingsReviewWindowChange: (days: string) => Message;
    readonly onSettingsRemindersChange: (reminders: string) => Message;
    readonly onSubmitSettings: Message;
    readonly onSendTest: Message;
  },
  h: HtmlBuilder<Message>,
): Html => {
  const pulse = state.pulse._tag === "Loaded" ? state.pulse.detail : undefined;

  const children: Child[] = [
    breadcrumbs(
      [
        { label: pulse?.team.name ?? message("title.team"), href: teamHref(state.teamId) },
        { label: pulse?.settings.name ?? message("title.pulse") },
      ],
      h,
    ),
  ];

  if (state.pulse._tag === "Failed") {
    children.push(problemView(state.pulse.failure, h));

    return h.section([], children);
  }

  if (state.pulse._tag !== "Loaded") {
    return h.section([], children);
  }

  const { detail } = state.pulse;
  children.push(
    h.div([h.Class("mt-4")], [pageTitle(detail.settings.name, h)]),
    h.p([h.Class("mt-2 text-muted")], [detail.team.name]),
  );

  if (detail.team.yourRole === "lead") {
    const tabClass = "inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold";
    children.push(
      h.nav(
        [h.Class("mt-4 flex gap-1 border-b border-line")],
        [
          h.a(
            [
              h.Href(pulseHref(state.teamId, detail.id)),
              h.AriaCurrent("page"),
              h.Class(`${tabClass} border-primary text-ink`),
            ],
            [message("pulse.tabs.pulse")],
          ),
          h.a(
            [
              h.Href(roundsHref(state.teamId, detail.id)),
              h.Class(`${tabClass} border-transparent text-muted hover:text-ink`),
            ],
            [message("pulse.tabs.rounds")],
          ),
        ],
      ),
    );
  }

  children.push(
    h.p(
      [h.Role("status"), h.Class("mt-4 font-medium")],
      [
        message("pulse.estimate", {
          questions: pluralMessage("pulse.questionCount", detail.questions.length),
          duration: formatDuration(detail.estimatedSeconds),
        }),
      ],
    ),
  );

  if (detail.warnings.length > 0) {
    children.push(
      h.ul(
        [h.Class("mt-3 flex flex-col gap-2")],
        detail.warnings.map((warning) =>
          h.li(
            [h.Class("rounded-control bg-brass-soft px-4 py-3 text-sm text-brass")],
            [warningMessage(warning)],
          ),
        ),
      ),
    );
  }

  children.push(h.div([h.Class("mt-8")], [subSectionTitle(message("pulse.questions"), h, 2)]));
  const orderLength = detail.questions.length;
  children.push(
    h.ol(
      [h.Class("mt-3 flex flex-col gap-3")],
      detail.questions.map((question, index) => {
        const isEditing =
          Option.isSome(state.editingQuestionId) && state.editingQuestionId.value === question.questionId;

        return h.li(
          [h.Class("rounded-panel border border-line bg-surface px-6 py-4")],
          [
            h.p(
              [h.Class("font-medium")],
              [message("pulse.question.numbered", { number: index + 1, text: question.text })],
            ),
            h.p(
              [h.Class("text-sm text-muted")],
              [
                message("pulse.question.meta", {
                  type: typeName(question.type),
                  dimension: dimensionName(question.dimension),
                  duration: formatDuration(question.estimatedSeconds),
                }),
              ],
            ),
            h.div(
              [h.Class("mt-1 flex flex-wrap gap-x-4")],
              [
                appButton(
                  {
                    text: message("pulse.question.up"),
                    icon: "↑",
                    isDisabled: state.actionBusy || index === 0,
                    className: linkButton,
                    onClick: actions.onMoveQuestion(index, -1),
                  },
                  h,
                ),
                appButton(
                  {
                    text: message("pulse.question.down"),
                    icon: "↓",
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
                        icon: "✎",
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
                    icon: "✕",
                    isDisabled: state.actionBusy,
                    className: dangerLinkButton,
                    onClick: actions.onRemoveQuestion(question.questionId),
                  },
                  h,
                ),
              ].filter(Predicate.isNotNull),
            ),
            question.hasAnswers
              ? h.p([h.Class("text-sm text-muted")], [message("pulse.question.answered")])
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

  if (detail.templateQuestions.length > 0) {
    children.push(
      h.div([h.Class("mt-8")], [subSectionTitle(message("pulse.template.title"), h, 2)]),
      h.ul(
        [h.Class("mt-3 flex flex-col gap-3")],
        detail.templateQuestions.map((templateQ) =>
          h.li(
            [
              h.Class(
                "flex items-center justify-between gap-4 rounded-panel border border-line bg-surface px-6 py-3",
              ),
            ],
            [
              h.span(
                [h.Class("flex flex-col")],
                [
                  templateQ.text,
                  h.span([h.Class("text-sm text-muted")], [dimensionName(templateQ.dimension)]),
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
          className: `mt-6 ${secondaryButtonClass}`,
          onClick: actions.onToggleWriting(true),
        },
        h,
      ),
    );
  }

  children.push(
    h.div(
      [h.Class("mt-8 flex flex-col gap-3")],
      [
        appButton(
          {
            text: message("pulse.test.send"),
            isDisabled: state.testSendBusy,
            className: secondaryButtonClass,
            onClick: actions.onSendTest,
          },
          h,
        ),
        h.p([h.Class("text-sm text-muted")], [message("pulse.test.help")]),
        state.testSendResult?._tag === "Sent"
          ? h.p(
              [h.Role("status"), h.Class("text-sm font-medium text-primary")],
              [message("pulse.test.sent", { email: state.testSendResult.email })],
            )
          : null,
        state.testSendResult?._tag === "Sent" ? testSendStatusView(state.testSendResult, h) : null,
        state.testSendResult?._tag === "Failed" ? problemView(state.testSendResult.failure, h) : null,
      ].filter(Predicate.isNotNull),
    ),
    h.form(
      [
        h.Class("mt-8 flex flex-col gap-4 rounded-panel border border-line bg-surface p-6 sm:p-8"),
        h.OnSubmit(actions.onSubmitSettings),
      ],
      [
        subSectionTitle(message("pulse.settings.title"), h, 2),
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
        h.p(
          [h.Class("text-sm text-muted")],
          [
            message("pulse.settings.time.help", {
              earliest: Policy.sendWindow.earliest,
              latest: Policy.sendWindow.latest,
            }),
          ],
        ),
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
        selectField(
          {
            id: "pulse-setting-review-window",
            label: message("pulse.settings.reviewWindow"),
            value: state.settingsReviewWindow,
            options: REVIEW_WINDOWS(),
            isDisabled: state.settingsBusy,
            onChange: actions.onSettingsReviewWindowChange,
          },
          h,
        ),
        h.p([h.Class("text-sm text-muted")], [message("pulse.settings.reviewWindow.help")]),
        h.p([h.Class("text-sm text-muted")], [message("pulse.settings.anonymous")]),
        h.p([h.Class("text-sm text-muted")], [message("pulse.settings.invitation")]),
        problemView(state.settingsFailure, h),
        state.settingsSaved
          ? h.p(
              [h.Role("status"), h.Class("text-sm font-medium text-primary")],
              [message("pulse.settings.saved")],
            )
          : null,
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

  return h.section([], children);
};
