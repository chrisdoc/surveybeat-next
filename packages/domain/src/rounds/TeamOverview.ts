import { Schema } from "effect";
import { ActionId } from "../actions/Action.ts";
import type { ActionStatus } from "../actions/Action.ts";
import { TeamId } from "../people/Team.ts";
import { Dimension } from "../pulses/Question.ts";
import { RoundId } from "./Round.ts";
import { enforceEffectiveNOnResult } from "./Results.ts";
import type { RoundResult } from "./Results.ts";

export const OverviewRound = Schema.Struct({
  roundId: RoundId,
  plannedOpenDate: Schema.String,
  pulseName: Schema.optionalKey(Schema.String),
});
export type OverviewRound = typeof OverviewRound.Type;

export const OverviewPoint = Schema.Struct({ roundId: RoundId, score: Schema.NullOr(Schema.Finite) });
export type OverviewPoint = typeof OverviewPoint.Type;

export const DimensionOverview = Schema.Struct({ dimension: Dimension, points: Schema.Array(OverviewPoint) });
export type DimensionOverview = typeof DimensionOverview.Type;

export const ActionMarker = Schema.Struct({
  actionId: ActionId,
  title: Schema.String,
  kind: Schema.Literals(["committed", "done"]),
  at: Schema.Int,
});
export type ActionMarker = typeof ActionMarker.Type;

export const TeamOverview = Schema.Struct({
  teamId: TeamId,
  rounds: Schema.Array(OverviewRound),
  dimensions: Schema.Array(DimensionOverview),
  markers: Schema.Array(ActionMarker),
});
export type TeamOverview = typeof TeamOverview.Type;

export interface OverviewActionInput {
  readonly id: ActionId;
  readonly title: string;
  readonly status: ActionStatus;
  readonly createdAt: number;
  readonly doneAt: number | null;
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const pointScore = (result: RoundResult, dimension: Dimension): number | null => {
  if (!result.meetsMinimumGroupSize) return null;
  const dimensionResult = result.dimensions.find((each) => each.dimension === dimension);
  if (dimensionResult === undefined || !dimensionResult.meetsMinimumGroupSize) return null;
  return dimensionResult.score;
};

export const buildTeamOverview = (params: {
  readonly teamId: TeamId;
  readonly results: readonly RoundResult[];
  readonly minimumGroupSize: number;
  readonly actions: readonly OverviewActionInput[];
}): TeamOverview => {
  const shared = params.results
    .filter((result) => result.status === "shared")
    .map((result) => enforceEffectiveNOnResult(result, params.minimumGroupSize))
    .sort(
      (a, b) => compareStrings(a.plannedOpenDate, b.plannedOpenDate) || compareStrings(a.roundId, b.roundId),
    );

  const dimensions: DimensionOverview[] = [];
  for (const dimension of Dimension.literals) {
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

  const markers: ActionMarker[] = [];
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
    rounds: shared.map((result) => ({
      roundId: result.roundId,
      plannedOpenDate: result.plannedOpenDate,
      ...(result.pulseName !== undefined ? { pulseName: result.pulseName } : {}),
    })),
    dimensions,
    markers,
  };
};
