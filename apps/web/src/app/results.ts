import {
  type ActionId,
  ActionItem,
  type ActionStatus,
  Dimension,
  type DimensionResult,
  type DimensionTrendPoint,
  type DistributionOption,
  type Highlight,
  PersonId,
  type QuestionChange,
  type QuestionResult,
  RoundResult,
  type TrendPoint,
  type TypicalChange,
} from "@surveybeat/domain";
import { Option, Predicate, Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";
import { message, pluralMessage } from "../messages/index.ts";
import { Failure, failureMessage } from "./api.ts";
import { appButton, problemView, selectField, textField } from "./components.ts";
import type { LoadedTeam } from "./directory.ts";
import { dimensionName } from "./pulses.ts";
import { teamHref } from "./routes.ts";

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

/** Hand-built SVG 12-round trend line chart. */
export const trendChart = <Message>(
  points: ReadonlyArray<TrendPoint | DimensionTrendPoint>,
  h: HtmlBuilder<Message>,
): Html => {
  if (points.length === 0) return null;

  const width = 360;
  const height = 120;
  const padLeft = 24;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 24;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const minScore = 1.0;
  const maxScore = 5.0;

  const getX = (idx: number) => {
    if (points.length <= 1) return padLeft + chartW / 2;
    return padLeft + (idx / (points.length - 1)) * chartW;
  };

  const getY = (score: number) => {
    const norm = (score - minScore) / (maxScore - minScore);
    return padTop + (1 - norm) * chartH;
  };

  const svgChildren = [];

  // Horizontal guide lines at 1.0, 3.0, 5.0
  for (const s of [1, 3, 5]) {
    const y = getY(s);
    svgChildren.push(
      h.line([
        h.X1(String(padLeft)),
        h.Y1(String(y)),
        h.X2(String(width - padRight)),
        h.Y2(String(y)),
        h.Stroke("#e5e7eb"),
        h.Class("stroke-gray-200"),
      ]),
    );
  }

  // Draw lines between consecutive non-gap points
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    if (p1.score !== null && p2.score !== null && !p2.hasGap) {
      svgChildren.push(
        h.line([
          h.X1(String(getX(i))),
          h.Y1(String(getY(p1.score))),
          h.X2(String(getX(i + 1))),
          h.Y2(String(getY(p2.score))),
          h.Stroke("#2563eb"),
          h.Class("stroke-blue-600"),
        ]),
      );
    }
  }

  // Draw dot markers
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.score !== null) {
      svgChildren.push(
        h.circle([
          h.Cx(String(getX(i))),
          h.Cy(String(getY(p.score))),
          h.R("4"),
          h.Fill("#2563eb"),
          h.Class("fill-blue-600"),
        ]),
      );
    }
  }

  return h.svg(
    [
      h.ViewBox(`0 0 ${width} ${height}`),
      h.Class("w-full max-w-sm h-32 overflow-hidden"),
      h.Role("img"),
      h.AriaLabel(message("results.trend12Rounds")),
    ],
    svgChildren,
  );
};

/** Accessible tabular view of trend data points. */
export const trendTable = <Message>(
  points: ReadonlyArray<TrendPoint | DimensionTrendPoint>,
  h: HtmlBuilder<Message>,
): Html => {
  if (points.length === 0) return null;

  return h.table(
    [h.Class("mt-2 w-full text-left text-xs border border-gray-200 rounded")],
    [
      h.thead(
        [h.Class("bg-gray-50 border-b border-gray-200")],
        [
          h.tr(
            [],
            [
              h.th([h.Class("px-2 py-1")], [message("results.tableDate")]),
              h.th([h.Class("px-2 py-1")], [message("results.tableScore")]),
              h.th([h.Class("px-2 py-1")], [message("results.tableContributors")]),
            ],
          ),
        ],
      ),
      h.tbody(
        [],
        points.map((p) => {
          const contrib = p.contributors;
          return h.tr(
            [h.Class("border-b border-gray-100")],
            [
              h.td([h.Class("px-2 py-1")], [p.plannedOpenDate]),
              h.td([h.Class("px-2 py-1")], [p.score !== null ? String(p.score) : message("results.dash")]),
              h.td(
                [h.Class("px-2 py-1")],
                [contrib !== undefined ? String(contrib) : message("results.dash")],
              ),
            ],
          );
        }),
      ),
    ],
  );
};

/** Hand-built SVG distribution bar chart. */
export const distributionChart = <Message>(
  distribution: ReadonlyArray<DistributionOption>,
  h: HtmlBuilder<Message>,
): Html => {
  if (distribution.length === 0) return null;
  const maxCount = Math.max(...distribution.map((d) => d.count), 1);
  const width = 300;
  const barHeight = 20;
  const gap = 8;
  const height = distribution.length * (barHeight + gap);

  const rects = distribution.map((d, idx) => {
    const y = idx * (barHeight + gap);
    const barW = Math.max((d.count / maxCount) * (width - 60), 2);
    return h.g(
      [],
      [
        h.rect([
          h.X("40"),
          h.Y(String(y)),
          h.Width(String(barW)),
          h.Height(String(barHeight)),
          h.Fill("#3b82f6"),
          h.Class("fill-blue-500 rounded"),
        ]),
        h.text(
          [h.X("10"), h.Y(String(y + barHeight - 4)), h.Fill("#374151"), h.Class("text-xs fill-gray-700")],
          [String(d.option)],
        ),
        h.text(
          [
            h.X(String(45 + barW)),
            h.Y(String(y + barHeight - 4)),
            h.Fill("#6b7280"),
            h.Class("text-xs fill-gray-500"),
          ],
          [String(d.count)],
        ),
      ],
    );
  });

  return h.svg(
    [
      h.ViewBox(`0 0 ${width} ${height}`),
      h.Class("w-full max-w-xs overflow-hidden"),
      h.Role("img"),
      h.AriaLabel(message("results.distributionTitle")),
    ],
    rects,
  );
};

/** Accessible tabular view of distribution data. */
export const distributionTable = <Message>(
  distribution: ReadonlyArray<DistributionOption>,
  h: HtmlBuilder<Message>,
): Html => {
  if (distribution.length === 0) return null;
  const total = distribution.reduce((sum, d) => sum + d.count, 0);

  return h.table(
    [h.Class("mt-2 w-full text-left text-xs border border-gray-200 rounded")],
    [
      h.thead(
        [h.Class("bg-gray-50 border-b border-gray-200")],
        [
          h.tr(
            [],
            [
              h.th([h.Class("px-2 py-1")], [message("results.tableOption")]),
              h.th([h.Class("px-2 py-1")], [message("results.tableCount")]),
              h.th([h.Class("px-2 py-1")], [message("results.tablePercent")]),
            ],
          ),
        ],
      ),
      h.tbody(
        [],
        distribution.map((d) => {
          const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
          return h.tr(
            [h.Class("border-b border-gray-100")],
            [
              h.td([h.Class("px-2 py-1")], [String(d.option)]),
              h.td([h.Class("px-2 py-1")], [String(d.count)]),
              h.td([h.Class("px-2 py-1")], [`${pct}%`]),
            ],
          );
        }),
      ),
    ],
  );
};

const highlightBadge = <Message>(highlight: Highlight | null, h: HtmlBuilder<Message>): Html => {
  if (highlight === null || !highlight.isLargerThanUsual) return null;
  return h.div(
    [
      h.Class(
        "mt-1 inline-flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 border border-amber-200",
      ),
    ],
    [
      h.svg(
        [h.ViewBox("0 0 16 16"), h.Class("h-4 w-4 fill-amber-600")],
        [h.path([h.D("M8 1l2 5 5 1-4 4 1 5-4-3-4 3 1-5-4-4 5-1z")])],
      ),
      h.span([h.Class("font-medium")], [message("results.biggerChangeThanUsual")]),
      h.span([], [highlight.explanation]),
    ],
  );
};

const changeView = <Message>(change: QuestionChange | null, h: HtmlBuilder<Message>): Html => {
  if (change === null || change.change === null || change.previousRoundDate === null) return null;
  const d = change.previousRoundDate;
  if (change.change > 0) {
    return h.span(
      [h.Class("text-sm text-green-700 font-medium")],
      [message("results.changeRise", { change: String(change.change), date: d })],
    );
  }
  if (change.change < 0) {
    return h.span(
      [h.Class("text-sm text-red-700 font-medium")],
      [message("results.changeDrop", { change: String(change.change), date: d })],
    );
  }
  return h.span([h.Class("text-sm text-gray-600")], [message("results.noChange", { date: d })]);
};

const baselineNote = <Message>(typical: TypicalChange | null, h: HtmlBuilder<Message>): Html => {
  if (typical === null || typical.status !== "buildingBaseline") return null;
  return h.p(
    [h.Class("mt-1 text-xs text-gray-500 italic")],
    [
      message("results.buildingBaseline", {
        count: String(typical.completedUsableRounds),
        total: String(typical.totalRequiredUsableRounds),
      }),
    ],
  );
};

export const resultsScreenView = <Message>(
  state: {
    readonly results: LoadedResults;
    readonly actions: LoadedActions;
    readonly teamDetail: LoadedTeam;
    readonly showTable: Record<string, boolean>;
    readonly actionTitle: string;
    readonly actionOwnerId: Option.Option<PersonId>;
    readonly actionDueDate: string;
    readonly actionDimension: Dimension | "none";
    readonly actionBusy: boolean;
    readonly actionFailure: Option.Option<Failure>;
  },
  callbacks: {
    readonly onToggleTable: (key: string) => Message;
    readonly onActionTitleChange: (title: string) => Message;
    readonly onActionOwnerChange: (personId: string) => Message;
    readonly onActionDueDateChange: (date: string) => Message;
    readonly onActionDimensionChange: (dim: string) => Message;
    readonly onSubmitAction: Message;
    readonly onUpdateActionStatus: (actionId: ActionId, status: ActionStatus) => Message;
  },
  h: HtmlBuilder<Message>,
): Html => {
  if (state.results._tag === "Loading") {
    return h.main([h.Class("mx-auto max-w-2xl p-6")], [h.p([], [message("app.loading")])]);
  }

  if (state.results._tag === "Failed") {
    const errorText = failureMessage(state.results.failure);
    return h.main(
      [h.Class("mx-auto max-w-2xl p-6")],
      [h.p([h.Role("alert"), h.Class("text-red-700")], [errorText])],
    );
  }

  const result = state.results.result;

  const children: Array<Html> = [
    h.a([h.Href(teamHref(result.teamId)), h.Class("text-sm underline")], [message("results.back")]),
    h.h1([h.Class("text-2xl font-bold mt-2")], [message("results.title")]),
    h.p([h.Class("text-sm text-gray-500")], [message("results.roundDate", { date: result.plannedOpenDate })]),
  ];

  if (result.delayed) {
    children.push(
      h.div(
        [h.Role("alert"), h.Class("mt-4 p-4 rounded bg-yellow-50 border border-yellow-200")],
        [
          h.h2([h.Class("font-semibold text-yellow-800")], [message("results.delayedTitle")]),
          h.p([h.Class("text-sm text-yellow-700 mt-1")], [message("results.delayedBody")]),
        ],
      ),
    );
  }

  // Actions section: shown for all closed rounds (ADR 0004: Actions list has no minimum group size)
  const isLead = state.teamDetail._tag === "Loaded" && state.teamDetail.detail.team.yourRole === "lead";
  const roster = state.teamDetail._tag === "Loaded" ? state.teamDetail.detail.roster : [];

  const actionsItems: Array<Html> = [];

  if (state.actions._tag === "Loading") {
    actionsItems.push(h.p([h.Class("text-sm text-gray-500")], [message("app.loading")]));
  } else if (state.actions._tag === "Failed") {
    actionsItems.push(
      h.p([h.Role("alert"), h.Class("text-sm text-red-700")], [failureMessage(state.actions.failure)]),
    );
  } else {
    const list = state.actions.actions;
    if (list.length === 0) {
      actionsItems.push(h.p([h.Class("text-sm text-gray-500 italic")], [message("actions.empty")]));
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

            const statusClass =
              action.status === "committed"
                ? "bg-blue-100 text-blue-800"
                : action.status === "done"
                  ? "bg-green-100 text-green-800"
                  : "bg-gray-100 text-gray-800";

            const buttons: Array<Html> = [];
            if (isLead) {
              if (action.status === "committed") {
                buttons.push(
                  appButton(
                    {
                      text: message("actions.markDone"),
                      onClick: callbacks.onUpdateActionStatus(action.id, "done"),
                      className: "text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded",
                    },
                    h,
                  ),
                  appButton(
                    {
                      text: message("actions.drop"),
                      onClick: callbacks.onUpdateActionStatus(action.id, "dropped"),
                      className: "text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded",
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
                      className: "text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded",
                    },
                    h,
                  ),
                );
              }
            }

            return h.li(
              [h.Class("p-4 rounded border border-gray-200 bg-white shadow-xs flex flex-col gap-2")],
              [
                h.div(
                  [h.Class("flex items-start justify-between gap-4")],
                  [
                    h.div(
                      [h.Class("flex flex-col gap-1")],
                      [
                        h.h3([h.Class("font-medium text-base text-gray-900")], [action.title]),
                        h.div(
                          [h.Class("flex flex-wrap items-center gap-3 text-xs text-gray-500")],
                          [
                            h.span([], [message("actions.ownerLabel", { owner: action.ownerEmail })]),
                            action.dueDate !== null
                              ? h.span([], [message("actions.dueLabel", { date: action.dueDate })])
                              : null,
                            action.dimension !== null
                              ? h.span(
                                  [h.Class("px-1.5 py-0.5 rounded bg-gray-100 text-gray-700")],
                                  [dimensionName(action.dimension)],
                                )
                              : null,
                          ].filter(Predicate.isNotNull),
                        ),
                      ],
                    ),
                    h.div(
                      [h.Class("flex items-center gap-2")],
                      [
                        h.span(
                          [h.Class(`px-2 py-0.5 rounded text-xs font-medium ${statusClass}`)],
                          [statusLabel],
                        ),
                        ...buttons,
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

    const dimensionOptions: ReadonlyArray<readonly [string, string]> = [
      ["none", message("actions.none")],
      ...Dimension.literals.map((dim): readonly [string, string] => [dim, dimensionName(dim)]),
    ];

    const rosterOptions: ReadonlyArray<readonly [string, string]> = roster.map((m) => [m.personId, m.email]);

    commitForm = h.form(
      [
        h.Class("mt-6 p-4 rounded border border-gray-200 bg-gray-50 flex flex-col gap-4"),
        h.OnSubmit(callbacks.onSubmitAction),
      ],
      [
        h.h3([h.Class("text-base font-semibold text-gray-900")], [message("actions.commitTitle")]),
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
          [h.Class("grid grid-cols-1 sm:grid-cols-3 gap-3")],
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
                className: "px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium",
              },
              h,
            ),
          ],
        ),
      ].filter(Predicate.isNotNull),
    );
  }

  const actionsNode = h.section(
    [h.Class("mt-8 flex flex-col gap-4 border-t border-gray-200 pt-6")],
    [
      h.div(
        [h.Class("flex flex-col gap-1")],
        [
          h.h2([h.Class("text-xl font-semibold text-gray-900")], [message("actions.title")]),
          h.p([h.Class("text-xs text-gray-500")], [message("actions.intro")]),
        ],
      ),
      ...actionsItems,
      commitForm,
    ].filter(Predicate.isNotNull),
  );

  // Open round check: response count only
  if (result.status === "open") {
    children.push(
      h.div(
        [h.Class("mt-4 p-4 rounded bg-blue-50 border border-blue-200")],
        [
          h.p([h.Class("text-blue-900 font-medium")], [message("results.openNotice")]),
          h.p(
            [h.Class("text-sm text-blue-700 mt-1")],
            [pluralMessage("results.openSubmissions", result.submissionsCount)],
          ),
        ],
      ),
    );
    return h.main([h.Class("mx-auto max-w-2xl p-6 flex flex-col gap-4")], children);
  }

  // Sub-N check at Round level
  if (!result.meetsMinimumGroupSize) {
    children.push(
      h.div(
        [h.Class("mt-4 p-4 rounded bg-gray-50 border border-gray-200")],
        [
          h.p([h.Class("text-sm text-gray-700 font-medium")], [message("results.subNPlaceholder")]),
          h.p(
            [h.Class("text-xs text-gray-500 mt-1")],
            [
              message("results.responseRate", {
                rate: String(Math.round((result.responseRate ?? 0) * 100)),
                responses: String(result.submissionsCount),
                eligible: String(result.eligibleMembersCount),
              }),
            ],
          ),
        ],
      ),
      actionsNode,
    );
    return h.main([h.Class("mx-auto max-w-2xl p-6 flex flex-col gap-4")], children);
  }

  // Response rate header
  children.push(
    h.p(
      [h.Class("mt-2 text-sm text-gray-600")],
      [
        message("results.responseRate", {
          rate: String(Math.round((result.responseRate ?? 0) * 100)),
          responses: String(result.submissionsCount),
          eligible: String(result.eligibleMembersCount),
        }),
      ],
    ),
  );

  // Dimensions
  if (result.dimensions.length > 0) {
    children.push(
      h.section(
        [h.Class("mt-6 flex flex-col gap-4")],
        [
          h.h2([h.Class("text-xl font-semibold")], [message("results.dimensionsTitle")]),
          ...result.dimensions.map((dim: DimensionResult) => {
            const dimKey = `dim-${dim.dimension}`;
            const isTable = state.showTable[dimKey] ?? false;

            return h.div(
              [h.Class("rounded border border-gray-200 p-4 bg-white shadow-xs")],
              [
                h.div(
                  [h.Class("flex items-baseline justify-between")],
                  [
                    h.h3([h.Class("font-medium text-lg")], [dimensionName(dim.dimension)]),
                    h.span(
                      [h.Class("text-xl font-bold")],
                      [dim.score !== null ? String(dim.score) : message("results.subNPlaceholder")],
                    ),
                  ],
                ),
                dim.contributors !== undefined && dim.contributors !== null
                  ? h.p(
                      [h.Class("text-xs text-gray-500")],
                      [pluralMessage("results.contributors", dim.contributors)],
                    )
                  : null,
                changeView(dim.change, h),
                highlightBadge(dim.change?.highlight ?? null, h),
                baselineNote(dim.typicalChange, h),
                h.div(
                  [h.Class("mt-4 flex items-center justify-between")],
                  [
                    h.h4(
                      [h.Class("text-xs font-semibold text-gray-500 uppercase")],
                      [message("results.trend12Rounds")],
                    ),
                    appButton(
                      {
                        text: message(isTable ? "results.chartView" : "results.tableView"),
                        onClick: callbacks.onToggleTable(dimKey),
                        className: "text-xs underline text-blue-600 bg-transparent px-1 py-0.5",
                      },
                      h,
                    ),
                  ],
                ),
                isTable ? trendTable(dim.trend, h) : trendChart(dim.trend, h),
              ].filter(Predicate.isNotNull),
            );
          }),
        ],
      ),
    );
  }

  // Questions
  if (result.questions.length > 0) {
    children.push(
      h.section(
        [h.Class("mt-8 flex flex-col gap-4")],
        [
          h.h2([h.Class("text-xl font-semibold")], [message("results.questionsTitle")]),
          ...result.questions.map((q: QuestionResult) => {
            const qKey = `q-${q.questionVersionId}`;
            const isTable = state.showTable[qKey] ?? false;

            return h.div(
              [h.Class("rounded border border-gray-200 p-4 bg-white shadow-xs flex flex-col gap-2")],
              [
                h.div(
                  [h.Class("flex items-start justify-between gap-4")],
                  [
                    h.h3([h.Class("font-medium text-base")], [q.text]),
                    h.span(
                      [h.Class("text-xl font-bold whitespace-nowrap")],
                      [
                        q.score !== null
                          ? String(q.score)
                          : q.meetsMinimumGroupSize
                            ? message("results.dash")
                            : message("results.subNQuestion", {
                                n: String(result.effectiveMinimumGroupSize),
                              }),
                      ],
                    ),
                  ],
                ),
                h.p(
                  [h.Class("text-xs text-gray-500")],
                  [pluralMessage("results.contributors", q.contributors)],
                ),
                changeView(q.change, h),
                highlightBadge(q.change?.highlight ?? null, h),
                baselineNote(q.typicalChange, h),
                // Distribution
                q.distribution !== null && q.distribution.length > 0
                  ? h.div(
                      [h.Class("mt-2")],
                      [
                        h.h4(
                          [h.Class("text-xs font-semibold text-gray-500 uppercase mb-1")],
                          [message("results.distributionTitle")],
                        ),
                        isTable ? distributionTable(q.distribution, h) : distributionChart(q.distribution, h),
                      ],
                    )
                  : null,
                // Trend
                q.trend.length > 0
                  ? h.div(
                      [h.Class("mt-2")],
                      [
                        h.div(
                          [h.Class("flex items-center justify-between")],
                          [
                            h.h4(
                              [h.Class("text-xs font-semibold text-gray-500 uppercase")],
                              [message("results.trend12Rounds")],
                            ),
                            appButton(
                              {
                                text: message(isTable ? "results.chartView" : "results.tableView"),
                                onClick: callbacks.onToggleTable(qKey),
                                className: "text-xs underline text-blue-600 bg-transparent px-1 py-0.5",
                              },
                              h,
                            ),
                          ],
                        ),
                        isTable ? trendTable(q.trend, h) : trendChart(q.trend, h),
                      ],
                    )
                  : null,
              ].filter(Predicate.isNotNull),
            );
          }),
        ],
      ),
    );
  }

  // Comments (Lead only, behind N)
  if (result.comments.length > 0) {
    children.push(
      h.section(
        [h.Class("mt-8 flex flex-col gap-3")],
        [
          h.h2([h.Class("text-xl font-semibold")], [message("results.commentsTitle")]),
          h.p([h.Class("text-xs text-gray-500")], [message("results.commentsIntro")]),
          h.div(
            [h.Class("flex flex-col gap-2 mt-1")],
            result.comments.map((c: { readonly questionVersionId: string; readonly text: string }) =>
              h.div(
                [h.Class("rounded bg-gray-50 p-3 text-sm text-gray-800 border border-gray-100 italic")],
                [c.text],
              ),
            ),
          ),
        ],
      ),
    );
  }

  children.push(actionsNode);

  return h.main([h.Class("mx-auto max-w-2xl p-6 flex flex-col gap-4")], children);
};
