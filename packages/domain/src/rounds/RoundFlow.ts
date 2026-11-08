import { Clock, Context, Effect } from "effect";
import type { PersonId } from "../people/Identity.ts";
import type { OrganizationId } from "../people/Organization.ts";
import { Forbidden } from "../people/SignIn.ts";
import type { Member } from "../people/SignInFlow.ts";
import { type TeamId, TeamNotFound } from "../people/Team.ts";
import { PulseNotFound, type PulseId } from "../pulses/Pulse.ts";
import type { RoundCommand, RoundRejection } from "./Lifecycle.ts";
import {
  InvalidRoundState,
  type RoundDetail,
  type RoundId,
  type RoundList,
  RoundNotFound,
  RoundNotOpen,
  WeekOutOfRange,
} from "./Round.ts";

export type RoundCommandResult =
  | { readonly _tag: "Rejected"; readonly rejection: RoundRejection }
  | { readonly _tag: "Accepted" };

export type RoundViewed<A> =
  | { readonly _tag: "Viewed"; readonly value: A }
  | { readonly _tag: "Rejected"; readonly rejection: RoundRejection };

export interface OrganizationRoundsShape {
  readonly run: (
    organizationId: OrganizationId,
    actorId: PersonId,
    command: RoundCommand,
    now: number,
  ) => Effect.Effect<RoundCommandResult>;
  readonly rounds: (
    organizationId: OrganizationId,
    actorId: PersonId,
    teamId: TeamId,
    pulseId: PulseId,
  ) => Effect.Effect<RoundViewed<RoundList>>;
  readonly round: (
    organizationId: OrganizationId,
    actorId: PersonId,
    teamId: TeamId,
    roundId: RoundId,
  ) => Effect.Effect<RoundViewed<RoundDetail>>;
}

export class OrganizationRounds extends Context.Service<OrganizationRounds, OrganizationRoundsShape>()(
  "@surveybeat/domain/OrganizationRounds",
) {}

export type RoundError =
  | Forbidden
  | TeamNotFound
  | PulseNotFound
  | RoundNotFound
  | RoundNotOpen
  | InvalidRoundState
  | WeekOutOfRange;

export const failRoundRejection = (rejection: RoundRejection): Effect.Effect<never, RoundError> => {
  switch (rejection._tag) {
    case "Forbidden":
      return Effect.fail(new Forbidden());
    case "TeamNotFound":
      return Effect.fail(new TeamNotFound());
    case "PulseNotFound":
      return Effect.fail(new PulseNotFound());
    case "RoundNotFound":
      return Effect.fail(new RoundNotFound());
    case "RoundNotOpen":
      return Effect.fail(new RoundNotOpen());
    case "InvalidRoundState":
      return Effect.fail(new InvalidRoundState({ status: rejection.status }));
    case "WeekOutOfRange":
      return Effect.fail(new WeekOutOfRange());
  }
};

const viewed = <A>(view: RoundViewed<A>): Effect.Effect<A, RoundError> =>
  view._tag === "Viewed" ? Effect.succeed(view.value) : failRoundRejection(view.rejection);

export const runRoundCommand = Effect.fnUntraced(function* (member: Member, command: RoundCommand) {
  const rounds = yield* OrganizationRounds;
  const result = yield* rounds.run(
    member.organization.id,
    member.personId,
    command,
    yield* Clock.currentTimeMillis,
  );
  if (result._tag === "Rejected") return yield* failRoundRejection(result.rejection);
});

export const viewRounds = (member: Member, teamId: TeamId, pulseId: PulseId) =>
  Effect.flatMap(OrganizationRounds, (rounds) =>
    Effect.flatMap(rounds.rounds(member.organization.id, member.personId, teamId, pulseId), viewed),
  );

export const viewRound = (member: Member, teamId: TeamId, roundId: RoundId) =>
  Effect.flatMap(OrganizationRounds, (rounds) =>
    Effect.flatMap(rounds.round(member.organization.id, member.personId, teamId, roundId), viewed),
  );
