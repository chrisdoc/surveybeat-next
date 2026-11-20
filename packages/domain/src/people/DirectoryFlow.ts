import { Clock, Context, Effect, Option } from "effect";
import type { SendId } from "../email/Email.ts";
import { EmailNotResendable, FailedEmailNotFound } from "../email/FailedEmails.ts";
import type { FailedEmailStatus, FailedEmails } from "../email/FailedEmails.ts";
import type { DirectoryCommand, DirectoryRejection, FollowUp, ResendResult, Viewed } from "./Directory.ts";
import type { PersonId } from "./Identity.ts";
import type { OrganizationId } from "./Organization.ts";
import { Forbidden } from "./SignIn.ts";
import type { CheckedSession, Member } from "./SignInFlow.ts";
import { PeopleIndex } from "./SignInPorts.ts";
import {
  ErasureNotConfirmed,
  LastAdmin,
  LastLead,
  PersonNotFound,
  PersonWasRemoved,
  TeamNameTaken,
  TeamNotFound,
} from "./Team.ts";
import type { OrganizationSettings, TeamDetail, TeamId, TeamSummary } from "./Team.ts";
import { OrganizationOffboarding } from "./Offboarding.ts";
import type { OrganizationOffboardingExport } from "./Offboarding.ts";

export type CommandResult =
  | { readonly _tag: "Rejected"; readonly rejection: DirectoryRejection }
  | { readonly _tag: "Accepted"; readonly followUps: readonly FollowUp[] };

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
  ) => Effect.Effect<Viewed<readonly TeamSummary[]>>;
  readonly team: (
    organizationId: OrganizationId,
    actorId: PersonId,
    teamId: TeamId,
  ) => Effect.Effect<Viewed<TeamDetail>>;
  readonly settings: (
    organizationId: OrganizationId,
    actorId: PersonId,
  ) => Effect.Effect<Viewed<OrganizationSettings>>;

  readonly failedEmails: (
    organizationId: OrganizationId,
    actorId: PersonId,
  ) => Effect.Effect<Viewed<FailedEmails>>;

  readonly resendFailedEmail: (
    organizationId: OrganizationId,
    actorId: PersonId,
    sendId: SendId,
    now: number,
  ) => Effect.Effect<ResendResult>;

  readonly emailStatus: (
    organizationId: OrganizationId,
    actorId: PersonId,
    sendId: SendId,
  ) => Effect.Effect<Viewed<FailedEmailStatus>>;

  readonly offboardingExport: (
    organizationId: OrganizationId,
    actorId: PersonId,
    now: number,
  ) => Effect.Effect<Viewed<OrganizationOffboardingExport>>;

  readonly confirmOffboarding: (
    organizationId: OrganizationId,
    actorId: PersonId,
    confirmation: string,
  ) => Effect.Effect<Viewed<null>>;

  readonly clearPersonErasure: (organizationId: OrganizationId, personId: PersonId) => Effect.Effect<void>;
}

export class OrganizationDirectory extends Context.Service<
  OrganizationDirectory,
  OrganizationDirectoryShape
>()("@surveybeat/domain/OrganizationDirectory") {}

export type DirectoryError =
  | Forbidden
  | TeamNotFound
  | PersonNotFound
  | PersonWasRemoved
  | LastLead
  | LastAdmin
  | ErasureNotConfirmed
  | TeamNameTaken
  | FailedEmailNotFound
  | EmailNotResendable;

const fail = (rejection: DirectoryRejection): Effect.Effect<never, DirectoryError> => {
  switch (rejection._tag) {
    case "Forbidden": {
      return Effect.fail(new Forbidden());
    }

    case "TeamNotFound": {
      return Effect.fail(new TeamNotFound());
    }

    case "PersonNotFound": {
      return Effect.fail(new PersonNotFound());
    }

    case "PersonWasRemoved": {
      return Effect.fail(new PersonWasRemoved());
    }

    case "LastLead": {
      return Effect.fail(new LastLead({ teamId: rejection.teamId }));
    }

    case "LastAdmin": {
      return Effect.fail(new LastAdmin());
    }

    case "ErasureNotConfirmed": {
      return Effect.fail(new ErasureNotConfirmed());
    }

    case "TeamNameTaken": {
      return Effect.fail(new TeamNameTaken());
    }

    case "FailedEmailNotFound": {
      return Effect.fail(new FailedEmailNotFound());
    }

    case "EmailNotResendable": {
      return Effect.fail(new EmailNotResendable());
    }
  }
};

const viewed = <A>(view: Viewed<A>): Effect.Effect<A, DirectoryError> =>
  view._tag === "Viewed" ? Effect.succeed(view.value) : fail(view.rejection);

const followUp = Effect.fnUntraced(function* (organizationId: OrganizationId, step: FollowUp) {
  const index = yield* PeopleIndex;

  switch (step._tag) {
    case "IndexPerson": {
      return yield* index.putPerson({
        organizationId,
        personId: step.person.id,
        email: step.person.email,
        userId: Option.fromNullishOr(step.person.authUserId),
      });
    }

    case "UnindexPerson": {
      return yield* index.removePerson(organizationId, step.personId);
    }

    case "ErasePersonIndex": {
      yield* index.erasePerson({
        organizationId,
        personId: step.person.id,
        userId: Option.fromNullishOr(step.person.authUserId),
        sendIds: step.sendIds,
        testTokenHashes: step.testTokenHashes,
      });

      return yield* (yield* OrganizationDirectory).clearPersonErasure(organizationId, step.person.id);
    }
  }
});

export const runDirectoryCommand = Effect.fnUntraced(function* (member: Member, command: DirectoryCommand) {
  const directory = yield* OrganizationDirectory;
  const organizationId = member.organization.id;

  const result = yield* directory.run(
    organizationId,
    member.personId,
    command,
    yield* Clock.currentTimeMillis,
  );

  if (result._tag === "Rejected") {
    return yield* fail(result.rejection);
  }

  for (const step of result.followUps) {
    yield* followUp(organizationId, step);
  }
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

export const resendFailedEmail = (member: Member, sendId: SendId) =>
  Effect.gen(function* () {
    const directory = yield* OrganizationDirectory;

    const result = yield* directory.resendFailedEmail(
      member.organization.id,
      member.personId,
      sendId,
      yield* Clock.currentTimeMillis,
    );

    if (result._tag === "Rejected") {
      return yield* fail(result.rejection);
    }

    return result.status;
  });

export const viewEmailStatus = (member: Member, sendId: SendId) =>
  Effect.flatMap(OrganizationDirectory, (directory) =>
    Effect.flatMap(directory.emailStatus(member.organization.id, member.personId, sendId), viewed),
  );

export const viewOffboardingExport = (member: Member) =>
  Effect.gen(function* () {
    const directory = yield* OrganizationDirectory;

    return yield* viewed(
      yield* directory.offboardingExport(
        member.organization.id,
        member.personId,
        yield* Clock.currentTimeMillis,
      ),
    );
  });

export const offboardOrganization = Effect.fnUntraced(function* (
  checked: CheckedSession,
  confirmation: string,
) {
  const offboarding = yield* OrganizationOffboarding;
  const userId = checked.session.identity.userId;
  const pending = yield* offboarding.pending(userId);

  const organizationId = Option.isSome(pending)
    ? pending.value
    : yield* Option.match(checked.member, {
        onSome: (member) =>
          Effect.gen(function* () {
            const directory = yield* OrganizationDirectory;

            const confirmed = yield* directory.confirmOffboarding(
              member.organization.id,
              member.personId,
              confirmation,
            );

            if (confirmed._tag === "Rejected") {
              return yield* fail(confirmed.rejection);
            }

            const owned = yield* offboarding.begin(
              member.organization.id,
              userId,
              yield* Clock.currentTimeMillis,
            );

            return owned ? member.organization.id : yield* new Forbidden();
          }),
        onNone: () => Effect.fail(new Forbidden()),
      });

  yield* offboarding.revokeAccess(organizationId);
  yield* offboarding.wipe(organizationId);

  const index = yield* PeopleIndex;

  for (const accountId of yield* offboarding.removeIndex(organizationId)) {
    yield* index.eraseAccount(accountId);
  }
});
