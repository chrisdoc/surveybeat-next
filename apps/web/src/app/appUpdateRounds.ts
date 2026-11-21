import { Option } from "effect";
import type { Update } from "foldkit";
import type { Model, Message } from "./appModel.ts";
import {
  LoadSession,
  ListRoundsCmd,
  GetRoundDetailCmd,
  GetRoundRateCmd,
  SkipWeekCmd,
  PausePulseCmd,
  ResumePulseCmd,
  CloseRoundEarlyCmd,
  CancelRoundCmd,
  ResendInvitationCmd,
  ClearKeptAnswersCmd,
} from "./appCommands.ts";
import { isLead } from "./rounds.ts";

type RoundsMessage = Extract<
  Message,
  {
    _tag:
      | "GotRounds"
      | "GotRoundDetail"
      | "GotRoundRate"
      | "SkipDateChanged"
      | "SkipWeekClicked"
      | "SubmitSkipDate"
      | "PausePulseClicked"
      | "ResumePulseClicked"
      | "RoundConfirmRequested"
      | "RoundConfirmDismissed"
      | "RoundConfirmed"
      | "ResendInvitationClicked"
      | "RoundCommandDone"
      | "GotTeamOverview"
      | "GotMyHistory"
      | "ClearKeptAnswersClicked"
      | "ClearedKeptAnswers";
  }
>;

export const updateRounds = (model: Model, message: RoundsMessage): Update.Return<Model, Message> => {
  switch (message._tag) {
    case "GotRounds": {
      const { outcome } = message;

      if (outcome._tag === "Failure") {
        if (outcome.failure === "Unauthenticated") {
          return { model, commands: [LoadSession()] };
        }

        return { model: { ...model, rounds: { _tag: "Failed", failure: outcome.failure } } };
      }

      const lead = isLead(model.teamDetail);
      const commands = [];

      if (lead && model.route._tag === "Rounds") {
        const teamId = model.route.teamId;

        for (const round of outcome.list.rounds) {
          if (round.status === "open") {
            commands.push(GetRoundDetailCmd({ teamId, roundId: round.id }));
          } else if (round.status === "closed" || round.status === "ready" || round.status === "shared") {
            commands.push(GetRoundRateCmd({ teamId, roundId: round.id }));
          }
        }
      }

      return {
        model: {
          ...model,
          rounds: { _tag: "Loaded", list: outcome.list },
          homeRounds:
            model.route._tag === "Teams"
              ? { ...model.homeRounds, [outcome.list.pulseId]: outcome.list }
              : model.homeRounds,
        },
        commands,
      };
    }

    case "GotRoundDetail": {
      if (message.outcome._tag === "Failure") {
        return { model };
      }

      return {
        model: {
          ...model,
          roundDetails: { ...model.roundDetails, [message.roundId]: message.outcome.detail },
        },
      };
    }

    case "GotRoundRate": {
      if (message.outcome._tag === "Failure") {
        return { model };
      }

      return {
        model: {
          ...model,
          roundRates: { ...model.roundRates, [message.roundId]: message.outcome.result.responseRate },
        },
      };
    }

    case "SkipDateChanged": {
      return { model: { ...model, roundsSkipDate: message.date } };
    }

    case "SkipWeekClicked": {
      if (model.route._tag !== "Rounds") {
        return { model };
      }

      return {
        model: { ...model, roundsBusy: true, roundsFailure: Option.none() },
        commands: [
          SkipWeekCmd({
            teamId: model.route.teamId,
            pulseId: model.route.pulseId,
            plannedOpenDate: message.plannedOpenDate,
          }),
        ],
      };
    }

    case "SubmitSkipDate": {
      if (model.route._tag !== "Rounds" || model.roundsSkipDate.trim() === "") {
        return { model };
      }

      return {
        model: { ...model, roundsBusy: true, roundsFailure: Option.none() },
        commands: [
          SkipWeekCmd({
            teamId: model.route.teamId,
            pulseId: model.route.pulseId,
            plannedOpenDate: model.roundsSkipDate.trim(),
          }),
        ],
      };
    }

    case "PausePulseClicked": {
      if (model.route._tag !== "Rounds") {
        return { model };
      }

      return {
        model: { ...model, roundsBusy: true, roundsFailure: Option.none() },
        commands: [PausePulseCmd({ teamId: model.route.teamId, pulseId: model.route.pulseId })],
      };
    }

    case "ResumePulseClicked": {
      if (model.route._tag !== "Rounds") {
        return { model };
      }

      return {
        model: { ...model, roundsBusy: true, roundsFailure: Option.none() },
        commands: [ResumePulseCmd({ teamId: model.route.teamId, pulseId: model.route.pulseId })],
      };
    }

    case "RoundConfirmRequested": {
      return {
        model: {
          ...model,
          roundConfirm: Option.some({ kind: message.kind, roundId: message.roundId }),
          roundsFailure: Option.none(),
        },
      };
    }

    case "RoundConfirmDismissed": {
      return { model: { ...model, roundConfirm: Option.none() } };
    }

    case "RoundConfirmed": {
      if (model.route._tag !== "Rounds" || Option.isNone(model.roundConfirm)) {
        return { model };
      }

      const { kind, roundId } = model.roundConfirm.value;
      const teamId = model.route.teamId;

      return {
        model: { ...model, roundConfirm: Option.none(), roundsBusy: true, roundsFailure: Option.none() },
        commands: [
          kind === "close" ? CloseRoundEarlyCmd({ teamId, roundId }) : CancelRoundCmd({ teamId, roundId }),
        ],
      };
    }

    case "ResendInvitationClicked": {
      if (model.route._tag !== "Rounds") {
        return { model };
      }

      return {
        model: { ...model, roundsBusy: true, roundsFailure: Option.none() },
        commands: [
          ResendInvitationCmd({
            teamId: model.route.teamId,
            roundId: message.roundId,
            personId: message.personId,
          }),
        ],
      };
    }

    case "RoundCommandDone": {
      const { outcome } = message;

      if (outcome._tag === "Failure") {
        if (outcome.failure === "Unauthenticated") {
          return { model, commands: [LoadSession()] };
        }

        return { model: { ...model, roundsBusy: false, roundsFailure: Option.some(outcome.failure) } };
      }

      const reload =
        model.route._tag === "Rounds"
          ? [ListRoundsCmd({ teamId: model.route.teamId, pulseId: model.route.pulseId })]
          : [];

      return {
        model: { ...model, roundsBusy: false, roundDetails: {}, roundRates: {}, roundsSkipDate: "" },
        commands: reload,
      };
    }

    case "GotTeamOverview": {
      const { outcome } = message;

      if (outcome._tag === "Success") {
        const isCurrentTeam = model.route._tag === "Team" && model.route.teamId === outcome.overview.teamId;

        if (!isCurrentTeam) {
          return { model };
        }

        return {
          model: {
            ...model,
            teamOverview: { _tag: "Loaded", overview: outcome.overview },
          },
        };
      }

      return {
        model: {
          ...model,
          teamOverview: { _tag: "Failed", failure: outcome.failure },
        },
      };
    }

    case "GotMyHistory": {
      const { outcome } = message;

      if (outcome._tag === "Success") {
        if (model.route._tag !== "History") {
          return { model };
        }

        return {
          model: {
            ...model,
            history: { _tag: "Loaded", history: outcome.history, kept: outcome.kept, cleared: false },
          },
        };
      }

      if (outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: { ...model, history: { _tag: "Failed", failure: outcome.failure } },
      };
    }

    case "ClearKeptAnswersClicked": {
      if (model.history._tag !== "Loaded") {
        return { model };
      }

      return { model, commands: [ClearKeptAnswersCmd()] };
    }

    case "ClearedKeptAnswers": {
      if (model.history._tag !== "Loaded") {
        return { model };
      }

      return {
        model: { ...model, history: { ...model.history, kept: {}, cleared: true } },
      };
    }
  }
};
