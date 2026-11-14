import { Clock, Context, Effect, Option } from "effect";
import type { SendId } from "../email/Email.ts";
import {
  EmailNotResendable,
  type FailedEmailStatus,
  FailedEmailNotFound,
  type FailedEmails,
} from "../email/FailedEmails.ts";
import type { DirectoryCommand, DirectoryRejection, FollowUp, ResendResult, Viewed } from "./Directory.ts";
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
  PersonWasRemoved,
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
  /** The most recent failed sends of the Organization, for its admins (ADR 0006). */
  readonly failedEmails: (
    organizationId: OrganizationId,
    actorId: PersonId,
  ) => Effect.Effect<Viewed<FailedEmails>>;
  /** An admin's Resend of a failed send: a failed send becomes pending again, under the same id (ADR 0006). */
  readonly resendFailedEmail: (
    organizationId: OrganizationId,
    actorId: PersonId,
    sendId: SendId,
    now: number,
  ) => Effect.Effect<ResendResult>;
  /** One send's status, for an admin polling after a Resend. */
  readonly emailStatus: (
    organizationId: OrganizationId,
    actorId: PersonId,
    sendId: SendId,
  ) => Effect.Effect<Viewed<FailedEmailStatus>>;
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

export type DirectoryError =
  | Forbidden
  | TeamNotFound
  | PersonNotFound
  | PersonWasRemoved
  | LastLead
  | LastAdmin
  | TeamNameTaken
  | FailedEmailNotFound
  | EmailNotResendable;

const fail = (rejection: DirectoryRejection): Effect.Effect<never, DirectoryError> => {
  switch (rejection._tag) {
    case "Forbidden":
      return Effect.fail(new Forbidden());
    case "TeamNotFound":
      return Effect.fail(new TeamNotFound());
    case "PersonNotFound":
      return Effect.fail(new PersonNotFound());
    case "PersonWasRemoved":
      return Effect.fail(new PersonWasRemoved());
    case "LastLead":
      return Effect.fail(new LastLead({ teamId: rejection.teamId }));
    case "LastAdmin":
      return Effect.fail(new LastAdmin());
    case "TeamNameTaken":
      return Effect.fail(new TeamNameTaken());
    case "FailedEmailNotFound":
      return Effect.fail(new FailedEmailNotFound());
    case "EmailNotResendable":
      return Effect.fail(new EmailNotResendable());
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

export const viewFailedEmails = (member: Member) =>
  Effect.flatMap(OrganizationDirectory, (directory) =>
    Effect.flatMap(directory.failedEmails(member.organization.id, member.personId), viewed),
  );

/**
 * An admin's Resend. The directory decides and moves the send to pending; only then is it handed to the email
 * queue, so a send is queued once per Resend.
 */
export const resendFailedEmail = (member: Member, sendId: SendId) =>
  Effect.gen(function* () {
    const directory = yield* OrganizationDirectory;
    const result = yield* directory.resendFailedEmail(
      member.organization.id,
      member.personId,
      sendId,
      yield* Clock.currentTimeMillis,
    );
    if (result._tag === "Rejected") return yield* fail(result.rejection);
    if (result.queue) yield* (yield* EmailOutbox).queue(member.organization.id, sendId);
    return result.status;
  });

export const viewEmailStatus = (member: Member, sendId: SendId) =>
  Effect.flatMap(OrganizationDirectory, (directory) =>
    Effect.flatMap(directory.emailStatus(member.organization.id, member.personId, sendId), viewed),
  );
