import { Clock, Context, Effect, Option } from "effect";
import type { SendId } from "../email/Email.ts";
import type { DirectoryCommand, DirectoryRejection, FollowUp, Viewed } from "./Directory.ts";
import type { PersonId } from "./Identity.ts";
import type { OrganizationId } from "./Organization.ts";
import { Forbidden } from "./SignIn.ts";
import type { Member } from "./SignInFlow.ts";
import { IdentityProvider, PeopleIndex } from "./SignInPorts.ts";
import {
  LastAdmin,
  LastLead,
  type OrganizationSettings,
  PersonNotFound,
  type TeamDetail,
  type TeamId,
  TeamNameTaken,
  TeamNotFound,
  type TeamSummary,
} from "./Team.ts";

/** What the Organization's Durable Object answers to a command once it has committed it, or why not. */
export type CommandResult =
  | { readonly _tag: "Rejected"; readonly rejection: DirectoryRejection }
  /** The follow-ups to run, with `QueueEmail` only for sends that are still pending. */
  | { readonly _tag: "Accepted"; readonly followUps: ReadonlyArray<FollowUp> };

/**
 * The People, Teams, and Memberships of each Organization, as its Durable Object holds them
 * (ADR 0006). Every call authorizes the actor from that object's own data, in the same
 * transaction as the change, so a removed Person or an ended Membership is refused at once.
 */
export interface OrganizationDirectoryShape {
  readonly run: (
    organizationId: OrganizationId,
    actorId: PersonId,
    command: DirectoryCommand,
    now: number,
  ) => Effect.Effect<CommandResult>;
  readonly teams: (
    organizationId: OrganizationId,
    actorId: PersonId,
  ) => Effect.Effect<Viewed<ReadonlyArray<TeamSummary>>>;
  readonly team: (
    organizationId: OrganizationId,
    actorId: PersonId,
    teamId: TeamId,
  ) => Effect.Effect<Viewed<TeamDetail>>;
  readonly settings: (
    organizationId: OrganizationId,
    actorId: PersonId,
  ) => Effect.Effect<Viewed<OrganizationSettings>>;
}

export class OrganizationDirectory extends Context.Service<
  OrganizationDirectory,
  OrganizationDirectoryShape
>()("@surveybeat/domain/OrganizationDirectory") {}

/** Hands a pending send to the email Queue consumer. Delivery is idempotent per send, so repeats are safe. */
export class EmailOutbox extends Context.Service<
  EmailOutbox,
  { readonly queue: (organizationId: OrganizationId, sendId: SendId) => Effect.Effect<void> }
>()("@surveybeat/domain/EmailOutbox") {}

export type DirectoryError = Forbidden | TeamNotFound | PersonNotFound | LastLead | LastAdmin | TeamNameTaken;

const fail = (rejection: DirectoryRejection): Effect.Effect<never, DirectoryError> => {
  switch (rejection._tag) {
    case "Forbidden":
      return Effect.fail(new Forbidden());
    case "TeamNotFound":
      return Effect.fail(new TeamNotFound());
    case "PersonNotFound":
      return Effect.fail(new PersonNotFound());
    case "LastLead":
      return Effect.fail(new LastLead({ teamId: rejection.teamId }));
    case "LastAdmin":
      return Effect.fail(new LastAdmin());
    case "TeamNameTaken":
      return Effect.fail(new TeamNameTaken());
  }
};

const viewed = <A>(view: Viewed<A>): Effect.Effect<A, DirectoryError> =>
  view._tag === "Viewed" ? Effect.succeed(view.value) : fail(view.rejection);

/** Runs one follow-up. Each is idempotent, and a failure leaves the rest for the retry to do. */
const followUp = Effect.fnUntraced(function* (organizationId: OrganizationId, step: FollowUp) {
  const index = yield* PeopleIndex;
  const identityProvider = yield* IdentityProvider;
  const workosOrganization = index.workosOrganizationOf(organizationId);
  switch (step._tag) {
    case "IndexPerson":
      return yield* index.putPerson({
        organizationId,
        personId: step.person.id,
        email: step.person.email,
        userId: Option.fromNullishOr(step.person.workosUserId),
      });
    case "UnindexPerson":
      return yield* index.removePerson(organizationId, step.personId);
    case "DeactivateWorkosMembership": {
      const workos = yield* workosOrganization;
      if (Option.isSome(workos)) yield* identityProvider.deactivateMembership(step.userId, workos.value);
      return;
    }
    case "SetWorkosRole": {
      const workos = yield* workosOrganization;
      if (Option.isSome(workos))
        yield* identityProvider.setMembershipRole(step.userId, workos.value, step.role);
      return;
    }
    case "QueueEmail":
      return yield* (yield* EmailOutbox).queue(organizationId, step.sendId);
  }
});

/**
 * Runs a command as the signed-in Person: the Durable Object authorizes and commits it, then the
 * global index, WorkOS, and the email queue are put in step. Removal reaches WorkOS last, after
 * the Durable Object (which the per-request check asks) and the index already refuse the Person.
 * When WorkOS cannot be reached this fails `AuthUnavailable`; repeating the request finishes it.
 */
export const runDirectoryCommand = Effect.fnUntraced(function* (member: Member, command: DirectoryCommand) {
  const directory = yield* OrganizationDirectory;
  const organizationId = member.organization.id;
  const result = yield* directory.run(
    organizationId,
    member.personId,
    command,
    yield* Clock.currentTimeMillis,
  );
  if (result._tag === "Rejected") return yield* fail(result.rejection);
  for (const step of result.followUps) yield* followUp(organizationId, step);
});

export const viewTeams = (member: Member) =>
  Effect.flatMap(OrganizationDirectory, (directory) =>
    Effect.flatMap(directory.teams(member.organization.id, member.personId), viewed),
  );

export const viewTeam = (member: Member, teamId: TeamId) =>
  Effect.flatMap(OrganizationDirectory, (directory) =>
    Effect.flatMap(directory.team(member.organization.id, member.personId, teamId), viewed),
  );

export const viewSettings = (member: Member) =>
  Effect.flatMap(OrganizationDirectory, (directory) =>
    Effect.flatMap(directory.settings(member.organization.id, member.personId), viewed),
  );
