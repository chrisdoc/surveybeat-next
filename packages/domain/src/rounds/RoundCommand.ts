import type { DirectoryState, PersonRecord } from "../people/Directory.ts";
import type { PersonId } from "../people/Identity.ts";
import type { TeamId } from "../people/Team.ts";
import { findPulse } from "../pulses/Editor.ts";
import type { PulseRecord, PulseState } from "../pulses/Editor.ts";
import type { PulseId } from "../pulses/Pulse.ts";
import { authorizeRoundAction, nextEightWeeksCadenceDates, roundCommandRejection } from "./Lifecycle.ts";
import type { RoundCommand, RoundRecord, RoundRejection } from "./Lifecycle.ts";
import type { RoundId } from "./Round.ts";

export type RoundFacts = Pick<
  RoundRecord,
  "id" | "teamId" | "pulseId" | "status" | "effectiveMinimumGroupSize" | "plannedOpenAt"
>;

export interface RoundCommandInput {
  readonly directory: DirectoryState;
  readonly pulses: PulseState;
  readonly actorId: PersonId;
  readonly command: RoundCommand;
  readonly now: number;
  readonly round: RoundFacts | null;
  readonly invitation: { readonly resendCount: number } | null;
  readonly computePending: boolean;
}

export type RoundCommandPlan =
  | {
      readonly _tag: "SkipWeek";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
      readonly plannedOpenDate: string;
    }
  | {
      readonly _tag: "UnskipWeek";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
      readonly plannedOpenDate: string;
    }
  | { readonly _tag: "PausePulse"; readonly pulseId: PulseId }
  | { readonly _tag: "ResumePulse"; readonly teamId: TeamId; readonly pulseId: PulseId }
  | {
      readonly _tag: "CloseRoundEarly";
      readonly roundId: RoundId;
      readonly pulseId: PulseId;
      readonly effectiveN: number;
    }
  | { readonly _tag: "ShareResults"; readonly roundId: RoundId }
  | { readonly _tag: "RetryResult"; readonly roundId: RoundId }
  | { readonly _tag: "CancelRound"; readonly roundId: RoundId }
  | {
      readonly _tag: "ResendInvitation";
      readonly round: RoundFacts;
      readonly person: PersonRecord;
      readonly pulse: PulseRecord;
      readonly generation: number;
    };

export type RoundCommandDecision =
  | { readonly _tag: "Rejected"; readonly rejection: RoundRejection }
  | { readonly _tag: "Unchanged" }
  | { readonly _tag: "Apply"; readonly plan: RoundCommandPlan };

const rejected = (rejection: RoundRejection): RoundCommandDecision => ({ _tag: "Rejected", rejection });

const apply = (plan: RoundCommandPlan): RoundCommandDecision => ({ _tag: "Apply", plan });

const UNCHANGED: RoundCommandDecision = { _tag: "Unchanged" };

const roundOwnedBy = (round: RoundFacts | null, teamId: TeamId): RoundFacts | null =>
  round !== null && round.teamId === teamId ? round : null;

export const decideRoundCommand = (input: RoundCommandInput): RoundCommandDecision => {
  const { directory, pulses, actorId, command, now, invitation, computePending } = input;
  const auth = authorizeRoundAction(directory, actorId, "team.manageRounds", command.teamId);
  if (auth._tag === "Rejected") return rejected(auth.rejection);

  switch (command._tag) {
    case "SkipWeek": {
      const team = directory.teams.find((each) => each.id === command.teamId);
      const pulse = findPulse(pulses, command.teamId, command.pulseId);
      if (team === undefined) return rejected({ _tag: "TeamNotFound" });
      if (pulse === undefined) return rejected({ _tag: "PulseNotFound" });
      const validWeeks = nextEightWeeksCadenceDates(now, pulse.settings.cadence.day, team.timeZone);
      if (!validWeeks.includes(command.plannedOpenDate)) return rejected({ _tag: "WeekOutOfRange" });
      return apply({
        _tag: "SkipWeek",
        teamId: command.teamId,
        pulseId: command.pulseId,
        plannedOpenDate: command.plannedOpenDate,
      });
    }

    case "UnskipWeek": {
      if (findPulse(pulses, command.teamId, command.pulseId) === undefined)
        return rejected({ _tag: "PulseNotFound" });
      return apply({
        _tag: "UnskipWeek",
        teamId: command.teamId,
        pulseId: command.pulseId,
        plannedOpenDate: command.plannedOpenDate,
      });
    }

    case "PausePulse": {
      if (findPulse(pulses, command.teamId, command.pulseId) === undefined)
        return rejected({ _tag: "PulseNotFound" });
      return apply({ _tag: "PausePulse", pulseId: command.pulseId });
    }

    case "ResumePulse": {
      if (findPulse(pulses, command.teamId, command.pulseId) === undefined)
        return rejected({ _tag: "PulseNotFound" });
      return apply({ _tag: "ResumePulse", teamId: command.teamId, pulseId: command.pulseId });
    }

    case "CloseRoundEarly": {
      const round = roundOwnedBy(input.round, command.teamId);
      if (round === null) return rejected({ _tag: "RoundNotFound" });
      const rejection = roundCommandRejection(round.status, command);
      if (rejection !== null) return rejected(rejection);
      const effectiveN = Math.max(
        directory.minimumGroupSize,
        round.effectiveMinimumGroupSize ?? directory.minimumGroupSize,
      );
      return apply({ _tag: "CloseRoundEarly", roundId: round.id, pulseId: round.pulseId, effectiveN });
    }

    case "ShareResults": {
      const round = roundOwnedBy(input.round, command.teamId);
      if (round === null) return rejected({ _tag: "RoundNotFound" });
      if (auth.actor.roles.get(command.teamId) !== "lead") return rejected({ _tag: "Forbidden" });
      if (round.status === "shared") return UNCHANGED;
      const rejection = roundCommandRejection(round.status, command);
      if (rejection !== null) return rejected(rejection);
      return apply({ _tag: "ShareResults", roundId: round.id });
    }

    case "RetryResult": {
      const round = roundOwnedBy(input.round, command.teamId);
      if (round === null) return rejected({ _tag: "RoundNotFound" });
      if (auth.actor.roles.get(command.teamId) !== "lead") return rejected({ _tag: "Forbidden" });
      if (round.status === "ready" || round.status === "shared") return UNCHANGED;
      const rejection = roundCommandRejection(round.status, command);
      if (rejection !== null) return rejected(rejection);
      if (computePending) return UNCHANGED;
      return apply({ _tag: "RetryResult", roundId: round.id });
    }

    case "CancelRound": {
      const round = roundOwnedBy(input.round, command.teamId);
      if (round === null) return rejected({ _tag: "RoundNotFound" });
      const rejection = roundCommandRejection(round.status, command);
      if (rejection !== null) return rejected(rejection);
      return apply({ _tag: "CancelRound", roundId: round.id });
    }

    case "ResendInvitation": {
      const round = roundOwnedBy(input.round, command.teamId);
      if (round === null) return rejected({ _tag: "RoundNotFound" });
      const rejection = roundCommandRejection(round.status, command);
      if (rejection !== null) return rejected(rejection);
      if (invitation === null) return rejected({ _tag: "InvitationNotFound" });
      const person = directory.people.find((each) => each.id === command.personId);
      if (person === undefined || person.removedAt !== null) return rejected({ _tag: "InvitationNotFound" });
      const pulse = findPulse(pulses, round.teamId, round.pulseId);
      if (pulse === undefined) return rejected({ _tag: "PulseNotFound" });
      return apply({
        _tag: "ResendInvitation",
        round,
        person,
        pulse,
        generation: invitation.resendCount + 1,
      });
    }
  }
};
