import * as DateTime from "effect/DateTime";
import { Policy } from "@surveybeat/domain";
import type {
  AnonymityMode,
  CommentTheme,
  DimensionTrendPoint,
  DiscussionGuide,
  DistributionOption,
  Highlight,
  QuestionChange,
  RoundResult,
  TrendPoint,
  TypicalChange,
} from "@surveybeat/domain";
import { Option, Predicate } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import {
  formatChange,
  formatDate,
  formatNumber,
  formatPercent,
  formatRoundDate,
  formatScore,
  message,
  pluralMessage,
} from "../messages/locale.ts";
import { failureMessage } from "./api.ts";
import type { Failure } from "./api.ts";
import { lineChart } from "./charts.ts";
import {
  alertView,
  appButton,
  badge,
  dataTable,
  linkButton,
  mintButtonClass,
  panel,
  problemView,
  secondaryButtonClass,
  sectionTitle,
  statList,
  subSectionTitle,
  textareaField,
} from "./components.ts";
import type { GuideCopy, LoadedNote } from "./results.ts";

export const trendTitle = (rounds: number): string => pluralMessage("results.trendLength", rounds);

const latestScore = (points: readonly (TrendPoint | DimensionTrendPoint)[]): number | null => {
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i]!;

    if (point.score !== null) {
      return point.score;
    }
  }

  return null;
};

export const trendChart = <Message>(
  points: readonly (TrendPoint | DimensionTrendPoint)[],
  h: HtmlBuilder<Message>,
  unusual = false,
): Html => {
  if (points.length === 0) {
    return null;
  }

  const last = points.length - 1;
  const first = points[0]!;
  const newest = points[last]!;
  const latest = latestScore(points);

  return lineChart(
    {
      points: points.map((p, i) => ({
        x: points.length <= 1 ? 0.5 : i / last,
        score: p.score,
        joinsPrevious: !p.hasGap,
      })),
      ariaLabel: trendTitle(points.length),
      highlightLast: unusual,
      fillWidth: true,
      ...(points.length <= 1
        ? {}
        : {
            xTicks: [
              { x: 0, label: formatRoundDate(first.plannedOpenDate) },
              { x: 1, label: formatRoundDate(newest.plannedOpenDate) },
            ],
          }),
      ...(latest === null ? {} : { latestLabel: formatScore(latest) }),
    },
    h,
  );
};

export const trendTable = <Message>(
  points: readonly (TrendPoint | DimensionTrendPoint)[],
  h: HtmlBuilder<Message>,
): Html => {
  if (points.length === 0) {
    return null;
  }

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

export const distributionChart = <Message>(
  distribution: readonly DistributionOption[],
  h: HtmlBuilder<Message>,
): Html => {
  if (distribution.length === 0) {
    return null;
  }

  const maxCount = Math.max(...distribution.map((d) => d.count), 1);

  return h.div(
    [h.Class("flex w-full flex-col gap-3"), h.Role("img"), h.AriaLabel(message("results.distributionTitle"))],
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
                  d.count > 0
                    ? h.div([
                        h.Class("h-5 rounded bg-primary"),
                        h.Style({ width: `${(d.count / maxCount) * 100}%`, minWidth: "2px" }),
                      ])
                    : null,
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

export const distributionTable = <Message>(
  distribution: readonly DistributionOption[],
  h: HtmlBuilder<Message>,
): Html => {
  if (distribution.length === 0) {
    return null;
  }

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

const lineIcon = <Message>(paths: readonly string[], size: number, h: HtmlBuilder<Message>): Html =>
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

const highlightBadge = <Message>(
  highlight: Highlight | null,
  typical: TypicalChange | null,
  h: HtmlBuilder<Message>,
): Html => {
  if (highlight === null || !highlight.isLargerThanUsual) {
    return null;
  }

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
  if (change === null || change.change === null || change.previousRoundDate === null) {
    return null;
  }

  const d = formatRoundDate(change.previousRoundDate);

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
  if (typical === null || typical.status !== "buildingBaseline") {
    return null;
  }

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

const scoreOfFive = (score: number): string => message("results.scoreOf5", { score: formatScore(score) });

const countdown = (reviewEndsAt: number | undefined): number | null => {
  if (reviewEndsAt === undefined) {
    return null;
  }

  const days = Math.ceil((reviewEndsAt - DateTime.toEpochMillis(DateTime.nowUnsafe())) / 86_400_000);

  return days > 0 ? days : null;
};

const storageStatement: Record<AnonymityMode, () => string> = {
  anonymous: () => message("results.protects.anonymous"),
};

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
  main: readonly Html[],
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

interface GuideSection {
  readonly heading: string;
  readonly items: readonly string[];
  readonly ordered: boolean;
}

const guideSections = (guide: DiscussionGuide): readonly GuideSection[] =>
  [
    { heading: message("results.guide.whatStoodOut"), items: guide.whatStoodOut, ordered: false },
    { heading: message("results.guide.whatPeopleRaised"), items: guide.whatPeopleRaised, ordered: false },
    { heading: message("results.guide.actionsToCheckOn"), items: guide.actionsToCheckOn, ordered: false },
    { heading: message("results.guide.questions"), items: guide.questions, ordered: true },
  ].filter((section) => section.items.length > 0);

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
  if (copy === "idle") {
    return null;
  }

  return h.p(
    [h.Role("status"), h.Class("text-sm font-medium text-primary")],
    [message(copy === "copied" ? "results.guide.copied" : "results.guide.copyFailed")],
  );
};

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

  if (!isLead) {
    return null;
  }

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
  if (state.roundNote._tag === "Loading") {
    return null;
  }

  if (state.roundNote._tag === "Failed") {
    return h.section([h.Class("mt-8")], [alertView(failureMessage(state.roundNote.failure), h)]);
  }

  const note = state.roundNote.note;

  if (note === null && !isLead) {
    return null;
  }

  const body: Html[] = [sectionTitle(message("note.title"), h)];

  if (isLead && state.noteEditing) {
    const length = state.noteDraft.length;
    const isTooLong = length > Policy.text.noteMaxLength;
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
        [pluralMessage("note.count", length, { max: formatNumber(Policy.text.noteMaxLength) })],
      ),
      isTooLong
        ? alertView(message("note.tooLong", { max: formatNumber(Policy.text.noteMaxLength) }), h)
        : null,
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
        [message("note.lastChanged", { date: formatDate(DateTime.makeUnsafe(note.updatedAt)) })],
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

export {
  protectionLine,
  highlightBadge,
  changeView,
  baselineNote,
  scoreView,
  scoreOfFive,
  countdown,
  resultsLayout,
  discussionGuideView,
  themesSection,
  noteSection,
};
