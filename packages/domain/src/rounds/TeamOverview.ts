import { Schema } from "effect";
import { ActionId, type ActionStatus } from "../actions/Action.ts";
import { TeamId } from "../people/Team.ts";
import { Dimension } from "../pulses/Question.ts";
import { RoundId } from "./Round.ts";
import { enforceEffectiveNOnResult, type RoundResult } from "./Results.ts";

/** One shared Round on the overview's time axis. */
export const OverviewRound = Schema.Struct({ roundId: RoundId, plannedOpenDate: Schema.String });
export type OverviewRound = typeof OverviewRound.Type;

/** A Dimension's score in one shared Round; null is a gap (below the effective minimum group size, or not asked). */
export const OverviewPoint = Schema.Struct({ roundId: RoundId, score: Schema.NullOr(Schema.Finite) });
export type OverviewPoint = typeof OverviewPoint.Type;

/** One Dimension's line across all shared Rounds, one point per Round in the same order. */
export const DimensionOverview = Schema.Struct({ dimension: Dimension, points: Schema.Array(OverviewPoint) });
export type DimensionOverview = typeof DimensionOverview.Type;

/** An Action committed or done, at that moment (epoch ms). */
export const ActionMarker = Schema.Struct({
  actionId: ActionId,
  title: Schema.String,
  kind: Schema.Literals(["committed", "done"]),
  at: Schema.Int,
});
export type ActionMarker = typeof ActionMarker.Type;

/** The Team health overview: one line per Dimension across all shared Rounds, plus Action markers. */
export const TeamOverview = Schema.Struct({
  teamId: TeamId,
  rounds: Schema.Array(OverviewRound),
  dimensions: Schema.Array(DimensionOverview),
  markers: Schema.Array(ActionMarker),
});
export type TeamOverview = typeof TeamOverview.Type;

/** The Action fields the overview reads. Actions have no minimum group size. */
export interface OverviewActionInput {
  readonly id: ActionId;
  readonly title: string;
  readonly status: ActionStatus;
  readonly createdAt: number;
  readonly doneAt: number | null;
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The point for one Dimension in one Round: a score only when the Round and the Dimension both meet N. */
const pointScore = (result: RoundResult, dimension: Dimension): number | null => {
  if (!result.meetsMinimumGroupSize) return null;
  const dimensionResult = result.dimensions.find((each) => each.dimension === dimension);
  if (dimensionResult === undefined || !dimensionResult.meetsMinimumGroupSize) return null;
  return dimensionResult.score;
};

/**
 * Builds the Team health overview from the stored Results of the Team's Rounds and its Actions.
 * Only shared Rounds appear. Each Result is enforced against the current minimum group size first
 * (ADR 0004), so a Round below its effective N, or one that was raised past, is a gap.
 */
export const buildTeamOverview = (params: {
  readonly teamId: TeamId;
  readonly results: ReadonlyArray<RoundResult>;
  readonly minimumGroupSize: number;
  readonly actions: ReadonlyArray<OverviewActionInput>;
}): TeamOverview => {
  const shared = params.results
    .filter((result) => result.status === "shared")
    .map((result) => enforceEffectiveNOnResult(result, params.minimumGroupSize))
    .sort(
      (a, b) => compareStrings(a.plannedOpenDate, b.plannedOpenDate) || compareStrings(a.roundId, b.roundId),
    );

  const dimensions: Array<DimensionOverview> = [];
  for (const dimension of Dimension.literals) {
    // A Result lists every Dimension, so "asked" is read from its Rating Questions: only those score a Dimension.
    const asked = shared.some((result) =>
      result.questions.some(
        (question) => question.dimension === dimension && question.type._tag === "Rating",
      ),
    );
    if (!asked) continue;
    dimensions.push({
      dimension,
      points: shared.map((result) => ({ roundId: result.roundId, score: pointScore(result, dimension) })),
    });
  }

  const markers: Array<ActionMarker> = [];
  for (const action of params.actions) {
    if (action.status !== "committed" && action.status !== "done") continue;
    markers.push({ actionId: action.id, title: action.title, kind: "committed", at: action.createdAt });
    if (action.status === "done" && action.doneAt !== null) {
      markers.push({ actionId: action.id, title: action.title, kind: "done", at: action.doneAt });
    }
  }
  markers.sort(
    (a, b) =>
      a.at - b.at ||
      Number(a.kind === "done") - Number(b.kind === "done") ||
      compareStrings(a.actionId, b.actionId),
  );

  return {
    teamId: params.teamId,
    rounds: shared.map((result) => ({ roundId: result.roundId, plannedOpenDate: result.plannedOpenDate })),
    dimensions,
    markers,
  };
};
