import * as DateTime from "effect/DateTime";
import { ActionItem, Dimension, PersonId, RoundNote, RoundResult } from "@surveybeat/domain";
import type { ActionId, ActionStatus, DimensionResult, QuestionResult } from "@surveybeat/domain";
import { Option, Predicate, Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";
import { formatDate, formatPercent, formatRoundDate, message, pluralMessage } from "../messages/locale.ts";
import { Failure, failureMessage } from "./api.ts";
import {
  trendTitle,
  trendChart,
  trendTable,
  distributionChart,
  distributionTable,
  protectionLine,
  highlightBadge,
  changeView,
  baselineNote,
  scoreView,
  scoreOfFive,
  countdown,
  resultsLayout,
  toggleButton,
  discussionGuideText,
  discussionGuideView,
  themesSection,
  noteSection,
} from "./resultsSections.ts";
import { resultsSummary } from "./resultsSummary.ts";
import {
  alertView,
  appButton,
  badge,
  darkOutlineButtonClass,
  darkPanel,
  mintButtonClass,
  pageTitle,
  panel,
  problemView,
  confirmDialog,
  sectionTitle,
  selectField,
  subSectionTitle,
  textField,
  breadcrumbs,
  loadingView,
} from "./components.ts";
import type { LoadedTeam } from "./directory.ts";
import { dimensionName } from "./pulses.ts";
import { teamHref } from "./routes.ts";

export {
  trendTitle,
  trendChart,
  trendTable,
  distributionChart,
  distributionTable,
  toggleButton,
  discussionGuideText,
};

export const LoadedResults = defineTaggedUnion({
  Loading: {},
  Loaded: { result: RoundResult },
  Failed: { failure: Failure },
});

export type LoadedResults = typeof LoadedResults.Type;

export const LoadedActions = defineTaggedUnion({
  Loading: {},
  Loaded: { actions: Schema.Array(ActionItem) },
  Failed: { failure: Failure },
});

export type LoadedActions = typeof LoadedActions.Type;

export const LoadedNote = defineTaggedUnion({
  Loading: {},
  Loaded: { note: Schema.NullOr(RoundNote) },
  Failed: { failure: Failure },
});

export type LoadedNote = typeof LoadedNote.Type;

const smallHeading = "text-xs font-semibold tracking-[0.04em] text-muted uppercase";

export const GuideCopy = Schema.Literals(["idle", "copied", "failed"]);

export type GuideCopy = typeof GuideCopy.Type;

export const resultsScreenView = <Message>(
  state: {
    readonly results: LoadedResults;
    readonly actions: LoadedActions;
    readonly roundNote: LoadedNote;
    readonly noteDraft: string;
    readonly noteEditing: boolean;
    readonly noteBusy: boolean;
    readonly noteFailure: Option.Option<Failure>;
    readonly teamDetail: LoadedTeam;
    readonly showTable: Record<string, boolean>;
    readonly guideCopy: GuideCopy;
    readonly actionTitle: string;
    readonly actionOwnerId: Option.Option<PersonId>;
    readonly actionDueDate: string;
    readonly actionDimension: Dimension | "none";
    readonly actionBusy: boolean;
    readonly actionFailure: Option.Option<Failure>;
    readonly actionFormOpen: boolean;
    readonly pendingDropId: ActionId | undefined;
    readonly shareBusy: boolean;
    readonly shareFailure: Option.Option<Failure>;
    readonly retryBusy: boolean;
    readonly retryFailure: Option.Option<Failure>;
  },
  callbacks: {
    readonly onToggleTable: (key: string) => Message;
    readonly onCopyGuide: (text: string) => Message;
    readonly onShareResults: Message;
    readonly onRetryResult: Message;
    readonly onActionTitleChange: (title: string) => Message;
    readonly onActionOwnerChange: (personId: string) => Message;
    readonly onActionDueDateChange: (date: string) => Message;
    readonly onActionDimensionChange: (dim: string) => Message;
    readonly onSubmitAction: Message;
    readonly onToggleActionForm: Message;
    readonly onAskDrop: (actionId: ActionId) => Message;
    readonly onConfirmDrop: Message;
    readonly onCancelDrop: Message;
    readonly onUpdateActionStatus: (actionId: ActionId, status: ActionStatus) => Message;
    readonly onNoteEdit: Message;
    readonly onNoteDraftChange: (text: string) => Message;
    readonly onNoteCancel: Message;
    readonly onSubmitNote: Message;
  },
  h: HtmlBuilder<Message>,
): Html => {
  if (state.results._tag === "Loading") {
    return loadingView(h, "results");
  }

  if (state.results._tag === "Failed") {
    return alertView(failureMessage(state.results.failure), h);
  }

  const result = state.results.result;
  const minimum = result.effectiveMinimumGroupSize;
  const isLead = state.teamDetail._tag === "Loaded" && state.teamDetail.detail.team.yourRole === "lead";
  const roster = state.teamDetail._tag === "Loaded" ? state.teamDetail.detail.roster : [];

  const reviewDate =
    result.reviewEndsAt !== undefined ? formatDate(DateTime.makeUnsafe(result.reviewEndsAt)) : null;

  const isMemberReview =
    (result.status === "closed" || result.status === "ready") &&
    !result.delayed &&
    result.questions.length === 0;

  const teamName =
    state.teamDetail._tag === "Loaded" ? state.teamDetail.detail.team.name : message("title.team");

  const children: Html[] = [
    breadcrumbs(
      [
        { label: teamName, href: teamHref(result.teamId) },
        ...(result.pulseName === undefined ? [] : [{ label: result.pulseName }]),
        { label: message("results.roundDate", { date: formatRoundDate(result.plannedOpenDate) }) },
      ],
      h,
    ),
    h.div([h.Class("mt-1")], [pageTitle(message("results.title"), h)]),
    h.p(
      [h.Class("-mt-2 text-muted")],
      [
        result.pulseName === undefined
          ? teamName
          : message("results.subtitle", { team: teamName, pulse: result.pulseName }),
      ],
    ),
  ];

  if (isLead && result.status === "ready") {
    children.push(
      panel(
        [
          h.h2([h.Class("text-base font-semibold")], [message("results.review.leadTitle")]),
          reviewDate !== null
            ? h.p(
                [h.Class("mt-1 text-sm text-muted")],
                [message("results.review.leadBody", { date: reviewDate })],
              )
            : null,
          countdown(result.reviewEndsAt) === null
            ? null
            : h.p(
                [h.Class("mt-1 text-sm font-semibold")],
                [pluralMessage("results.review.countdown", countdown(result.reviewEndsAt) ?? 0)],
              ),
          h.div(
            [h.Class("mt-4 flex flex-wrap items-center gap-3")],
            [
              appButton(
                {
                  text: state.shareBusy ? message("results.review.sharing") : message("results.review.share"),
                  onClick: callbacks.onShareResults,
                  isDisabled: state.shareBusy,
                },
                h,
              ),
            ],
          ),
          problemView(Option.getOrUndefined(state.shareFailure), h),
        ].filter(Predicate.isNotNull),
        h,
      ),
    );
  }

  const summary = isMemberReview ? null : resultsSummary(result);

  if (summary !== null) {
    children.push(
      h.p(
        [
          h.Class(
            "max-w-none rounded-panel border border-line border-l-4 border-l-primary bg-surface px-5 py-4 font-display text-[19px] leading-[1.4] font-medium tracking-[-0.01em] text-ink shadow-card sm:text-[21px]",
          ),
        ],
        [summary],
      ),
    );
  }

  if (result.couldNotCompute === true) {
    children.push(
      panel(
        [
          h.h2([h.Class("text-base font-semibold")], [message("results.failed.title")]),
          h.div(
            [h.Class("mt-4 flex flex-wrap items-center gap-3")],
            [
              appButton(
                {
                  text: state.retryBusy
                    ? message("results.failed.retrying")
                    : message("results.failed.retry"),
                  onClick: callbacks.onRetryResult,
                  isDisabled: state.retryBusy,
                },
                h,
              ),
            ],
          ),
          problemView(Option.getOrUndefined(state.retryFailure), h),
        ].filter(Predicate.isNotNull),
        h,
      ),
    );

    return resultsLayout(children, result, h);
  } else if (result.delayed) {
    children.push(
      h.div(
        [h.Role("alert"), h.Class("rounded-control border border-line bg-surface p-4")],
        [
          h.h2([h.Class("font-semibold")], [message("results.delayedTitle")]),
          h.p([h.Class("mt-1 text-sm text-muted")], [message("results.delayedBody")]),
        ],
      ),
    );
  }

  const noteNode = noteSection(
    state,
    {
      onNoteEdit: callbacks.onNoteEdit,
      onNoteDraftChange: callbacks.onNoteDraftChange,
      onNoteCancel: callbacks.onNoteCancel,
      onSubmitNote: callbacks.onSubmitNote,
    },
    isLead,
    h,
  );

  if (noteNode !== null && result.status !== "open" && !isMemberReview) {
    children.push(noteNode);
  }

  const actionsItems: Html[] = [];

  if (state.actions._tag === "Loading") {
    actionsItems.push(h.p([h.Class("text-sm text-mint-text")], [message("app.loading")]));
  } else if (state.actions._tag === "Failed") {
    actionsItems.push(alertView(failureMessage(state.actions.failure), h));
  } else {
    const list = state.actions.actions;

    if (list.length === 0) {
      actionsItems.push(h.p([h.Class("text-sm text-mint-text italic")], [message("actions.empty")]));
    } else {
      actionsItems.push(
        h.ul(
          [h.Class("flex flex-col gap-3")],
          list.map((action) => {
            const statusLabel =
              action.status === "committed"
                ? message("actions.statusCommitted")
                : action.status === "done"
                  ? message("actions.statusDone")
                  : message("actions.statusDropped");

            const buttons: Html[] = [];

            if (isLead) {
              if (action.status === "committed") {
                buttons.push(
                  appButton(
                    {
                      text: message("actions.markDone"),
                      onClick: callbacks.onUpdateActionStatus(action.id, "done"),
                      className: mintButtonClass,
                    },
                    h,
                  ),
                  appButton(
                    {
                      text: message("actions.drop"),
                      onClick: callbacks.onAskDrop(action.id),
                      className: darkOutlineButtonClass,
                    },
                    h,
                  ),
                );
              } else {
                buttons.push(
                  appButton(
                    {
                      text: message("actions.reopen"),
                      onClick: callbacks.onUpdateActionStatus(action.id, "committed"),
                      className: darkOutlineButtonClass,
                    },
                    h,
                  ),
                );
              }
            }

            return h.keyed("li")(
              action.id,
              [h.Class("flex flex-col gap-2 rounded-control bg-evergreen-raised p-4")],
              [
                h.div(
                  [h.Class("flex flex-wrap items-start justify-between gap-4")],
                  [
                    h.div(
                      [h.Class("flex flex-col gap-1")],
                      [
                        h.h3([h.Class("text-base font-semibold")], [action.title]),
                        h.div(
                          [h.Class("flex flex-wrap items-center gap-3 text-sm text-mint-text")],
                          [
                            action.ownerEmail === null
                              ? h.span(
                                  [],
                                  [message("actions.ownerLabel", { owner: message("actions.formerMember") })],
                                )
                              : action.ownerEmail.trim() !== ""
                                ? h.span([], [message("actions.ownerLabel", { owner: action.ownerEmail })])
                                : null,
                            action.dueDate !== null
                              ? h.span(
                                  [],
                                  [message("actions.dueLabel", { date: formatRoundDate(action.dueDate) })],
                                )
                              : null,
                            action.dimension !== null
                              ? badge("neutral", [dimensionName(action.dimension)], h)
                              : null,
                          ].filter(Predicate.isNotNull),
                        ),
                      ],
                    ),
                    h.div(
                      [h.Class("flex flex-col gap-2")],
                      [
                        h.div(
                          [h.Class("flex flex-wrap items-center gap-2")],
                          [
                            badge(action.status === "committed" ? "primary" : "neutral", [statusLabel], h),
                            ...buttons,
                          ],
                        ),
                        state.pendingDropId === action.id
                          ? confirmDialog(
                              {
                                title: message("actions.drop"),
                                body: message("confirm.dropBody"),
                                confirmText: message("actions.drop"),
                                cancelText: message("confirm.cancel"),
                                isBusy: state.actionBusy,
                                onConfirm: callbacks.onConfirmDrop,
                                onCancel: callbacks.onCancelDrop,
                              },
                              h,
                            )
                          : null,
                      ],
                    ),
                  ],
                ),
              ],
            );
          }),
        ),
      );
    }
  }

  let commitForm: Html = null;

  if (isLead) {
    const firstPerson = roster[0];

    const selectedOwner = Option.getOrElse(state.actionOwnerId, () =>
      firstPerson !== undefined ? firstPerson.personId : PersonId.make(""),
    );

    const dimensionOptions: readonly (readonly [string, string])[] = [
      ["none", message("actions.none")],
      ...Dimension.literals.map((dim): readonly [string, string] => [dim, dimensionName(dim)]),
    ];

    const rosterOptions: readonly (readonly [string, string])[] = roster.map((m) => [m.personId, m.email]);

    commitForm = h.form(
      [h.Class("mt-6 flex flex-col gap-4"), h.OnSubmit(callbacks.onSubmitAction)],
      [
        h.h3([h.Class("text-[19px] font-semibold")], [message("actions.commitTitle")]),
        textField(
          {
            id: "action-title",
            label: message("actions.inputTitle"),
            value: state.actionTitle,
            onInput: callbacks.onActionTitleChange,
            isDisabled: state.actionBusy,
          },
          h,
        ),
        h.div(
          [h.Class("grid grid-cols-1 gap-3 sm:grid-cols-3")],
          [
            selectField(
              {
                id: "action-owner",
                label: message("actions.owner"),
                value: selectedOwner,
                options: rosterOptions,
                onChange: callbacks.onActionOwnerChange,
                isDisabled: state.actionBusy,
              },
              h,
            ),
            textField(
              {
                id: "action-due-date",
                label: message("actions.dueDate"),
                value: state.actionDueDate,
                type: "text",
                onInput: callbacks.onActionDueDateChange,
                isDisabled: state.actionBusy,
              },
              h,
            ),
            selectField(
              {
                id: "action-dimension",
                label: message("actions.dimension"),
                value: state.actionDimension,
                options: dimensionOptions,
                onChange: callbacks.onActionDimensionChange,
                isDisabled: state.actionBusy,
              },
              h,
            ),
          ],
        ),
        problemView(Option.getOrUndefined(state.actionFailure), h),
        h.div(
          [h.Class("flex justify-end")],
          [
            appButton(
              {
                text: message("actions.submit"),
                type: "submit",
                isDisabled: state.actionBusy || state.actionTitle.trim() === "",
                className: mintButtonClass,
              },
              h,
            ),
          ],
        ),
      ].filter(Predicate.isNotNull),
    );
  }

  const actionsNode = h.section(
    [h.Class("mt-6")],
    [
      darkPanel(
        [
          sectionTitle(message("actions.title"), h, "onDark"),
          h.p([h.Class("mt-2 text-mint-text")], [message("actions.intro")]),
          h.div(
            [h.Class("mt-6 flex flex-col gap-4")],
            [
              ...actionsItems,
              isLead
                ? appButton(
                    {
                      text: message("actions.commitOpen"),
                      onClick: callbacks.onToggleActionForm,
                      className: darkOutlineButtonClass,
                    },
                    h,
                  )
                : null,
            ],
          ),
          state.actionFormOpen ? commitForm : null,
        ].filter(Predicate.isNotNull),
        h,
      ),
    ],
  );

  if (isMemberReview) {
    children.push(
      panel(
        [
          h.p(
            [h.Class("font-semibold")],
            [
              reviewDate !== null
                ? message("results.review.memberNotice", { date: reviewDate })
                : message("results.review.memberNoticeNoDate"),
            ],
          ),
        ],
        h,
      ),
      actionsNode,
    );

    return resultsLayout(children, result, h);
  }

  if (result.status === "open") {
    children.push(
      h.div(
        [h.Class("rounded-panel bg-primary-soft p-6")],
        [
          h.p([h.Class("font-semibold")], [message("results.openNotice")]),
          h.p(
            [h.Class("mt-1 text-sm text-muted")],
            [pluralMessage("results.openSubmissions", result.submissionsCount)],
          ),
        ],
      ),
    );

    return resultsLayout(children, result, h);
  }

  if (!result.meetsMinimumGroupSize) {
    children.push(
      h.div(
        [h.Class("rounded-panel border border-line bg-subtle p-6")],
        [
          h.p([h.Class("font-semibold")], [message("results.subNPlaceholder")]),
          h.p(
            [h.Class("mt-1 text-sm text-muted")],
            [
              message("results.responseRate", {
                rate: formatPercent(result.responseRate ?? 0),
                responses: String(result.submissionsCount),
                eligible: String(result.eligibleMembersCount),
              }),
            ],
          ),
        ],
      ),
      actionsNode,
    );

    return resultsLayout(children, result, h);
  }

  if (result.dimensions.length > 0) {
    children.push(
      h.section(
        [h.Class("mt-6 flex flex-col gap-4")],
        [
          sectionTitle(message("results.dimensionsTitle"), h),
          h.div(
            [h.Class("grid gap-4 md:grid-cols-2")],
            result.dimensions.map((dim: DimensionResult) => {
              const dimKey = `dim-${dim.dimension}`;
              const isTable = state.showTable[dimKey] ?? false;

              const shown =
                dim.meetsMinimumGroupSize && dim.contributors !== undefined && dim.contributors !== null;

              return panel(
                [
                  h.div(
                    [h.Class("flex items-baseline justify-between gap-4")],
                    [
                      subSectionTitle(dimensionName(dim.dimension), h),
                      scoreView(
                        dim.score !== null ? scoreOfFive(dim.score) : message("results.subNPlaceholder"),
                        h,
                        dim.score !== null,
                      ),
                    ],
                  ),
                  dim.contributors !== undefined && dim.contributors !== null
                    ? shown
                      ? protectionLine(dim.contributors, minimum, h)
                      : h.p(
                          [h.Class("text-[13px] text-muted")],
                          [pluralMessage("results.contributors", dim.contributors)],
                        )
                    : null,
                  changeView(dim.change, h),
                  highlightBadge(dim.change?.highlight ?? null, dim.typicalChange, h),
                  baselineNote(dim.typicalChange, h),
                  h.div(
                    [h.Class("mt-auto rounded-control bg-subtle px-3 pt-2 pb-3")],
                    [
                      h.div(
                        [h.Class("flex items-center justify-between")],
                        [
                          h.h4([h.Class(smallHeading)], [trendTitle(dim.trend.length)]),
                          toggleButton(isTable, callbacks.onToggleTable(dimKey), h),
                        ],
                      ),
                      isTable
                        ? trendTable(dim.trend, h)
                        : trendChart(dim.trend, h, dim.change?.highlight?.isLargerThanUsual === true),
                    ],
                  ),
                ].filter(Predicate.isNotNull),
                h,
                "flex flex-col gap-2",
              );
            }),
          ),
        ],
      ),
    );
  }

  if (result.questions.length > 0) {
    children.push(
      h.section(
        [h.Class("mt-6 flex flex-col gap-4")],
        [
          sectionTitle(message("results.questionsTitle"), h),
          ...result.questions.map((q: QuestionResult) => {
            const qKey = `q-${q.questionVersionId}`;
            const isTable = state.showTable[qKey] ?? false;
            const shown = q.meetsMinimumGroupSize && q.score !== null;

            const answers =
              q.type._tag === "LongText"
                ? result.comments.filter((c) => c.questionVersionId === q.questionVersionId)
                : [];

            return panel(
              [
                h.div(
                  [h.Class("flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-6")],
                  [
                    h.div([h.Class("min-w-0 flex-1")], [subSectionTitle(q.text, h)]),
                    scoreView(
                      q.score !== null
                        ? scoreOfFive(q.score)
                        : q.meetsMinimumGroupSize
                          ? message("results.dash")
                          : message("results.subNQuestion", { n: String(minimum) }),
                      h,
                      q.score !== null || q.meetsMinimumGroupSize,
                    ),
                  ],
                ),
                shown
                  ? protectionLine(q.contributors, minimum, h)
                  : h.p(
                      [h.Class("text-[13px] text-muted")],
                      [pluralMessage("results.contributors", q.contributors)],
                    ),
                changeView(q.change, h),
                highlightBadge(q.change?.highlight ?? null, q.typicalChange, h),
                baselineNote(q.typicalChange, h),

                h.div(
                  [h.Class("mt-2 grid gap-3 md:grid-cols-2")],
                  [
                    q.distribution !== null && q.distribution.length > 0
                      ? h.div(
                          [h.Class("rounded-control bg-subtle p-3")],
                          [
                            h.h4(
                              [h.Class(`mb-2 min-h-11 content-center ${smallHeading}`)],
                              [message("results.distributionTitle")],
                            ),
                            isTable
                              ? distributionTable(q.distribution, h)
                              : distributionChart(q.distribution, h),
                          ],
                        )
                      : null,

                    q.type._tag === "Rating" && q.trend.length > 0
                      ? h.div(
                          [h.Class("rounded-control bg-subtle px-3 pt-0 pb-3")],
                          [
                            h.div(
                              [h.Class("flex items-center justify-between")],
                              [
                                h.h4([h.Class(smallHeading)], [trendTitle(q.trend.length)]),
                                toggleButton(isTable, callbacks.onToggleTable(qKey), h),
                              ],
                            ),
                            isTable
                              ? trendTable(q.trend, h)
                              : trendChart(q.trend, h, q.change?.highlight?.isLargerThanUsual === true),
                          ],
                        )
                      : null,
                  ].filter(Predicate.isNotNull),
                ),
                answers.length > 0
                  ? h.div(
                      [h.Class("mt-2 flex flex-col gap-2")],
                      [
                        h.h4([h.Class(smallHeading)], [message("results.answersTitle")]),
                        ...answers.map((answer) =>
                          h.blockquote(
                            [
                              h.Class(
                                "m-0 rounded-control border border-line bg-subtle px-4 py-3 text-[15px] leading-relaxed",
                              ),
                            ],
                            [answer.text],
                          ),
                        ),
                      ],
                    )
                  : null,
              ].filter(Predicate.isNotNull),
              h,
              "flex flex-col gap-2",
            );
          }),
        ],
      ),
    );
  }

  children.push(themesSection(result, isLead, h));

  const longTextQuestions = new Set(
    result.questions.filter((q) => q.type._tag === "LongText").map((q) => q.questionVersionId),
  );

  const remainingComments = result.comments.filter(
    (comment) => !longTextQuestions.has(comment.questionVersionId),
  );

  if (remainingComments.length > 0) {
    children.push(
      h.section(
        [h.Class("mt-6 flex flex-col gap-3")],
        [
          sectionTitle(message("results.commentsTitle"), h),
          h.p([h.Class("text-sm text-muted")], [message("results.commentsIntro")]),
          h.div(
            [h.Class("mt-1 grid gap-3 sm:grid-cols-2")],
            remainingComments.map((c: { readonly questionVersionId: string; readonly text: string }) =>
              h.blockquote(
                [
                  h.Class(
                    "m-0 rounded-panel border border-line border-l-4 border-l-mint bg-surface px-4 py-3 text-[15px] leading-relaxed shadow-card",
                  ),
                ],
                [c.text],
              ),
            ),
          ),
        ],
      ),
    );
  }

  const guide = result.discussionGuide;

  if (isLead && guide) {
    children.push(discussionGuideView(guide, state.guideCopy, callbacks.onCopyGuide, h));
  }

  children.push(actionsNode);

  return resultsLayout(children, result, h);
};
