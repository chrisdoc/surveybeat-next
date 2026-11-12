import {
  type ActionId,
  ActionItem,
  type AnonymityMode,
  type ActionStatus,
  type CommentTheme,
  Dimension,
  type DimensionResult,
  type DimensionTrendPoint,
  type DiscussionGuide,
  type DistributionOption,
  type Highlight,
  NOTE_MAX_LENGTH,
  PersonId,
  type QuestionChange,
  type QuestionResult,
  RoundNote,
  RoundResult,
  type TrendPoint,
  type TypicalChange,
} from "@surveybeat/domain";
import { Option, Predicate, Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";
import {
  formatChange,
  formatDate,
  formatPercent,
  formatRoundDate,
  formatScore,
  message,
  pluralMessage,
} from "../messages/locale.ts";
import { Failure, failureMessage } from "./api.ts";
import { lineChart } from "./charts.ts";
import { resultsSummary } from "./resultsSummary.ts";
import {
  alertView,
  appButton,
  badge,
  darkOutlineButtonClass,
  darkPanel,
  dataTable,
  linkButton,
  mintButtonClass,
  pageTitle,
  panel,
  problemView,
  secondaryButtonClass,
  sectionTitle,
  selectField,
  statList,
  subSectionTitle,
  textareaField,
  textField,
  breadcrumbs,
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

export const LoadedNote = defineTaggedUnion({
  Loading: {},
  Loaded: { note: Schema.NullOr(RoundNote) },
  Failed: { failure: Failure },
});
export type LoadedNote = typeof LoadedNote.Type;

const smallHeading = "text-[13px] font-semibold text-muted";

/** The outcome of the last "Copy as text" press on the discussion guide. */
export const GuideCopy = Schema.Literals(["idle", "copied", "failed"]);
export type GuideCopy = typeof GuideCopy.Type;

/** The 12-round trend line chart of a Dimension or Question. `unusual` marks the latest point in brass. */
export const trendChart = <Message>(
  points: ReadonlyArray<TrendPoint | DimensionTrendPoint>,
  h: HtmlBuilder<Message>,
  unusual = false,
): Html => {
  if (points.length === 0) return null;
  const last = points.length - 1;

  return lineChart(
    {
      points: points.map((p, i) => ({
        x: points.length <= 1 ? 0.5 : i / last,
        score: p.score,
        joinsPrevious: !p.hasGap,
      })),
      ariaLabel: message("results.trend12Rounds"),
      highlightLast: unusual,
    },
    h,
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
      formatRoundDate(p.plannedOpenDate),
      p.score !== null ? formatScore(p.score) : message("results.dash"),
      p.contributors !== undefined ? String(p.contributors) : message("results.dash"),
    ]),
    h,
  );
};

/** Distribution bars, one row per option: the label on its own line, then a bar sized to the largest count. */
export const distributionChart = <Message>(
  distribution: ReadonlyArray<DistributionOption>,
  h: HtmlBuilder<Message>,
): Html => {
  if (distribution.length === 0) return null;
  const maxCount = Math.max(...distribution.map((d) => d.count), 1);

  return h.div(
    [
      h.Class("flex w-full max-w-xs flex-col gap-3"),
      h.Role("img"),
      h.AriaLabel(message("results.distributionTitle")),
    ],
    distribution.map((d) =>
      h.div(
        [h.Class("flex flex-col gap-1")],
        [
          h.span([h.Class("text-sm break-words text-ink")], [String(d.option)]),
          h.div(
            [h.Class("flex items-center gap-3")],
            [
              h.div(
                [h.Class("min-w-0 flex-1")],
                [
                  h.div([
                    h.Class("h-5 rounded bg-primary"),
                    h.Style({ width: `${(d.count / maxCount) * 100}%`, minWidth: "2px" }),
                  ]),
                ],
              ),
              h.span([h.Class("text-xs text-muted tabular-nums")], [String(d.count)]),
            ],
          ),
        ],
      ),
    ),
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
      formatPercent(total > 0 ? d.count / total : 0),
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

const highlightArrows: Record<"rise" | "drop", string> = {
  rise: "M6 11V4M3 7l3-3 3 3",
  drop: "M6 1v7M3 5l3 3 3-3",
};

/** The brass badge for a larger-than-usual change; its explanation comes from the Team's typical change. */
const highlightBadge = <Message>(
  highlight: Highlight | null,
  typical: TypicalChange | null,
  h: HtmlBuilder<Message>,
): Html => {
  if (highlight === null || !highlight.isLargerThanUsual) return null;
  const direction = highlight.direction;
  return h.div(
    [h.Class("flex flex-wrap items-center gap-2")],
    [
      badge(
        "brass",
        [
          direction === null
            ? null
            : h.svg(
                [
                  h.ViewBox("0 0 12 12"),
                  h.Width("12"),
                  h.Height("12"),
                  h.AriaHidden(true),
                  h.DataAttribute("direction", direction),
                ],
                [
                  h.path([
                    h.D(highlightArrows[direction]),
                    h.Fill("none"),
                    h.Class("stroke-brass"),
                    h.StrokeWidth("1.6"),
                    h.StrokeLinecap("round"),
                    h.StrokeLinejoin("round"),
                  ]),
                ],
              ),
          message("results.biggerChangeThanUsual"),
        ].filter(Predicate.isNotNull),
        h,
      ),
      typical?.status === "ready" && typical.typicalChange !== null
        ? h.span(
            [h.Class("text-sm text-muted")],
            [message("results.highlight.usualMove", { change: formatScore(typical.typicalChange) })],
          )
        : null,
    ].filter(Predicate.isNotNull),
  );
};

const changeView = <Message>(change: QuestionChange | null, h: HtmlBuilder<Message>): Html => {
  if (change === null || change.change === null || change.previousRoundDate === null) return null;
  const d = formatRoundDate(change.previousRoundDate);
  // Branch on the one-decimal value shown, so a change of 0.04 reads "No change" rather than "+0.0".
  const shown = Math.round(change.change * 10) / 10;
  if (shown > 0) {
    return h.span(
      [h.Class("text-sm font-semibold tabular-nums")],
      [message("results.changeRise", { change: formatChange(change.change), date: d })],
    );
  }
  if (shown < 0) {
    return h.span(
      [h.Class("text-sm font-semibold tabular-nums")],
      [message("results.changeDrop", { change: formatChange(change.change), date: d })],
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

/**
 * What the Round's anonymity mode promises about storage. A Record, so adding a mode (confidential,
 * Release 3) fails to compile until its statement is written.
 */
const storageStatement: Record<AnonymityMode, () => string> = {
  anonymous: () => message("results.protects.anonymous"),
};

/** The side panel stating, in plain words, what protects people on this page. */
const protectsPanel = <Message>(result: RoundResult, h: HtmlBuilder<Message>): Html =>
  panel(
    [
      h.h2([h.Class("text-base font-semibold")], [message("results.protects.title")]),
      h.ul(
        [h.Class("mt-4 flex list-none flex-col gap-4 p-0 text-sm leading-normal text-muted")],
        [
          [
            ["M3.5 8h11v8h-11z", "M6 8V5.5a3 3 0 0 1 6 0V8"],
            storageStatement[result.anonymityMode](),
          ] as const,
          [
            [SHIELD_PATH],
            message("results.protects.minimum", { minimum: String(result.effectiveMinimumGroupSize) }),
          ] as const,
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
          protectsPanel(result, h),
          showStats
            ? panel(
                [
                  statList(
                    [
                      [message("results.stat.responseRate"), formatPercent(result.responseRate ?? 0)],
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

export const toggleButton = <Message>(isTable: boolean, onClick: Message, h: HtmlBuilder<Message>): Html =>
  appButton(
    { text: message(isTable ? "results.chartView" : "results.tableView"), onClick, className: linkButton },
    h,
  );

type GuideSection = {
  readonly heading: string;
  readonly items: ReadonlyArray<string>;
  readonly ordered: boolean;
};

/** The guide's non-empty sections, in reading order. */
const guideSections = (guide: DiscussionGuide): ReadonlyArray<GuideSection> =>
  [
    { heading: message("results.guide.whatStoodOut"), items: guide.whatStoodOut, ordered: false },
    { heading: message("results.guide.whatPeopleRaised"), items: guide.whatPeopleRaised, ordered: false },
    { heading: message("results.guide.actionsToCheckOn"), items: guide.actionsToCheckOn, ordered: false },
    { heading: message("results.guide.questions"), items: guide.questions, ordered: true },
  ].filter((section) => section.items.length > 0);

/** The discussion guide as plain text, for pasting into a meeting document. */
export const discussionGuideText = (guide: DiscussionGuide): string =>
  [
    message("results.guide.title"),
    ...guideSections(guide).map((section) =>
      [
        section.heading,
        ...section.items.map((item, index) => (section.ordered ? `${index + 1}. ${item}` : `- ${item}`)),
      ].join("\n"),
    ),
  ].join("\n\n");

const guideCopyStatus = <Message>(copy: GuideCopy, h: HtmlBuilder<Message>): Html => {
  if (copy === "idle") return null;
  return h.p(
    [h.Role("status"), h.Class("text-sm font-medium text-primary")],
    [message(copy === "copied" ? "results.guide.copied" : "results.guide.copyFailed")],
  );
};

/** The Lead-only discussion guide panel (ADR 0019). */
const discussionGuideView = <Message>(
  guide: DiscussionGuide,
  guideCopy: GuideCopy,
  onCopyGuide: (text: string) => Message,
  h: HtmlBuilder<Message>,
): Html =>
  panel(
    [
      sectionTitle(message("results.guide.title"), h),
      h.p([h.Class("mt-2 text-sm text-muted")], [message("results.guide.intro")]),
      ...guideSections(guide).map((section) => {
        const items = section.items.map((item) => h.li([], [item]));
        return h.div(
          [h.Class("flex flex-col gap-2")],
          [
            subSectionTitle(section.heading, h),
            section.ordered
              ? h.ol([h.Class("flex list-decimal flex-col gap-2 pl-6 text-[17px] leading-relaxed")], items)
              : h.ul([h.Class("flex list-disc flex-col gap-2 pl-6 text-[17px] leading-relaxed")], items),
          ],
        );
      }),
      h.div(
        [h.Class("flex flex-wrap items-center gap-4")],
        [
          appButton(
            {
              text: message("results.guide.copy"),
              onClick: onCopyGuide(discussionGuideText(guide)),
              className: secondaryButtonClass,
            },
            h,
          ),
          guideCopyStatus(guideCopy, h),
        ],
      ),
    ],
    h,
    "flex flex-col gap-6",
  );

const themeCard = <Message>(theme: CommentTheme, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("rounded-[16px] border border-line bg-surface px-6 py-5")],
    [
      subSectionTitle(theme.label, h, 3),
      h.p([h.Class("mt-2 text-[17px] leading-relaxed")], [theme.sentence]),
      theme.supportingComments !== undefined
        ? h.p(
            [h.Class("mt-2 text-[13px] text-muted")],
            [pluralMessage("results.themes.support", theme.supportingComments)],
          )
        : null,
    ].filter(Predicate.isNotNull),
  );

/**
 * What people raised (ADR 0016). Everyone sees the themes and the preparing state; only the Lead sees
 * why a Round has no themes.
 */
const themesSection = <Message>(result: RoundResult, isLead: boolean, h: HtmlBuilder<Message>): Html => {
  const status = result.themesStatus ?? "notRequested";
  const themes = result.themes ?? [];

  if (status === "ready" && themes.length > 0) {
    return h.section(
      [h.Class("mt-8 flex flex-col gap-4")],
      [
        sectionTitle(message("results.themes.title"), h),
        h.div(
          [h.Class("flex flex-col gap-3")],
          themes.map((theme) => themeCard(theme, h)),
        ),
      ],
    );
  }

  if (status === "preparing") {
    return h.section(
      [h.Class("mt-8 flex flex-col gap-4")],
      [
        sectionTitle(message("results.themes.title"), h),
        h.p(
          [h.Class("rounded-control border border-line bg-subtle p-4 text-muted")],
          [message("results.themes.preparing")],
        ),
      ],
    );
  }

  if (!isLead) return null;

  const reason =
    status === "ready"
      ? message("results.themes.none")
      : status === "unavailable"
        ? message("results.themes.unavailable")
        : message("results.themes.aiOff");
  return h.section(
    [h.Class("mt-8 flex flex-col gap-4")],
    [sectionTitle(message("results.themes.title"), h), h.p([h.Class("text-muted")], [reason])],
  );
};

const noteSection = <Message>(
  state: {
    readonly roundNote: LoadedNote;
    readonly noteDraft: string;
    readonly noteEditing: boolean;
    readonly noteBusy: boolean;
    readonly noteFailure: Option.Option<Failure>;
  },
  callbacks: {
    readonly onNoteEdit: Message;
    readonly onNoteDraftChange: (text: string) => Message;
    readonly onNoteCancel: Message;
    readonly onSubmitNote: Message;
  },
  isLead: boolean,
  h: HtmlBuilder<Message>,
): Html => {
  // Nothing until the Note has loaded, so the page does not flash.
  if (state.roundNote._tag === "Loading") return null;

  if (state.roundNote._tag === "Failed") {
    return h.section([h.Class("mt-8")], [alertView(failureMessage(state.roundNote.failure), h)]);
  }

  const note = state.roundNote.note;
  // Members see the Note only when the Lead has written one.
  if (note === null && !isLead) return null;

  const body: Array<Html> = [sectionTitle(message("note.title"), h)];

  if (isLead && state.noteEditing) {
    const length = state.noteDraft.length;
    const isTooLong = length > NOTE_MAX_LENGTH;
    body.push(
      textareaField(
        {
          id: "round-note",
          label: message("note.label"),
          value: state.noteDraft,
          onInput: callbacks.onNoteDraftChange,
          rows: 6,
          isDisabled: state.noteBusy,
        },
        h,
      ),
      h.p(
        [h.Class(`text-sm ${isTooLong ? "text-danger" : "text-muted"}`)],
        [pluralMessage("note.count", length)],
      ),
      isTooLong ? alertView(message("note.tooLong"), h) : null,
      problemView(Option.getOrUndefined(state.noteFailure), h),
      h.div(
        [h.Class("flex flex-wrap justify-end gap-2")],
        [
          appButton(
            {
              text: message("note.cancel"),
              onClick: callbacks.onNoteCancel,
              isDisabled: state.noteBusy,
              className: secondaryButtonClass,
            },
            h,
          ),
          appButton(
            {
              text: message("note.save"),
              type: "button",
              onClick: callbacks.onSubmitNote,
              isDisabled: state.noteBusy || isTooLong,
              className: mintButtonClass,
            },
            h,
          ),
        ],
      ),
    );
  } else if (note !== null) {
    body.push(
      h.p([h.Class("whitespace-pre-line text-[17px] leading-relaxed text-ink")], [note.text]),
      h.p(
        [h.Class("text-sm text-muted")],
        [message("note.lastChanged", { date: formatDate(new Date(note.updatedAt)) })],
      ),
    );
    if (isLead) {
      body.push(
        h.div(
          [h.Class("flex justify-end")],
          [
            appButton(
              { text: message("note.edit"), onClick: callbacks.onNoteEdit, className: secondaryButtonClass },
              h,
            ),
          ],
        ),
      );
    }
  } else {
    body.push(
      h.p([h.Class("text-muted")], [message("note.emptyLead")]),
      h.div(
        [h.Class("flex justify-end")],
        [
          appButton(
            { text: message("note.write"), onClick: callbacks.onNoteEdit, className: mintButtonClass },
            h,
          ),
        ],
      ),
    );
  }

  return h.section([h.Class("mt-8")], [panel(body, h, "flex flex-col gap-4")]);
};

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
    readonly onUpdateActionStatus: (actionId: ActionId, status: ActionStatus) => Message;
    readonly onNoteEdit: Message;
    readonly onNoteDraftChange: (text: string) => Message;
    readonly onNoteCancel: Message;
    readonly onSubmitNote: Message;
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
  const isLead = state.teamDetail._tag === "Loaded" && state.teamDetail.detail.team.yourRole === "lead";
  const roster = state.teamDetail._tag === "Loaded" ? state.teamDetail.detail.roster : [];
  const reviewDate = result.reviewEndsAt !== undefined ? formatDate(new Date(result.reviewEndsAt)) : null;
  // The server withholds a closed or ready Round's Questions from everyone but the Lead (Review window), so
  // decide from the Result itself: no flash of the notice for a Lead while the Team is still loading.
  const isMemberReview =
    (result.status === "closed" || result.status === "ready") &&
    !result.delayed &&
    result.questions.length === 0;

  const teamName =
    state.teamDetail._tag === "Loaded" ? state.teamDetail.detail.team.name : message("title.team");
  const children: Array<Html> = [
    breadcrumbs(
      [
        { label: teamName, href: teamHref(result.teamId) },
        ...(result.pulseName === undefined ? [] : [{ label: result.pulseName }]),
        { label: message("results.roundDate", { date: formatRoundDate(result.plannedOpenDate) }) },
      ],
      h,
    ),
    h.div([h.Class("mt-4")], [pageTitle(message("results.title"), h)]),
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
        [h.Class("mt-6 font-display text-[26px] leading-[1.25] tracking-tight text-ink sm:text-[32px]")],
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
  // Like Actions, the Note belongs to a closed Round: the Lead writes it after the team conversation.
  // A member sees no Note during the Review window.
  if (noteNode !== null && result.status !== "open" && !isMemberReview) {
    children.push(noteNode);
  }

  // Actions section: shown for all closed rounds (ADR 0004: Actions list has no minimum group size)
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
                            action.ownerEmail.trim() !== ""
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
          sectionTitle(message("actions.title"), h, "onDark"),
          h.p([h.Class("mt-2 text-mint-text")], [message("actions.intro")]),
          h.div([h.Class("mt-6 flex flex-col gap-4")], actionsItems),
          commitForm,
        ].filter(Predicate.isNotNull),
        h,
      ),
    ],
  );

  // Review window, Member view: only the notice and the Actions; no scores, themes, or summary
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

  // Response rate header
  children.push(
    h.p(
      [h.Class("text-muted")],
      [
        message("results.responseRate", {
          rate: formatPercent(result.responseRate ?? 0),
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
                    scoreView(
                      dim.score !== null ? formatScore(dim.score) : message("results.subNPlaceholder"),
                      h,
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
                        ? formatScore(q.score)
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
                highlightBadge(q.change?.highlight ?? null, q.typicalChange, h),
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

  // Themes: shown after the Questions, before the Comments (ADR 0016)
  children.push(themesSection(result, isLead, h));

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

  // Discussion guide: Lead only (ADR 0019), after the Comments and before the Actions
  const guide = result.discussionGuide;
  if (isLead && guide) {
    children.push(discussionGuideView(guide, state.guideCopy, callbacks.onCopyGuide, h));
  }

  children.push(actionsNode);

  return resultsLayout(children, result, h);
};
