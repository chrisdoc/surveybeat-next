import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { TeamOverview } from "@surveybeat/domain";
import type { ActionMarker, DimensionOverview, OverviewRound, RoundId } from "@surveybeat/domain";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";
import { formatDate, formatRoundDate, formatScore, message } from "../messages/locale.ts";
import { Failure } from "./api.ts";
import { lineChart, plotPercent } from "./charts.ts";
import type { ChartPoint } from "./charts.ts";
import {
  dataTable,
  emptyState,
  buttonClass,
  panel,
  problemView,
  sectionTitle,
  subSectionTitle,
} from "./components.ts";
import { toggleButton } from "./results.ts";
import { dimensionName } from "./pulses.ts";
import { roundResultsHref } from "./routes.ts";

const RECENT_ROUNDS = 5;

export const LoadedOverview = defineTaggedUnion({
  Loading: {},
  Loaded: { overview: TeamOverview },
  Failed: { failure: Failure },
});

export type LoadedOverview = typeof LoadedOverview.Type;

const OVERVIEW_WIDTH = 360;

const plotBox = <Message>(children: readonly Html[], h: HtmlBuilder<Message>): Html =>
  h.div([h.Class("flex flex-col gap-2 rounded-control bg-subtle p-4")], children);

const eventGlyph = <Message>(kind: ActionMarker["kind"], h: HtmlBuilder<Message>): Html =>
  h.span([
    h.AriaHidden(true),
    h.Class(
      kind === "committed"
        ? "block size-3 shrink-0 rounded-full border-2 border-brass bg-surface"
        : "block size-3 shrink-0 rounded-full bg-primary",
    ),
  ]);

const markerText = (marker: ActionMarker): string =>
  message(marker.kind === "committed" ? "overview.marker.committed" : "overview.marker.done", {
    date: formatDate(DateTime.makeUnsafe(marker.at)),
    title: marker.title,
  });

const tooltipBaseClass =
  "pointer-events-none hidden absolute bottom-full z-10 mb-1 w-max max-w-[min(20rem,calc(100vw-2rem))] whitespace-normal rounded-control bg-evergreen px-2 py-1 text-xs text-on-primary group-hover:block group-focus-visible:block group-focus:block";

const tooltipAnchor = (x: number): string => {
  if (x < 0.15) {
    return "left-0";
  }

  if (x > 0.85) {
    return "right-0";
  }

  return "left-1/2 -translate-x-1/2";
};

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
  readonly rounds: ReadonlyMap<RoundId, number>;

  readonly markerX: (at: number) => number;
}

const plannedOpenMillis = (isoDate: string): number =>
  Option.match(DateTime.make(isoDate), { onNone: () => Number.NaN, onSome: DateTime.toEpochMillis });

export const overviewXs = (overview: TeamOverview): OverviewXs => {
  let tMin = Number.POSITIVE_INFINITY;
  let tMax = Number.NEGATIVE_INFINITY;

  for (const round of overview.rounds) {
    tMin = Math.min(tMin, plannedOpenMillis(round.plannedOpenDate));
    tMax = Math.max(tMax, plannedOpenMillis(round.plannedOpenDate));
  }

  for (const marker of overview.markers) {
    tMin = Math.min(tMin, marker.at);
    tMax = Math.max(tMax, marker.at);
  }

  const markerX = (at: number): number => {
    if (tMax === tMin) {
      return 0.5;
    }

    return Math.min(1, Math.max(0, (at - tMin) / (tMax - tMin)));
  };

  const rounds = new Map<RoundId, number>();

  for (const round of overview.rounds) {
    rounds.set(round.roundId, markerX(plannedOpenMillis(round.plannedOpenDate)));
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

const markerOverlay = <Message>(
  markers: readonly ActionMarker[],
  xs: readonly number[],
  interactive: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    interactive
      ? [h.Role("group"), h.AriaLabel(message("overview.markersLabel")), h.Class("absolute inset-0")]
      : [h.AriaHidden(true), h.Class("absolute inset-0")],
    markers.map((marker, i) => {
      const x = xs[i] ?? 0.5;

      if (interactive) {
        return markerButton(marker, x, h);
      }

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

const latestDimensionScore = (dimension: DimensionOverview): number | null => {
  for (let i = dimension.points.length - 1; i >= 0; i--) {
    const point = dimension.points[i]!;

    if (point.score !== null) {
      return point.score;
    }
  }

  return null;
};

const dimensionPanel = <Message>(
  dimension: DimensionOverview,
  rounds: readonly OverviewRound[],
  xByRound: ReadonlyMap<RoundId, number>,
  markers: readonly ActionMarker[],
  markerXs: readonly number[],
  interactive: boolean,
  h: HtmlBuilder<Message>,
): Html => {
  const name = dimensionName(dimension.dimension);
  const points: ChartPoint[] = [];

  for (const point of dimension.points) {
    const x = xByRound.get(point.roundId);

    if (x !== undefined) {
      points.push({ x, score: point.score, joinsPrevious: true });
    }
  }

  const first = rounds[0];
  const newest = rounds.at(-1);
  const latest = latestDimensionScore(dimension);

  return panel(
    [
      h.div(
        [h.Class("flex items-baseline justify-between gap-3")],
        [
          subSectionTitle(name, h),
          ...(latest === null
            ? []
            : [h.span([h.Class("font-display text-xl font-semibold tabular-nums")], [formatScore(latest)])]),
        ],
      ),
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

const markersTable = <Message>(markers: readonly ActionMarker[], h: HtmlBuilder<Message>): Html =>
  dataTable(
    [message("overview.tableDate"), message("overview.tableAction"), message("overview.tableEvent")],
    markers.map((marker) => [
      formatDate(DateTime.makeUnsafe(marker.at)),
      marker.title,
      message(marker.kind === "committed" ? "overview.event.committed" : "overview.event.done"),
    ]),
    h,
  );

const roundName = (round: OverviewRound): string =>
  round.pulseName === undefined
    ? formatRoundDate(round.plannedOpenDate)
    : message("overview.recent.round", {
        pulse: round.pulseName,
        date: formatRoundDate(round.plannedOpenDate),
      });

const latestResults = <Message>(overview: TeamOverview, h: HtmlBuilder<Message>): Html | null => {
  const latest = overview.rounds.at(-1);

  if (latest === undefined) {
    return null;
  }

  return panel(
    [
      subSectionTitle(message("overview.latest.title"), h, 2),
      h.p([h.Class("text-sm text-muted")], [roundName(latest)]),
      h.div(
        [h.Class("mt-auto pt-3")],
        [
          h.a(
            [h.Href(roundResultsHref(overview.teamId, latest.roundId)), h.Class(buttonClass)],
            [message("overview.latest.action")],
          ),
        ],
      ),
    ],
    h,
    "flex flex-col gap-1 border-l-4 border-l-primary",
  );
};

const recentRounds = <Message>(overview: TeamOverview, h: HtmlBuilder<Message>): Html =>
  panel(
    [
      subSectionTitle(message("overview.recent.title"), h, 2),
      h.ul(
        [h.Class("mt-1 flex flex-col divide-y divide-line-soft")],
        [...overview.rounds]
          .toReversed()
          .slice(0, RECENT_ROUNDS)
          .map((round) =>
            h.li(
              [],
              [
                h.a(
                  [
                    h.Href(roundResultsHref(overview.teamId, round.roundId)),
                    h.Class(
                      "flex min-h-11 items-center justify-between gap-3 text-[15px] font-medium text-ink transition-colors hover:text-primary",
                    ),
                  ],
                  [roundName(round), h.span([h.AriaHidden(true), h.Class("text-muted")], ["›"])],
                ),
              ],
            ),
          ),
      ),
    ],
    h,
    "flex flex-col gap-1",
  );

export const teamOverviewView = <Message>(
  state: LoadedOverview,
  isTable: boolean,
  onToggleTable: Message,
  h: HtmlBuilder<Message>,
): Html => {
  if (state._tag === "Loading") {
    return h.div(
      [h.Role("status"), h.Class("flex flex-col gap-3")],
      [
        h.span([h.Class("sr-only")], [message("overview.loading")]),
        h.div([h.AriaHidden(true), h.Class("skeleton h-8 w-64")]),
        h.div(
          [h.AriaHidden(true), h.Class("grid gap-4 lg:grid-cols-2")],
          [h.div([h.Class("skeleton h-56")]), h.div([h.Class("skeleton h-56")])],
        ),
      ],
    );
  }

  if (state._tag === "Failed") {
    if (state.failure === "Forbidden") {
      return null;
    }

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

  const charts: Html[] = [];

  const children: Html[] = [
    h.div(
      [h.Class("grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")],
      latest === null ? [recentRounds(overview, h)] : [latest, recentRounds(overview, h)],
    ),
    h.div(
      [h.Class("mt-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3")],
      [
        h.div(
          [h.Class("min-w-0")],
          [
            sectionTitle(message("overview.title"), h),
            h.p([h.Class("mt-1 max-w-[70ch] text-sm text-muted")], [message("overview.intro")]),
          ],
        ),
        toggleButton(isTable, onToggleTable, h),
      ],
    ),
  ];

  if (isTable) {
    children.push(plotBox([roundsTable(overview, h)], h));

    if (overview.markers.length > 0) {
      children.push(plotBox([markersTable(overview.markers, h)], h));
    }
  } else {
    overview.dimensions.forEach((dimension, index) => {
      charts.push(
        dimensionPanel(dimension, overview.rounds, xByRound, overview.markers, markerXs, index === 0, h),
      );
    });

    if (charts.length > 0) {
      children.push(h.div([h.Class("grid gap-4 lg:grid-cols-2")], charts));
    }

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
