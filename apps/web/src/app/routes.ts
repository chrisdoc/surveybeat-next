import { PulseId, RoundId, TeamId } from "@surveybeat/domain";
import { pipe, Schema } from "effect";
import {
  defineRouteUnion,
  literal,
  mapTo,
  oneOf,
  parseUrlWithFallback,
  root,
  schemaSegment,
  slash,
} from "foldkit/route";
import type { Url } from "foldkit/url";

export const AppRoute = defineRouteUnion({
  Teams: {},
  Team: { teamId: TeamId },
  Pulses: { teamId: TeamId },
  Pulse: { teamId: TeamId, pulseId: PulseId },
  RoundResults: { teamId: TeamId, roundId: RoundId },
  Settings: {},
  NotFound: { path: Schema.String },
});
export type AppRoute = typeof AppRoute.Type;

export const teamsRouter = pipe(root, mapTo(AppRoute.Teams));
export const settingsRouter = pipe(literal("settings"), mapTo(AppRoute.Settings));
export const teamRouter = pipe(
  literal("teams"),
  slash(schemaSegment("teamId", TeamId)),
  mapTo(AppRoute.Team),
);
export const pulsesRouter = pipe(
  literal("teams"),
  slash(schemaSegment("teamId", TeamId)),
  slash(literal("pulses")),
  mapTo(AppRoute.Pulses),
);
export const pulseRouter = pipe(
  literal("teams"),
  slash(schemaSegment("teamId", TeamId)),
  slash(literal("pulses")),
  slash(schemaSegment("pulseId", PulseId)),
  mapTo(AppRoute.Pulse),
);
export const roundResultsRouter = pipe(
  literal("teams"),
  slash(schemaSegment("teamId", TeamId)),
  slash(literal("rounds")),
  slash(schemaSegment("roundId", RoundId)),
  mapTo(AppRoute.RoundResults),
);

export const appRouter = oneOf(
  roundResultsRouter,
  pulseRouter,
  pulsesRouter,
  teamRouter,
  settingsRouter,
  teamsRouter,
);
export const urlToAppRoute = (url: Url): AppRoute => parseUrlWithFallback(appRouter, AppRoute.NotFound)(url);

export const teamsHref = () => teamsRouter.build({});
export const settingsHref = () => settingsRouter.build({});
export const teamHref = (teamId: TeamId) => teamRouter.build({ teamId });
export const pulsesHref = (teamId: TeamId) => pulsesRouter.build({ teamId });
export const pulseHref = (teamId: TeamId, pulseId: PulseId) => pulseRouter.build({ teamId, pulseId });
export const roundResultsHref = (teamId: TeamId, roundId: RoundId) =>
  roundResultsRouter.build({ teamId, roundId });
