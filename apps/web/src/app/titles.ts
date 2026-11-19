import type { TeamId, TeamSummary } from "@surveybeat/domain";
import { message } from "../messages/locale.ts";
import type { LoadedTeam } from "./directory.ts";
import type { LoadedPulse, LoadedPulses } from "./pulses.ts";
import type { AppRoute } from "./routes.ts";

export interface TitleSource {
  readonly route: AppRoute;
  readonly organizationName: string;
  readonly organizationAdmin: boolean;
  readonly teamDetail: LoadedTeam;
  readonly pulses: LoadedPulses;
  readonly pulseDetail: LoadedPulse;
}

const documentTitle = (screen: string, context: string): string => message("title.page", { screen, context });

const teamNamed = (teamId: TeamId, team: TeamSummary | undefined): string | undefined =>
  team !== undefined && team.id === teamId ? team.name : undefined;

const detailTeam = (loaded: LoadedTeam): TeamSummary | undefined =>
  loaded._tag === "Loaded" ? loaded.detail.team : undefined;

const teamContext = (
  teamId: TeamId,
  candidates: readonly (TeamSummary | undefined)[],
  organization: string,
): string =>
  candidates.map((team) => teamNamed(teamId, team)).find((name) => name !== undefined) ?? organization;

export const screenTitle = (source: TitleSource): string => {
  const { organizationName: organization } = source;
  const route = source.route;

  switch (route._tag) {
    case "Teams":
    case "NotFound": {
      return documentTitle(message("teams.title"), organization);
    }

    case "Team": {
      const name = teamNamed(route.teamId, detailTeam(source.teamDetail));

      return documentTitle(name ?? message("title.team"), organization);
    }

    case "Pulses": {
      const listTeam = source.pulses._tag === "Loaded" ? source.pulses.pulses.team : undefined;
      const context = teamContext(route.teamId, [listTeam, detailTeam(source.teamDetail)], organization);

      return documentTitle(message("title.pulses"), context);
    }

    case "Pulse": {
      const { pulseDetail } = source;

      const detail =
        pulseDetail._tag === "Loaded" && pulseDetail.detail.id === route.pulseId
          ? pulseDetail.detail
          : undefined;

      const screen = detail !== undefined ? detail.settings.name : message("title.pulse");
      const context = teamContext(route.teamId, [detail?.team, detailTeam(source.teamDetail)], organization);

      return documentTitle(screen, context);
    }

    case "Rounds": {
      return documentTitle(
        message("rounds.title"),
        teamContext(route.teamId, [detailTeam(source.teamDetail)], organization),
      );
    }

    case "RoundResults": {
      return documentTitle(
        message("results.title"),
        teamContext(route.teamId, [detailTeam(source.teamDetail)], organization),
      );
    }

    case "History": {
      return documentTitle(message("history.title"), organization);
    }

    case "Settings": {
      return source.organizationAdmin
        ? documentTitle(message("settings.title"), organization)
        : documentTitle(message("teams.title"), organization);
    }

    case "Privacy": {
      return message("privacy.title");
    }
  }
};
