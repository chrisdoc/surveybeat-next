import { Popover } from "@foldkit/ui";
import type { RoundId } from "@surveybeat/domain";
import { Option } from "effect";
import { Update } from "foldkit";
import { message } from "../messages/locale.ts";
import type { Model } from "./appModel.ts";
import { Message } from "./appModel.ts";
import type { NavSection, AttentionItem, ChecklistStep } from "./directory.ts";
import { roundDate } from "./rounds.ts";
import type { AppRoute } from "./routes.ts";
import { pulseHref, pulsesHref, roundResultsHref, roundsHref, teamHref } from "./routes.ts";

export const attentionItems = (model: Model): readonly AttentionItem[] => {
  if (model.route._tag !== "Teams") {
    return [];
  }

  if (model.teams._tag !== "Loaded") {
    return [];
  }

  const items: AttentionItem[] = [];

  for (const team of model.teams.teams) {
    const pulses = model.homePulses[team.id];

    if (pulses !== undefined) {
      for (const pulse of pulses.pulses) {
        const rounds = model.homeRounds[pulse.id];

        if (rounds === undefined) {
          continue;
        }

        for (const round of rounds.rounds) {
          if (round.status === "closed" || round.status === "ready") {
            items.push({
              label: message("home.attention.share"),
              text: round.pulseName,
              detail: message("home.attention.shareDetail", {
                team: team.name,
                date: roundDate(round),
              }),
              href: roundResultsHref(team.id, round.id),
            });
          } else if (round.status === "open") {
            items.push({
              label: message("home.attention.open"),
              text: round.pulseName,
              detail: message("home.attention.openDetail", {
                team: team.name,
                date: roundDate(round),
              }),
              href: roundsHref(team.id, pulse.id),
            });
          }
        }
      }
    }

    const actions = model.homeActions[team.id];

    if (actions === undefined) {
      continue;
    }

    for (const action of actions) {
      if (action.status !== "committed") {
        continue;
      }

      items.push({
        label: message("home.attention.action"),
        text: action.title,
        detail: message("home.attention.actionDetail", {
          team: team.name,
          owner: action.ownerEmail ?? message("actions.formerMember"),
        }),
        href: roundResultsHref(team.id, action.roundId),
      });
    }
  }

  return items;
};

export const firstRunChecklist = (model: Model): readonly ChecklistStep[] | null => {
  const route = model.route;

  if (route._tag !== "Team") {
    return null;
  }

  if (model.teamDetail._tag !== "Loaded") {
    return null;
  }

  const detail = model.teamDetail.detail;

  if (!detail.may.managePulses) {
    return null;
  }

  if (model.pulses._tag !== "Loaded") {
    return null;
  }

  if (model.pulses.pulses.pulses.length > 0 && model.rounds._tag !== "Loaded") {
    return null;
  }

  const rounds = model.rounds._tag === "Loaded" ? model.rounds.list.rounds : [];

  if (rounds.some((round) => round.status !== "scheduled" && round.status !== "open")) {
    return null;
  }

  const firstPulse = model.pulses.pulses.pulses[0];
  const scheduled = rounds.find((round) => round.status === "scheduled" || round.status === "open");
  const members = detail.roster.length;

  return [
    {
      text: message("team.checklist.members"),
      detail: message("team.checklist.membersDetail", { count: String(members) }),
      href: teamHref(route.teamId),
      done: members > 0,
    },
    {
      text: message("team.checklist.pulse"),
      detail: message("team.checklist.pulseDetail"),
      href: pulsesHref(route.teamId),
      done: firstPulse !== undefined,
    },
    {
      text: message("team.checklist.test"),
      detail: message("team.checklist.testDetail"),
      href: firstPulse === undefined ? pulsesHref(route.teamId) : pulseHref(route.teamId, firstPulse.id),
      done: scheduled !== undefined,
    },
    {
      text:
        scheduled === undefined
          ? message("team.checklist.round")
          : message("team.checklist.roundScheduled", {
              date: roundDate(scheduled),
            }),
      href: firstPulse === undefined ? pulsesHref(route.teamId) : roundsHref(route.teamId, firstPulse.id),
      done: false,
    },
  ];
};

export const foldNavMenu = Update.foldChild({
  update: Popover.update,
  read: (model: Model) => Option.some(model.navMenu),
  write: (model: Model, navMenu: Popover.Model) => ({ ...model, navMenu }),
  toParentMessage: (message: Popover.Message) => Message.GotNavMenuMessage({ message }),
  foldOutMessage: () => (model: Model) => ({ model }),
});

export const foldAccountMenu = Update.foldChild({
  update: Popover.update,
  read: (model: Model) => Option.some(model.accountMenu),
  write: (model: Model, accountMenu: Popover.Model) => ({ ...model, accountMenu }),
  toParentMessage: (message: Popover.Message) => Message.GotAccountMenuMessage({ message }),
  foldOutMessage: () => (model: Model) => ({ model }),
});

export const closeHeaderMenus = (model: Model): Update.Return<Model, Message> => {
  const closedNav = foldNavMenu(model, Popover.Message.RequestedClose());
  const closedAccount = foldAccountMenu(closedNav.model, Popover.Message.RequestedClose());

  return {
    model: closedAccount.model,
    commands: [...(closedNav.commands ?? []), ...(closedAccount.commands ?? [])],
  };
};

export const navSectionOf = (route: AppRoute, organizationAdmin: boolean): NavSection | null => {
  switch (route._tag) {
    case "Teams":
    case "NotFound":
    case "Team":
    case "Pulses":
    case "Pulse":
    case "Rounds":
    case "RoundResults": {
      return "teams";
    }

    case "History": {
      return "history";
    }

    case "Settings": {
      return organizationAdmin ? "settings" : "teams";
    }

    case "Privacy": {
      return null;
    }
  }
};

export const isCurrentRoundNote = (model: Model, roundId: RoundId): boolean =>
  model.route._tag === "RoundResults" && model.route.roundId === roundId;
