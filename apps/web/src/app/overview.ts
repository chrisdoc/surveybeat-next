// @effect-diagnostics globalDate:off -- the view formats or compares an instant that arrived from the API against the browser clock; nothing here is stored on the server.

import {
  type ActionMarker,
  type DimensionOverview,
  type OverviewRound,
  type RoundId,
  TeamOverview,
} from "@surveybeat/domain";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";
import { formatDate, formatRoundDate, formatScore, message } from "../messages/locale.ts";
import { Failure } from "./api.ts";
import { type ChartPoint, lineChart, plotPercent } from "./charts.ts";
import {
  dataTable,
  emptyState,
  linkClass,
  panel,
  problemView,
  sectionTitle,
  subSectionTitle,
} from "./components.ts";
import { toggleButton } from "./results.ts";
import { dimensionName } from "./pulses.ts";
import { roundResultsHref } from "./routes.ts";

/** How many of the newest shared Rounds the Team page lists. */
const RECENT_ROUNDS = 5;

export const LoadedOverview = defineTaggedUnion({
  Loading: {},
  Loaded: { overview: TeamOverview },
  Failed: { failure: Failure },
});
export type LoadedOverview = typeof LoadedOverview.Type;

/** The viewBox width of the overview charts; markers are positioned against the same width. */
const OVERVIEW_WIDTH = 360;

const plotBox = <Message>(children: ReadonlyArray<Html>, h: HtmlBuilder<Message>): Html =>
  h.div([h.Class("flex flex-col gap-2 rounded-control bg-subtle p-4")], children);

const eventGlyph = <Message>(kind: ActionMarker["kind"], h: HtmlBuilder<Message>): Html =>
  h.span(
    [
      h.AriaHidden(true),
      h.Class(
        kind === "committed"
          ? "block size-3 shrink-0 rounded-full border-2 border-brass bg-surface"
          : "block size-3 shrink-0 rounded-full bg-primary",
      ),
    ],
    [],
  );

const markerText = (marker: ActionMarker): string =>
  message(marker.kind === "committed" ? "overview.marker.committed" : "overview.marker.done", {
    date: formatDate(new Date(marker.at)),
    title: marker.title,
  });

const tooltipBaseClass =
  "pointer-events-none hidden absolute bottom-full z-10 mb-1 w-max max-w-[min(20rem,calc(100vw-2rem))] whitespace-normal rounded-control bg-evergreen px-2 py-1 text-xs text-on-primary group-hover:block group-focus-visible:block group-focus:block";

/** Anchors the tooltip to the marker's left edge near the start of the axis, its right edge near the end, and centred otherwise. */
const tooltipAnchor = (x: number): string => {
  if (x < 0.15) return "left-0";
  if (x > 0.85) return "right-0";
  return "left-1/2 -translate-x-1/2";
};

/** One Action marker: a focusable button whose title shows on hover and keyboard focus. */
const markerButton = <Message>(marker: ActionMarker, x: number, h: HtmlBuilder<Message>): Html => {
  const text = markerText(marker);
  return h.button(
    [
      h.Type("button"),
      h.AriaLabel(text),
      h.Class("group absolute top-1 flex size-6 -translate-x-1/2 items-center justify-center rounded-full"),
      h.Style({ left: plotPercent(x, OVERVIEW_WIDTH) }),
    ],
    [
      eventGlyph(marker.kind, h),
      h.span([h.Role("tooltip"), h.Class(`${tooltipBaseClass} ${tooltipAnchor(x)}`)], [text]),
    ],
  );
};

export interface OverviewXs {
  /** x (0..1) of each shared Round on the shared time axis. */
  readonly rounds: ReadonlyMap<RoundId, number>;
  /** x (0..1) of an epoch-ms time on the same axis, clamped to the plot. */
  readonly markerX: (at: number) => number;
}

/**
 * The shared time axis of the overview: the earliest and latest of every planned open date and Action
 * time map to 0 and 1. A single instant (one Round, no markers) sits at the middle.
 */
export const overviewXs = (overview: TeamOverview): OverviewXs => {
  let tMin = Number.POSITIVE_INFINITY;
  let tMax = Number.NEGATIVE_INFINITY;
  for (const round of overview.rounds) {
    tMin = Math.min(tMin, Date.parse(round.plannedOpenDate));
    tMax = Math.max(tMax, Date.parse(round.plannedOpenDate));
  }
  for (const marker of overview.markers) {
    tMin = Math.min(tMin, marker.at);
    tMax = Math.max(tMax, marker.at);
  }
  const markerX = (at: number): number => {
    if (tMax === tMin) return 0.5;
    return Math.min(1, Math.max(0, (at - tMin) / (tMax - tMin)));
  };
  const rounds = new Map<RoundId, number>();
  for (const round of overview.rounds) {
    rounds.set(round.roundId, markerX(Date.parse(round.plannedOpenDate)));
  }
  return { rounds, markerX };
};

const legend = <Message>(h: HtmlBuilder<Message>): Html =>
  h.p(
    [h.Class("flex flex-wrap items-center gap-4 text-[13px] text-muted")],
    [
      h.span(
        [h.Class("flex items-center gap-2")],
        [eventGlyph("committed", h), message("overview.legend.committed")],
      ),
      h.span([h.Class("flex items-center gap-2")], [eventGlyph("done", h), message("overview.legend.done")]),
    ],
  );

/** Action markers drawn on the plot itself, on the same x-axis as the lines. */
const markerOverlay = <Message>(
  markers: ReadonlyArray<ActionMarker>,
  xs: ReadonlyArray<number>,
  interactive: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    interactive
      ? [h.Role("group"), h.AriaLabel(message("overview.markersLabel")), h.Class("absolute inset-0")]
      : [h.AriaHidden(true), h.Class("absolute inset-0")],
    markers.map((marker, i) => {
      const x = xs[i] ?? 0.5;
      if (interactive) return markerButton(marker, x, h);
      return h.span(
        [
          h.AriaHidden(true),
          h.Class("absolute top-1 flex size-6 -translate-x-1/2 items-center justify-center"),
          h.Style({ left: plotPercent(x, OVERVIEW_WIDTH) }),
        ],
        [eventGlyph(marker.kind, h)],
      );
    }),
  );

/** The latest scored Dimension value, or null when every Round had too few answers. */
const latestDimensionScore = (dimension: DimensionOverview): number | null => {
  for (let i = dimension.points.length - 1; i >= 0; i--) {
    const point = dimension.points[i]!;
    if (point.score !== null) return point.score;
  }
  return null;
};

/**
 * One line per Dimension; the Round x positions are shared, so each Dimension reuses them. The markers ride
 * on the first chart's plot — focusable there, decorative on the others so the tab order has them once.
 */
const dimensionPanel = <Message>(
  dimension: DimensionOverview,
  rounds: ReadonlyArray<OverviewRound>,
  xByRound: ReadonlyMap<RoundId, number>,
  markers: ReadonlyArray<ActionMarker>,
  markerXs: ReadonlyArray<number>,
  interactive: boolean,
  h: HtmlBuilder<Message>,
): Html => {
  const name = dimensionName(dimension.dimension);
  const points: Array<ChartPoint> = [];
  for (const point of dimension.points) {
    const x = xByRound.get(point.roundId);
    if (x !== undefined) points.push({ x, score: point.score, joinsPrevious: true });
  }
  const first = rounds[0];
  const newest = rounds[rounds.length - 1];
  const latest = latestDimensionScore(dimension);
  return panel(
    [
      subSectionTitle(name, h),
      plotBox(
        [
          h.div(
            [h.Class("relative")],
            [
              lineChart(
                {
                  points,
                  ariaLabel: message("overview.chartLabel", { dimension: name }),
                  width: OVERVIEW_WIDTH,
                  dotRadius: 2.5,
                  className: "block h-auto w-full",
                  guides: markerXs,
                  ...(rounds.length <= 1 || first === undefined || newest === undefined
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
              ),
              ...(markers.length === 0 ? [] : [markerOverlay(markers, markerXs, interactive, h)]),
            ],
          ),
          ...(interactive && markers.length > 0 ? [legend(h)] : []),
        ],
        h,
      ),
    ],
    h,
    "flex flex-col gap-2",
  );
};

/** Table view: one row per shared Round, one column per Dimension; a gap reads as "Too few answers". */
const roundsTable = <Message>(overview: TeamOverview, h: HtmlBuilder<Message>): Html => {
  const scoresByDimension = overview.dimensions.map(
    (dimension) =>
      new Map<string, number | null>(
        dimension.points.map((point): readonly [string, number | null] => [point.roundId, point.score]),
      ),
  );
  return dataTable(
    [message("overview.tableRoundDate"), ...overview.dimensions.map((d) => dimensionName(d.dimension))],
    overview.rounds.map((round) => [
      formatRoundDate(round.plannedOpenDate),
      ...scoresByDimension.map((scores) => {
        const score = scores.get(round.roundId) ?? null;
        return score !== null ? formatScore(score) : message("overview.gap");
      }),
    ]),
    h,
  );
};

const markersTable = <Message>(markers: ReadonlyArray<ActionMarker>, h: HtmlBuilder<Message>): Html =>
  dataTable(
    [message("overview.tableDate"), message("overview.tableAction"), message("overview.tableEvent")],
    markers.map((marker) => [
      formatDate(new Date(marker.at)),
      marker.title,
      message(marker.kind === "committed" ? "overview.event.committed" : "overview.event.done"),
    ]),
    h,
  );

/** A Round named by its Pulse and date. */
const roundName = (round: OverviewRound): string =>
  round.pulseName === undefined
    ? formatRoundDate(round.plannedOpenDate)
    : message("overview.recent.round", {
        pulse: round.pulseName,
        date: formatRoundDate(round.plannedOpenDate),
      });

/** The newest shared Round, linked: the one-click way into Results for everyone who may read them. */
const latestResults = <Message>(overview: TeamOverview, h: HtmlBuilder<Message>): Html | null => {
  const latest = overview.rounds[overview.rounds.length - 1];
  if (latest === undefined) return null;
  return panel(
    [
      subSectionTitle(message("overview.latest.title"), h, 2),
      h.p([h.Class("text-sm text-muted")], [roundName(latest)]),
      h.a(
        [h.Href(roundResultsHref(overview.teamId, latest.roundId)), h.Class(`mt-2 ${linkClass}`)],
        [message("overview.latest.action")],
      ),
    ],
    h,
    "flex flex-col gap-1",
  );
};

/** The newest shared Rounds, newest first, each linking to its Results. Only shared Rounds reach this list. */
const recentRounds = <Message>(overview: TeamOverview, h: HtmlBuilder<Message>): Html =>
  panel(
    [
      subSectionTitle(message("overview.recent.title"), h, 2),
      h.ul(
        [h.Class("mt-1 flex flex-col")],
        [...overview.rounds]
          .reverse()
          .slice(0, RECENT_ROUNDS)
          .map((round) =>
            h.li(
              [],
              [
                h.a(
                  [
                    h.Href(roundResultsHref(overview.teamId, round.roundId)),
                    h.Class(`inline-flex min-h-11 items-center ${linkClass}`),
                  ],
                  [roundName(round)],
                ),
              ],
            ),
          ),
      ),
    ],
    h,
    "mt-4 flex flex-col gap-1",
  );

/** The Team health overview on the Team page: Dimension trend lines with Action markers, or tables. */
export const teamOverviewView = <Message>(
  state: LoadedOverview,
  isTable: boolean,
  onToggleTable: Message,
  h: HtmlBuilder<Message>,
): Html => {
  if (state._tag === "Loading") {
    return h.p([h.Class("text-muted")], [message("overview.loading")]);
  }

  if (state._tag === "Failed") {
    // Organization admins outside the Team are refused; the page then simply shows no overview.
    if (state.failure === "Forbidden") return null;
    return problemView(state.failure, h);
  }

  const { overview } = state;
  if (overview.rounds.length === 0) {
    return h.section(
      [h.Class("flex flex-col gap-4")],
      [
        sectionTitle(message("overview.title"), h),
        emptyState({ title: message("overview.empty.title"), body: message("overview.empty") }, h),
      ],
    );
  }

  const { rounds: xByRound, markerX } = overviewXs(overview);
  const markerXs = overview.markers.map((marker) => markerX(marker.at));

  const latest = latestResults(overview, h);
  const children: Array<Html> = [
    sectionTitle(message("overview.title"), h),
    h.p([h.Class("text-muted")], [message("overview.intro")]),
    ...(latest === null ? [recentRounds(overview, h)] : [latest, recentRounds(overview, h)]),
    h.div([h.Class("flex justify-end")], [toggleButton(isTable, onToggleTable, h)]),
  ];

  if (isTable) {
    children.push(plotBox([roundsTable(overview, h)], h));
    if (overview.markers.length > 0) {
      children.push(plotBox([markersTable(overview.markers, h)], h));
    }
  } else {
    overview.dimensions.forEach((dimension, index) => {
      children.push(
        dimensionPanel(dimension, overview.rounds, xByRound, overview.markers, markerXs, index === 0, h),
      );
    });
    // No Dimension line to hang the markers on: keep them in their own row, aligned to the same axis.
    if (overview.dimensions.length === 0 && overview.markers.length > 0) {
      children.push(
        panel(
          [
            plotBox(
              [
                h.div([h.Class("relative h-8 w-full")], [markerOverlay(overview.markers, markerXs, true, h)]),
                legend(h),
              ],
              h,
            ),
          ],
          h,
          "flex flex-col gap-2",
        ),
      );
    }
  }

  return h.section([h.Class("flex flex-col gap-4")], children);
};
