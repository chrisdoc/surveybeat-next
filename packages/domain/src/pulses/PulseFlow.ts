import { Clock, Context, Effect } from "effect";
import type { EmailAddress, SendId } from "../email/Email.ts";
import type { PersonId } from "../people/Identity.ts";
import type { OrganizationId } from "../people/Organization.ts";
import { Forbidden } from "../people/SignIn.ts";
import type { Member } from "../people/SignInFlow.ts";
import { TeamNotFound } from "../people/Team.ts";
import type { TeamId } from "../people/Team.ts";
import type { PulseCommand, PulseRejection, PulseViewed } from "./Editor.ts";
import {
  OrderMismatch,
  PulseFull,
  PulseNeedsAQuestion,
  PulseNotFound,
  QuestionAlreadyInPulse,
  QuestionHasAnswers,
  QuestionNotFound,
  TestSendLimitReached,
  TestSendNotFound,
} from "./Pulse.ts";
import type { PulseDetail, PulseId, PulseList, TestSendStatus } from "./Pulse.ts";

export type PulseCommandResult =
  | { readonly _tag: "Rejected"; readonly rejection: PulseRejection }
  | { readonly _tag: "Accepted" };

export type TestSendResult =
  | { readonly _tag: "Rejected"; readonly rejection: PulseRejection }
  | { readonly _tag: "Accepted"; readonly sendId: SendId; readonly email: EmailAddress };

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

  readonly sendTest: (
    organizationId: OrganizationId,
    actorId: PersonId,
    teamId: TeamId,
    pulseId: PulseId,
    now: number,
  ) => Effect.Effect<TestSendResult>;

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
    case "Forbidden": {
      return Effect.fail(new Forbidden());
    }

    case "TeamNotFound": {
      return Effect.fail(new TeamNotFound());
    }

    case "PulseNotFound": {
      return Effect.fail(new PulseNotFound());
    }

    case "QuestionNotFound": {
      return Effect.fail(new QuestionNotFound());
    }

    case "QuestionAlreadyInPulse": {
      return Effect.fail(new QuestionAlreadyInPulse());
    }

    case "QuestionHasAnswers": {
      return Effect.fail(new QuestionHasAnswers());
    }

    case "PulseNeedsAQuestion": {
      return Effect.fail(new PulseNeedsAQuestion());
    }

    case "PulseFull": {
      return Effect.fail(new PulseFull({ maximum: rejection.maximum }));
    }

    case "OrderMismatch": {
      return Effect.fail(new OrderMismatch());
    }

    case "TestSendLimitReached": {
      return Effect.fail(new TestSendLimitReached({ perHour: rejection.perHour }));
    }

    case "TestSendNotFound": {
      return Effect.fail(new TestSendNotFound());
    }
  }
};

const viewed = <A>(view: PulseViewed<A>): Effect.Effect<A, PulseError> =>
  view._tag === "Viewed" ? Effect.succeed(view.value) : fail(view.rejection);

export const runPulseCommand = Effect.fnUntraced(function* (member: Member, command: PulseCommand) {
  const pulses = yield* OrganizationPulses;

  const result = yield* pulses.run(
    member.organization.id,
    member.personId,
    command,
    yield* Clock.currentTimeMillis,
  );

  if (result._tag === "Rejected") {
    return yield* fail(result.rejection);
  }
});

export const viewPulses = (member: Member, teamId: TeamId) =>
  Effect.flatMap(OrganizationPulses, (pulses) =>
    Effect.flatMap(pulses.pulses(member.organization.id, member.personId, teamId), viewed),
  );

export const viewPulse = (member: Member, teamId: TeamId, pulseId: PulseId) =>
  Effect.flatMap(OrganizationPulses, (pulses) =>
    Effect.flatMap(pulses.pulse(member.organization.id, member.personId, teamId, pulseId), viewed),
  );

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

  if (result._tag === "Rejected") {
    return yield* fail(result.rejection);
  }

  return { email: result.email, sendId: result.sendId };
});

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
