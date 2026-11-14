import { Clock, Context, Effect } from "effect";
import type { EmailAddress, SendId } from "../email/Email.ts";
import { EmailOutbox } from "../people/DirectoryFlow.ts";
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
  TestSendLimitReached,
  TestSendNotFound,
  type TestSendStatus,
} from "./Pulse.ts";

/** What the Organization's Durable Object answers to a Pulse command once committed, or why not. */
export type PulseCommandResult =
  | { readonly _tag: "Rejected"; readonly rejection: PulseRejection }
  | { readonly _tag: "Accepted" };

/**
 * What the Durable Object answers to a test send (ADR 0021): the send it recorded, and the address
 * it went to, which is the sender's own. Nothing about the token is returned.
 */
export type TestSendResult =
  | { readonly _tag: "Rejected"; readonly rejection: PulseRejection }
  | { readonly _tag: "Accepted"; readonly sendId: SendId; readonly email: EmailAddress };

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
  /** Records a test send to the actor's own address (ADR 0021). Nothing is delivered from here. */
  readonly sendTest: (
    organizationId: OrganizationId,
    actorId: PersonId,
    teamId: TeamId,
    pulseId: PulseId,
    now: number,
  ) => Effect.Effect<TestSendResult>;
  /**
   * The state of the actor's own test send of this Pulse, read from the Durable Object: the send's row and
   * its email's state. Read-only.
   */
  readonly testSend: (
    organizationId: OrganizationId,
    actorId: PersonId,
    teamId: TeamId,
    pulseId: PulseId,
    sendId: SendId,
    now: number,
  ) => Effect.Effect<PulseViewed<TestSendStatus>>;
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
  | OrderMismatch
  | TestSendLimitReached
  | TestSendNotFound;

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
    case "TestSendLimitReached":
      return Effect.fail(new TestSendLimitReached({ perHour: rejection.perHour }));
    case "TestSendNotFound":
      return Effect.fail(new TestSendNotFound());
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

/**
 * Sends the signed-in Person a test of a Pulse (ADR 0021). The Durable Object decides and records the
 * send; the email queue then delivers it, as for every other email.
 */
export const sendTestInvitation = Effect.fnUntraced(function* (
  member: Member,
  teamId: TeamId,
  pulseId: PulseId,
) {
  const pulses = yield* OrganizationPulses;
  const result = yield* pulses.sendTest(
    member.organization.id,
    member.personId,
    teamId,
    pulseId,
    yield* Clock.currentTimeMillis,
  );
  if (result._tag === "Rejected") return yield* fail(result.rejection);
  yield* (yield* EmailOutbox).queue(member.organization.id, result.sendId);
  return { email: result.email, sendId: result.sendId };
});

/**
 * How the test send the signed-in Person made is doing in the queue, for the Pulse editor to poll until it
 * settles. Only that Person's own test of that Pulse can be read; anything else is not found.
 */
export const viewTestInvitation = (member: Member, teamId: TeamId, pulseId: PulseId, sendId: SendId) =>
  Effect.gen(function* () {
    const pulses = yield* OrganizationPulses;
    return yield* Effect.flatMap(
      pulses.testSend(
        member.organization.id,
        member.personId,
        teamId,
        pulseId,
        sendId,
        yield* Clock.currentTimeMillis,
      ),
      viewed,
    );
  });
