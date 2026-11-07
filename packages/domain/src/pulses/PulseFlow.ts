import { Clock, Context, Effect } from "effect";
import type { PersonId } from "../people/Identity.ts";
import type { OrganizationId } from "../people/Organization.ts";
import { Forbidden } from "../people/SignIn.ts";
import type { Member } from "../people/SignInFlow.ts";
import { type TeamId, TeamNotFound } from "../people/Team.ts";
import type { PulseCommand, PulseRejection, PulseViewed } from "./Editor.ts";
import {
  OrderMismatch,
  type PulseDetail,
  PulseFull,
  type PulseId,
  type PulseList,
  PulseNeedsAQuestion,
  PulseNotFound,
  QuestionAlreadyInPulse,
  QuestionHasAnswers,
  QuestionNotFound,
} from "./Pulse.ts";

/** What the Organization's Durable Object answers to a Pulse command once committed, or why not. */
export type PulseCommandResult =
  | { readonly _tag: "Rejected"; readonly rejection: PulseRejection }
  | { readonly _tag: "Accepted" };

/**
 * The question library and Pulses of each Organization, as its Durable Object holds them. Each
 * call authorizes the actor from that object's own data, in the same transaction as the change.
 */
export interface OrganizationPulsesShape {
  readonly run: (
    organizationId: OrganizationId,
    actorId: PersonId,
    command: PulseCommand,
    now: number,
  ) => Effect.Effect<PulseCommandResult>;
  readonly pulses: (
    organizationId: OrganizationId,
    actorId: PersonId,
    teamId: TeamId,
  ) => Effect.Effect<PulseViewed<PulseList>>;
  readonly pulse: (
    organizationId: OrganizationId,
    actorId: PersonId,
    teamId: TeamId,
    pulseId: PulseId,
  ) => Effect.Effect<PulseViewed<PulseDetail>>;
}

export class OrganizationPulses extends Context.Service<OrganizationPulses, OrganizationPulsesShape>()(
  "@surveybeat/domain/OrganizationPulses",
) {}

export type PulseError =
  | Forbidden
  | TeamNotFound
  | PulseNotFound
  | QuestionNotFound
  | QuestionAlreadyInPulse
  | QuestionHasAnswers
  | PulseNeedsAQuestion
  | PulseFull
  | OrderMismatch;

const fail = (rejection: PulseRejection): Effect.Effect<never, PulseError> => {
  switch (rejection._tag) {
    case "Forbidden":
      return Effect.fail(new Forbidden());
    case "TeamNotFound":
      return Effect.fail(new TeamNotFound());
    case "PulseNotFound":
      return Effect.fail(new PulseNotFound());
    case "QuestionNotFound":
      return Effect.fail(new QuestionNotFound());
    case "QuestionAlreadyInPulse":
      return Effect.fail(new QuestionAlreadyInPulse());
    case "QuestionHasAnswers":
      return Effect.fail(new QuestionHasAnswers());
    case "PulseNeedsAQuestion":
      return Effect.fail(new PulseNeedsAQuestion());
    case "PulseFull":
      return Effect.fail(new PulseFull({ maximum: rejection.maximum }));
    case "OrderMismatch":
      return Effect.fail(new OrderMismatch());
  }
};

const viewed = <A>(view: PulseViewed<A>): Effect.Effect<A, PulseError> =>
  view._tag === "Viewed" ? Effect.succeed(view.value) : fail(view.rejection);

/** Runs a Pulse editor command as the signed-in Person. Nothing outside the Organization follows. */
export const runPulseCommand = Effect.fnUntraced(function* (member: Member, command: PulseCommand) {
  const pulses = yield* OrganizationPulses;
  const result = yield* pulses.run(
    member.organization.id,
    member.personId,
    command,
    yield* Clock.currentTimeMillis,
  );
  if (result._tag === "Rejected") return yield* fail(result.rejection);
});

export const viewPulses = (member: Member, teamId: TeamId) =>
  Effect.flatMap(OrganizationPulses, (pulses) =>
    Effect.flatMap(pulses.pulses(member.organization.id, member.personId, teamId), viewed),
  );

export const viewPulse = (member: Member, teamId: TeamId, pulseId: PulseId) =>
  Effect.flatMap(OrganizationPulses, (pulses) =>
    Effect.flatMap(pulses.pulse(member.organization.id, member.personId, teamId, pulseId), viewed),
  );
