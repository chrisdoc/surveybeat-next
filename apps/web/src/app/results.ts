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
import {
  alertView,
  appButton,
  badge,
  darkOutlineButtonClass,
  darkPanel,
  dataTable,
  linkClass,
  linkButton,
  mintButtonClass,
  pageTitle,
  panel,
  problemView,
  sectionTitle,
  selectField,
  statList,
  subSectionTitle,
  textField,
} from "./components.ts";
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

// Chart marks are SVG attributes, so they use the token hex values directly.
const CHART = {
  primary: "#0B5D55",
  line: "#E1E5E1",
  ink: "#0E2A24",
  muted: "#3D554F",
  brass: "#6A4F12",
} as const;

const smallHeading = "text-[13px] font-semibold text-muted";

/** Hand-built SVG 12-round trend line chart. `unusual` marks the latest point in brass. */
export const trendChart = <Message>(
  points: ReadonlyArray<TrendPoint | DimensionTrendPoint>,
  h: HtmlBuilder<Message>,
  unusual = false,
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
        h.Stroke(CHART.line),
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
          h.Stroke(CHART.primary),
          h.StrokeWidth("2"),
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
          h.Fill(unusual && i === points.length - 1 ? CHART.brass : CHART.primary),
        ]),
      );
    }
  }

  return h.svg(
    [
      h.ViewBox(`0 0 ${width} ${height}`),
      h.Class("h-32 w-full max-w-sm overflow-hidden"),
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

  return dataTable(
    [message("results.tableDate"), message("results.tableScore"), message("results.tableContributors")],
    points.map((p) => [
      p.plannedOpenDate,
      p.score !== null ? String(p.score) : message("results.dash"),
      p.contributors !== undefined ? String(p.contributors) : message("results.dash"),
    ]),
    h,
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
          h.Rx("4"),
          h.Fill(CHART.primary),
        ]),
        h.text(
          [h.X("10"), h.Y(String(y + barHeight - 4)), h.Fill(CHART.ink), h.Class("text-xs")],
          [String(d.option)],
        ),
        h.text(
          [h.X(String(45 + barW)), h.Y(String(y + barHeight - 4)), h.Fill(CHART.muted), h.Class("text-xs")],
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

  return dataTable(
    [message("results.tableOption"), message("results.tableCount"), message("results.tablePercent")],
    distribution.map((d) => [
      String(d.option),
      String(d.count),
      `${total > 0 ? Math.round((d.count / total) * 100) : 0}%`,
    ]),
    h,
  );
};

const lineIcon = <Message>(paths: ReadonlyArray<string>, size: number, h: HtmlBuilder<Message>): Html =>
  h.svg(
    [
      h.Width(String(size)),
      h.Height(String(size)),
      h.ViewBox("0 0 18 18"),
      h.AriaHidden(true),
      h.Class("shrink-0 stroke-primary"),
    ],
    paths.map((d) => h.path([h.D(d), h.Fill("none"), h.StrokeWidth("1.5"), h.StrokeLinejoin("round")])),
  );

const SHIELD_PATH = "M9 2l6 2.4v4.4c0 3.6-2.6 6-6 7.2-3.4-1.2-6-3.6-6-7.2V4.4L9 2z";

/** The line under a shown aggregate that says how many people it rests on. */
const protectionLine = <Message>(count: number, minimum: number, h: HtmlBuilder<Message>): Html =>
  h.p(
    [h.Class("flex items-center gap-2 text-[13px] text-muted")],
    [
      lineIcon([SHIELD_PATH], 14, h),
      pluralMessage("results.aboveMinimum", count, { minimum: String(minimum) }),
    ],
  );

const highlightBadge = <Message>(highlight: Highlight | null, h: HtmlBuilder<Message>): Html => {
  if (highlight === null || !highlight.isLargerThanUsual) return null;
  return h.div(
    [h.Class("flex flex-wrap items-center gap-2")],
    [
      badge(
        "brass",
        [
          h.svg(
            [h.ViewBox("0 0 12 12"), h.Width("12"), h.Height("12"), h.AriaHidden(true)],
            [
              h.path([
                h.D("M6 1v7M3 5l3 3 3-3"),
                h.Fill("none"),
                h.Stroke(CHART.brass),
                h.StrokeWidth("1.6"),
                h.StrokeLinecap("round"),
                h.StrokeLinejoin("round"),
              ]),
            ],
          ),
          message("results.biggerChangeThanUsual"),
        ],
        h,
      ),
      h.span([h.Class("text-sm text-muted")], [highlight.explanation]),
    ],
  );
};

const changeView = <Message>(change: QuestionChange | null, h: HtmlBuilder<Message>): Html => {
  if (change === null || change.change === null || change.previousRoundDate === null) return null;
  const d = change.previousRoundDate;
  if (change.change > 0) {
    return h.span(
      [h.Class("text-sm font-semibold tabular-nums")],
      [message("results.changeRise", { change: String(change.change), date: d })],
    );
  }
  if (change.change < 0) {
    return h.span(
      [h.Class("text-sm font-semibold tabular-nums")],
      [message("results.changeDrop", { change: String(change.change), date: d })],
    );
  }
  return h.span([h.Class("text-sm text-muted")], [message("results.noChange", { date: d })]);
};

const baselineNote = <Message>(typical: TypicalChange | null, h: HtmlBuilder<Message>): Html => {
  if (typical === null || typical.status !== "buildingBaseline") return null;
  return h.p(
    [h.Class("text-[13px] text-muted italic")],
    [
      message("results.buildingBaseline", {
        count: String(typical.completedUsableRounds),
        total: String(typical.totalRequiredUsableRounds),
      }),
    ],
  );
};

const scoreView = <Message>(text: string, h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class("font-display text-[30px] leading-none font-medium whitespace-nowrap tabular-nums")],
    [text],
  );

/** The side panel stating, in plain words, what protects people on this page. */
const protectsPanel = <Message>(minimum: number, h: HtmlBuilder<Message>): Html =>
  panel(
    [
      h.h2([h.Class("text-base font-semibold")], [message("results.protects.title")]),
      h.ul(
        [h.Class("mt-4 flex list-none flex-col gap-4 p-0 text-sm leading-normal text-muted")],
        [
          [["M3.5 8h11v8h-11z", "M6 8V5.5a3 3 0 0 1 6 0V8"], message("results.protects.noName")] as const,
          [[SHIELD_PATH], message("results.protects.minimum", { minimum: String(minimum) })] as const,
          [["M2.5 4h13v10h-13z", "M5 9h8"], message("results.protects.comments")] as const,
          [
            ["M9 2l6 2.4v4.4c0 3.6-2.6 6-6 7.2-3.4-1.2-6-3.6-6-7.2V4.4z"],
            message("results.protects.access"),
          ] as const,
        ].map(([paths, text]) => h.li([h.Class("flex gap-3")], [lineIcon(paths, 18, h), h.span([], [text])])),
      ),
    ],
    h,
    "p-6 sm:p-6",
  );

const resultsLayout = <Message>(
  main: ReadonlyArray<Html>,
  result: RoundResult,
  h: HtmlBuilder<Message>,
): Html => {
  const showStats = result.status !== "open" && result.meetsMinimumGroupSize;
  return h.div(
    [h.Class("flex flex-wrap gap-12")],
    [
      h.div([h.Class("flex max-w-[720px] min-w-0 flex-[999_1_600px] flex-col gap-4")], main),
      h.aside(
        [h.Class("flex min-w-0 flex-[1_1_260px] flex-col gap-4")],
        [
          protectsPanel(result.effectiveMinimumGroupSize, h),
          showStats
            ? panel(
                [
                  statList(
                    [
                      [
                        message("results.stat.responseRate"),
                        `${Math.round((result.responseRate ?? 0) * 100)}%`,
                      ],
                      [
                        message("results.stat.contributors"),
                        message("results.stat.ofEligible", {
                          responses: String(result.submissionsCount),
                          eligible: String(result.eligibleMembersCount),
                        }),
                      ],
                    ],
                    h,
                  ),
                ],
                h,
                "p-6 sm:p-6",
              )
            : null,
        ].filter(Predicate.isNotNull),
      ),
    ],
  );
};

const toggleButton = <Message>(isTable: boolean, onClick: Message, h: HtmlBuilder<Message>): Html =>
  appButton(
    { text: message(isTable ? "results.chartView" : "results.tableView"), onClick, className: linkButton },
    h,
  );

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
    return h.p([h.Class("text-muted")], [message("app.loading")]);
  }

  if (state.results._tag === "Failed") {
    return alertView(failureMessage(state.results.failure), h);
  }

  const result = state.results.result;
  const minimum = result.effectiveMinimumGroupSize;

  const children: Array<Html> = [
    h.a([h.Href(teamHref(result.teamId)), h.Class(linkClass)], [message("results.back")]),
    h.div([h.Class("mt-4")], [pageTitle(message("results.title"), h)]),
    h.p([h.Class("text-muted")], [message("results.roundDate", { date: result.plannedOpenDate })]),
  ];

  if (result.delayed) {
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

  // Actions section: shown for all closed rounds (ADR 0004: Actions list has no minimum group size)
  const isLead = state.teamDetail._tag === "Loaded" && state.teamDetail.detail.team.yourRole === "lead";
  const roster = state.teamDetail._tag === "Loaded" ? state.teamDetail.detail.roster : [];

  const actionsItems: Array<Html> = [];

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

            const buttons: Array<Html> = [];
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
                      onClick: callbacks.onUpdateActionStatus(action.id, "dropped"),
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

            return h.li(
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
                            h.span([], [message("actions.ownerLabel", { owner: action.ownerEmail })]),
                            action.dueDate !== null
                              ? h.span([], [message("actions.dueLabel", { date: action.dueDate })])
                              : null,
                            action.dimension !== null
                              ? badge("neutral", [dimensionName(action.dimension)], h)
                              : null,
                          ].filter(Predicate.isNotNull),
                        ),
                      ],
                    ),
                    h.div(
                      [h.Class("flex flex-wrap items-center gap-2")],
                      [
                        badge(action.status === "committed" ? "primary" : "neutral", [statusLabel], h),
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
    [h.Class("mt-8")],
    [
      darkPanel(
        [
          sectionTitle(message("actions.title"), h),
          h.p([h.Class("mt-2 text-mint-text")], [message("actions.intro")]),
          h.div([h.Class("mt-6 flex flex-col gap-4")], actionsItems),
          commitForm,
        ].filter(Predicate.isNotNull),
        h,
      ),
    ],
  );

  // Open round check: response count only
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

  // Sub-N check at Round level
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
    return resultsLayout(children, result, h);
  }

  // Response rate header
  children.push(
    h.p(
      [h.Class("text-muted")],
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
        [h.Class("mt-8 flex flex-col gap-4")],
        [
          sectionTitle(message("results.dimensionsTitle"), h),
          ...result.dimensions.map((dim: DimensionResult) => {
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
                    scoreView(dim.score !== null ? String(dim.score) : message("results.subNPlaceholder"), h),
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
                highlightBadge(dim.change?.highlight ?? null, h),
                baselineNote(dim.typicalChange, h),
                h.div(
                  [h.Class("mt-4 rounded-control bg-subtle p-4")],
                  [
                    h.div(
                      [h.Class("flex items-center justify-between")],
                      [
                        h.h4([h.Class(smallHeading)], [message("results.trend12Rounds")]),
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
          sectionTitle(message("results.questionsTitle"), h),
          ...result.questions.map((q: QuestionResult) => {
            const qKey = `q-${q.questionVersionId}`;
            const isTable = state.showTable[qKey] ?? false;
            const shown = q.meetsMinimumGroupSize && q.score !== null;

            return panel(
              [
                h.div(
                  [h.Class("flex items-start justify-between gap-4")],
                  [
                    subSectionTitle(q.text, h),
                    scoreView(
                      q.score !== null
                        ? String(q.score)
                        : q.meetsMinimumGroupSize
                          ? message("results.dash")
                          : message("results.subNQuestion", { n: String(minimum) }),
                      h,
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
                highlightBadge(q.change?.highlight ?? null, h),
                baselineNote(q.typicalChange, h),
                // Distribution
                q.distribution !== null && q.distribution.length > 0
                  ? h.div(
                      [h.Class("mt-2 rounded-control bg-subtle p-4")],
                      [
                        h.h4([h.Class(`mb-1 ${smallHeading}`)], [message("results.distributionTitle")]),
                        isTable ? distributionTable(q.distribution, h) : distributionChart(q.distribution, h),
                      ],
                    )
                  : null,
                // Trend
                q.trend.length > 0
                  ? h.div(
                      [h.Class("mt-2 rounded-control bg-subtle p-4")],
                      [
                        h.div(
                          [h.Class("flex items-center justify-between")],
                          [
                            h.h4([h.Class(smallHeading)], [message("results.trend12Rounds")]),
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
              h,
              "flex flex-col gap-2",
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
          sectionTitle(message("results.commentsTitle"), h),
          h.p([h.Class("text-muted")], [message("results.commentsIntro")]),
          h.div(
            [h.Class("mt-2 flex flex-col gap-3")],
            result.comments.map((c: { readonly questionVersionId: string; readonly text: string }) =>
              h.blockquote(
                [
                  h.Class(
                    "m-0 rounded-[16px] border border-line bg-surface px-6 py-5 text-[17px] leading-relaxed",
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

  children.push(actionsNode);

  return resultsLayout(children, result, h);
};
