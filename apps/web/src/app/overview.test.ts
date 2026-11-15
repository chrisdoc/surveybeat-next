// @effect-diagnostics globalDate:off -- the view formats or compares an instant that arrived from the API against the browser clock; nothing here is stored on the server.

import {
  ActionId,
  OrganizationId,
  RoundId,
  type TeamDetail,
  TeamId,
  type TeamOverview,
  TimeZone,
} from "@surveybeat/domain";
import { Option, Schema } from "effect";
import { type HtmlBuilder, inertHtml } from "foldkit/html";
import * as Scene from "foldkit/scene";
import { setup } from "foldkit/test/vitest";
import { fromString } from "foldkit/url";
import { describe, expect, it } from "vitest";
import { initialModel, update, view } from "./App.ts";
import { formatDate } from "../messages/locale.ts";
import { plotPercent } from "./charts.ts";
import { overviewXs, type LoadedOverview, teamOverviewView } from "./overview.ts";
import type { SessionModel } from "./session.ts";

setup();

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const ROUND_COUNT = 104;
const MARKER_COUNT = 30;
/** The budget for building the overview, in milliseconds. */
const BUDGET_MS = 1500;

const teamId = Schema.decodeSync(TeamId)("team-perf");
const dimensions = ["workload", "psychologicalSafety", "clarity", "recognition"] as const;

const makeUrl = (str: string) => Option.getOrThrow(fromString(str));

const signedInAdmin: SessionModel = {
  _tag: "SignedIn",
  organization: { id: Schema.decodeSync(OrganizationId)("org-perf"), name: "Acme" },
  organizationAdmin: true,
  locale: null,
  detectedLocale: null,
  organizationLocale: "en",
};

/** 104 weekly shared Rounds starting 2024-01-01, four Dimensions with every 9th point a gap, and 30 Action markers. */
const largeOverview = (): TeamOverview => {
  const start = Date.UTC(2024, 0, 1);
  const roundIds = Array.from({ length: ROUND_COUNT }, (_, i) =>
    Schema.decodeSync(RoundId)(`round-${String(i).padStart(3, "0")}`),
  );
  const rounds = roundIds.map((roundId, i) => ({
    roundId,
    plannedOpenDate: new Date(start + i * WEEK_MS).toISOString().slice(0, 10),
  }));
  const overviewDimensions = dimensions.map((dimension, d) => ({
    dimension,
    points: roundIds.map((roundId, i) => ({
      roundId,
      score: i % 9 === 0 ? null : 1 + ((i + d) % 5) * 0.8,
    })),
  }));
  const markers = Array.from({ length: MARKER_COUNT }, (_, k) => ({
    actionId: Schema.decodeSync(ActionId)(`action-${k}`),
    title: `Action ${k}`,
    kind: k % 2 === 0 ? ("committed" as const) : ("done" as const),
    at: start + k * 3 * WEEK_MS + 2 * DAY_MS,
  }));
  return { teamId, rounds, dimensions: overviewDimensions, markers };
};

const teamDetail: TeamDetail = {
  team: {
    id: teamId,
    name: "Performance",
    timeZone: Schema.decodeSync(TimeZone)("UTC"),
    yourRole: "lead",
  },
  roster: [],
  may: {
    update: false,
    manageLeads: false,
    manageMembers: false,
    managePulses: false,
    viewResults: true,
  },
};

const loadedTeam = { _tag: "Loaded" as const, detail: teamDetail };

describe("overviewXs", () => {
  const roundId = (id: string) => Schema.decodeSync(RoundId)(id);
  const threeRounds = (): TeamOverview => ({
    teamId,
    rounds: [
      { roundId: roundId("r-1"), plannedOpenDate: "2026-10-26" },
      { roundId: roundId("r-2"), plannedOpenDate: "2026-11-02" },
      { roundId: roundId("r-3"), plannedOpenDate: "2026-11-09" },
    ],
    dimensions: [],
    markers: [],
  });

  it("maps the first Round to 0 and the last Round to 1", () => {
    const { rounds } = overviewXs(threeRounds());
    expect(rounds.get(roundId("r-1"))).toBe(0);
    expect(rounds.get(roundId("r-2"))).toBeCloseTo(0.5, 10);
    expect(rounds.get(roundId("r-3"))).toBe(1);
  });

  it("extends the axis to a marker after the last Round, so the last Round sits before 1", () => {
    const overview = threeRounds();
    const after = Date.parse("2026-11-20");
    const withMarker: TeamOverview = {
      ...overview,
      markers: [
        {
          actionId: Schema.decodeSync(ActionId)("action-late"),
          title: "Late",
          kind: "committed",
          at: after,
        },
      ],
    };
    const { rounds, markerX } = overviewXs(withMarker);
    const last = rounds.get(roundId("r-3"));
    expect(last).toBeLessThan(1);
    expect(last).toBeGreaterThan(0);
    expect(markerX(after)).toBe(1);
  });

  it("places a single Round with no markers at the middle", () => {
    const { rounds } = overviewXs({
      teamId,
      rounds: [{ roundId: roundId("only"), plannedOpenDate: "2026-11-09" }],
      dimensions: [],
      markers: [],
    });
    expect(rounds.get(roundId("only"))).toBe(0.5);
  });

  it("clamps a marker time outside the Round range to the plot", () => {
    const { markerX } = overviewXs(threeRounds());
    expect(markerX(Date.parse("2020-01-01"))).toBe(0);
    expect(markerX(Date.parse("2030-01-01"))).toBe(1);
  });
});

describe("Team health overview markers and tooltips", () => {
  const roundId = (id: string) => Schema.decodeSync(RoundId)(id);
  const earliest = Date.parse("2026-10-26");
  const middle = Date.parse("2026-11-02");
  const latest = Date.parse("2026-11-09");
  const overview: TeamOverview = {
    teamId,
    rounds: [
      { roundId: roundId("r-1"), plannedOpenDate: "2026-10-26" },
      { roundId: roundId("r-2"), plannedOpenDate: "2026-11-02" },
      { roundId: roundId("r-3"), plannedOpenDate: "2026-11-09" },
    ],
    dimensions: [],
    markers: [
      {
        actionId: Schema.decodeSync(ActionId)("a-early"),
        title: "Early one",
        kind: "committed",
        at: earliest,
      },
      { actionId: Schema.decodeSync(ActionId)("a-mid"), title: "Middle one", kind: "done", at: middle },
      { actionId: Schema.decodeSync(ActionId)("a-late"), title: "Late one", kind: "committed", at: latest },
    ],
  };
  const teamUrl = makeUrl(`https://app.surveybeat.com/teams/${teamId}`);
  const markerLabel = (kind: "committed" | "done", at: number, title: string) =>
    `${kind === "committed" ? "Committed" : "Done"} ${formatDate(new Date(at))}: ${title}`;

  it("sets each marker button's left style to the plotPercent of its x", () => {
    const { markerX } = overviewXs(overview);
    Scene.scene(
      { update, view },
      Scene.given({
        ...initialModel(teamUrl),
        session: signedInAdmin,
        teamDetail: loadedTeam,
        teamOverview: { _tag: "Loaded", overview },
      }),
      Scene.expect(
        Scene.role("button", { name: markerLabel("committed", middle, "Middle one") }),
      ).toBeAbsent(),
      Scene.expect(Scene.role("button", { name: markerLabel("done", middle, "Middle one") })).toHaveStyle(
        "left",
        plotPercent(markerX(middle), 360),
      ),
      Scene.expect(
        Scene.role("button", { name: markerLabel("committed", earliest, "Early one") }),
      ).toHaveStyle("left", plotPercent(0, 360)),
      Scene.expect(Scene.role("button", { name: markerLabel("committed", latest, "Late one") })).toHaveStyle(
        "left",
        plotPercent(1, 360),
      ),
    );
  });

  it("anchors tooltips at the start and end of the axis and centres the rest", () => {
    Scene.scene(
      { update, view },
      Scene.given({
        ...initialModel(teamUrl),
        session: signedInAdmin,
        teamDetail: loadedTeam,
        teamOverview: { _tag: "Loaded", overview },
      }),
      Scene.expect(Scene.text(markerLabel("committed", earliest, "Early one"))).toHaveClass("left-0"),
      // A hidden tooltip takes no layout; `invisible` would still widen the page at narrow widths.
      Scene.expect(Scene.text(markerLabel("committed", earliest, "Early one"))).toHaveClass("hidden"),
      Scene.expect(Scene.text(markerLabel("committed", latest, "Late one"))).toHaveClass("right-0"),
      Scene.expect(Scene.text(markerLabel("done", middle, "Middle one"))).toHaveClass("-translate-x-1/2"),
    );
  });
});

describe("Team health overview build time", () => {
  const started = (): number => performance.now();

  it("guards the overview view's build time for 104 Rounds (virtual tree + scene)", () => {
    const overview = largeOverview();
    const chart: LoadedOverview = { _tag: "Loaded", overview };
    const h = inertHtml as unknown as HtmlBuilder<string>;

    // Virtual tree: build the view without mounting it, in chart and table mode.
    const treeStart = started();
    teamOverviewView(chart, false, "toggle", h);
    teamOverviewView(chart, true, "toggle", h);
    const treeElapsed = performance.now() - treeStart;
    expect(treeElapsed).toBeLessThan(BUDGET_MS);

    // Scene: the same data through the full App view, in chart mode.
    const sceneStart = started();
    Scene.scene(
      { update, view },
      Scene.given({
        ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}`)),
        session: signedInAdmin,
        teamDetail: loadedTeam,
        teamOverview: chart,
      }),
      Scene.expect(Scene.role("heading", { name: "Team health over time" })).toExist(),
      Scene.expectAll(Scene.all.role("img")).toHaveCount(dimensions.length),
    );
    const sceneElapsed = performance.now() - sceneStart;
    expect(sceneElapsed).toBeLessThan(BUDGET_MS);
  });

  it("builds the same data as tables within budget", () => {
    const elapsed = (() => {
      const begin = started();
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}`)),
          session: signedInAdmin,
          teamDetail: loadedTeam,
          teamOverview: { _tag: "Loaded", overview: largeOverview() },
          showTable: { overview: true },
        }),
        Scene.expect(Scene.role("heading", { name: "Team health over time" })).toExist(),
        Scene.expectAll(Scene.all.role("row")).toHaveCount(ROUND_COUNT + 1 + (MARKER_COUNT + 1)),
      );
      return performance.now() - begin;
    })();
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
