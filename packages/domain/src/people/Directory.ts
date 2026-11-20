import { Option } from "effect";
import { EmailAddress, SendId } from "../email/Email.ts";
import type { TransactionalEmail } from "../email/Email.ts";
import type { FailedEmail, FailedEmails, FailedEmailStatus } from "../email/FailedEmails.ts";
import { normaliseEmail } from "./Identity.ts";
import type { PersonId, AuthUserId } from "./Identity.ts";
import { can } from "./Permissions.ts";
import type { Actor } from "./Permissions.ts";
import { resolveLocale } from "./Locale.ts";
import type { Locale } from "./Locale.ts";
import type {
  AssignableRole,
  MembershipId,
  MembershipRole,
  OrganizationSettings,
  TeamDetail,
  TeamId,
  TeamSummary,
  TimeZone,
} from "./Team.ts";

export interface PersonRecord {
  readonly id: PersonId;
  readonly email: EmailAddress;
  readonly authUserId: AuthUserId | null;
  readonly organizationAdmin: boolean;

  readonly removedAt: number | null;

  readonly erasedAt: number | null;

  readonly locale: Locale | null;

  readonly detectedLocale: Locale | null;
}

export interface TeamRecord {
  readonly id: TeamId;
  readonly name: string;
  readonly timeZone: TimeZone;
}

export interface MembershipRecord {
  readonly id: MembershipId;
  readonly teamId: TeamId;
  readonly personId: PersonId;
  readonly role: MembershipRole;
  readonly startedAt: number;

  readonly endedAt: number | null;
}

export interface DirectoryState {
  readonly organizationName: string;
  readonly minimumGroupSize: number;

  readonly aiProcessing: boolean;

  readonly defaultLocale: Locale;
  readonly people: readonly PersonRecord[];
  readonly teams: readonly TeamRecord[];
  readonly memberships: readonly MembershipRecord[];
}

export interface NewMember {
  readonly email: EmailAddress;
  readonly personId: PersonId;
  readonly membershipId: MembershipId;

  readonly signInUrl: string;
}

export type DirectoryCommand =
  | {
      readonly _tag: "CreateTeam";
      readonly teamId: TeamId;
      readonly name: string;
      readonly timeZone: TimeZone;
      readonly lead: NewMember;
    }
  | {
      readonly _tag: "UpdateTeam";
      readonly teamId: TeamId;
      readonly name: string;
      readonly timeZone: TimeZone;
    }
  | {
      readonly _tag: "AddMember";
      readonly teamId: TeamId;
      readonly role: AssignableRole;
      readonly member: NewMember;
    }
  | { readonly _tag: "RemoveMember"; readonly teamId: TeamId; readonly personId: PersonId }
  | {
      readonly _tag: "RemoveLead";
      readonly teamId: TeamId;
      readonly personId: PersonId;
      readonly membershipId: MembershipId;
    }
  | { readonly _tag: "RemovePerson"; readonly personId: PersonId }
  | {
      readonly _tag: "ErasePerson";
      readonly personId: PersonId;
      readonly confirmation: EmailAddress;
    }
  | { readonly _tag: "SetAdmin"; readonly personId: PersonId; readonly organizationAdmin: boolean }
  | {
      readonly _tag: "UpdateSettings";
      readonly minimumGroupSize?: number | undefined;
      readonly aiProcessing?: boolean | undefined;
      readonly defaultLocale?: Locale | undefined;
    }
  | {
      readonly _tag: "UpdateOwnLanguage";
      readonly locale?: Locale | null | undefined;
      readonly detectedLocale?: Locale | undefined;
    };

export type DirectoryChange =
  | { readonly _tag: "PersonAdded"; readonly person: PersonRecord }
  | { readonly _tag: "PersonRestored"; readonly personId: PersonId }
  | { readonly _tag: "PersonRemoved"; readonly personId: PersonId; readonly at: number }
  | { readonly _tag: "PersonErased"; readonly personId: PersonId; readonly at: number }
  | { readonly _tag: "AdminSet"; readonly personId: PersonId; readonly organizationAdmin: boolean }
  | { readonly _tag: "TeamAdded"; readonly team: TeamRecord }
  | { readonly _tag: "TeamUpdated"; readonly team: TeamRecord }
  | { readonly _tag: "MembershipStarted"; readonly membership: MembershipRecord }
  | { readonly _tag: "MembershipEnded"; readonly membershipId: MembershipId; readonly at: number }
  | {
      readonly _tag: "SettingsUpdated";
      readonly minimumGroupSize: number;
      readonly aiProcessing: boolean;
      readonly defaultLocale: Locale;
    }
  | {
      readonly _tag: "PersonLanguageSet";
      readonly personId: PersonId;
      readonly locale: Locale | null;
      readonly detectedLocale: Locale | null;
    }
  | {
      readonly _tag: "EmailRequested";
      readonly sendId: SendId;
      readonly recipient: EmailAddress;
      readonly email: TransactionalEmail;
    };

export interface PersonRef {
  readonly id: PersonId;
  readonly email: EmailAddress;
  readonly authUserId: AuthUserId | null;
}

export interface ErasedPersonFacts {
  readonly person: PersonRef;
  readonly sendIds: readonly SendId[];
  readonly testTokenHashes: readonly string[];
}

export type FollowUp =
  | { readonly _tag: "IndexPerson"; readonly person: PersonRef }
  | { readonly _tag: "UnindexPerson"; readonly personId: PersonId }
  | ({ readonly _tag: "ErasePersonIndex" } & ErasedPersonFacts);

export type DirectoryRejection =
  | { readonly _tag: "Forbidden" }
  | { readonly _tag: "TeamNotFound" }
  | { readonly _tag: "PersonNotFound" }
  | { readonly _tag: "PersonWasRemoved" }
  | { readonly _tag: "LastLead"; readonly teamId: TeamId }
  | { readonly _tag: "LastAdmin" }
  | { readonly _tag: "ErasureNotConfirmed" }
  | { readonly _tag: "TeamNameTaken" }
  | { readonly _tag: "FailedEmailNotFound" }
  | { readonly _tag: "EmailNotResendable" };

export type Decision =
  | { readonly _tag: "Rejected"; readonly rejection: DirectoryRejection }
  | {
      readonly _tag: "Accepted";
      readonly changes: readonly DirectoryChange[];
      readonly followUps: readonly FollowUp[];
    };

export type Viewed<A> =
  | { readonly _tag: "Viewed"; readonly value: A }
  | { readonly _tag: "Rejected"; readonly rejection: DirectoryRejection };

export type ResendResult =
  | { readonly _tag: "Rejected"; readonly rejection: DirectoryRejection }
  | { readonly _tag: "Accepted"; readonly status: FailedEmailStatus };

const reject = (
  rejection: DirectoryRejection,
): { readonly _tag: "Rejected"; readonly rejection: DirectoryRejection } => ({
  _tag: "Rejected",
  rejection,
});

const forbidden = reject({ _tag: "Forbidden" });

const accept = (changes: readonly DirectoryChange[], followUps: readonly FollowUp[] = []): Decision => ({
  _tag: "Accepted",
  changes,
  followUps,
});

export const erasedEmailOf = (personId: PersonId): EmailAddress =>
  EmailAddress.make(`erased-${personId}@erased.invalid`.toLowerCase());

export const addedEmailSendId = (membershipId: MembershipId): SendId => SendId.make(`added-${membershipId}`);

const isActive = (membership: MembershipRecord) => membership.endedAt === null;

const activePeople = (state: DirectoryState) => state.people.filter((person) => person.removedAt === null);

const activeMemberships = (state: DirectoryState, teamId: TeamId) =>
  state.memberships.filter((membership) => membership.teamId === teamId && isActive(membership));

const activeMembershipOf = (state: DirectoryState, teamId: TeamId, personId: PersonId) =>
  activeMemberships(state, teamId).find((membership) => membership.personId === personId);

const leadsOf = (state: DirectoryState, teamId: TeamId) =>
  activeMemberships(state, teamId).filter((membership) => membership.role === "lead");

const findTeam = (state: DirectoryState, teamId: TeamId) => state.teams.find((team) => team.id === teamId);

const refOf = (person: PersonRecord): PersonRef => ({
  id: person.id,
  email: person.email,
  authUserId: person.authUserId,
});

export const actorOf = (state: DirectoryState, personId: PersonId): Option.Option<Actor> => {
  const person = state.people.find((each) => each.id === personId && each.removedAt === null);

  if (person === undefined) {
    return Option.none();
  }

  const roles = new Map<TeamId, MembershipRole>();

  for (const membership of state.memberships) {
    if (membership.personId === personId && isActive(membership)) {
      roles.set(membership.teamId, membership.role);
    }
  }

  return Option.some({ personId, organizationAdmin: person.organizationAdmin, roles });
};

export const emailLocaleOf = (state: DirectoryState, personId: PersonId): Locale => {
  const person = state.people.find((each) => each.id === personId);

  if (person === undefined) {
    return state.defaultLocale;
  }

  return resolveLocale({
    person: person.locale,
    browser: person.detectedLocale,
    organization: state.defaultLocale,
  });
};

const nameTaken = (state: DirectoryState, name: string, except?: TeamId) =>
  state.teams.some(
    (team) => team.id !== except && team.name.toLocaleLowerCase("en") === name.toLocaleLowerCase("en"),
  );

const putInTeam = (
  state: DirectoryState,
  adder: PersonRecord,
  team: TeamRecord,
  role: AssignableRole,
  member: NewMember,
  now: number,
): Decision => {
  const email = EmailAddress.make(normaliseEmail(member.email));
  const existing = state.people.find((person) => person.email === email);

  if (existing !== undefined && existing.removedAt !== null && !adder.organizationAdmin) {
    return reject({ _tag: "PersonWasRemoved" });
  }

  const person: PersonRecord = existing ?? {
    id: member.personId,
    email,
    authUserId: null,
    organizationAdmin: false,
    removedAt: null,
    erasedAt: null,
    locale: null,
    detectedLocale: null,
  };

  const changes: DirectoryChange[] = [];

  if (existing === undefined) {
    changes.push({ _tag: "PersonAdded", person });
  } else if (existing.removedAt !== null) {
    changes.push({ _tag: "PersonRestored", personId: existing.id });
  }

  const index: FollowUp = { _tag: "IndexPerson", person: refOf(person) };
  const current = existing === undefined ? undefined : activeMembershipOf(state, team.id, existing.id);

  if (current !== undefined && (current.role === role || current.role === "lead")) {
    return accept(changes, [index]);
  }

  const membership: MembershipRecord = {
    id: member.membershipId,
    teamId: team.id,
    personId: person.id,
    role,
    startedAt: now,
    endedAt: null,
  };

  if (current !== undefined) {
    changes.push(
      { _tag: "MembershipEnded", membershipId: current.id, at: now },
      { _tag: "MembershipStarted", membership },
    );

    return accept(changes, [index]);
  }

  const sendId = addedEmailSendId(membership.id);
  changes.push(
    { _tag: "MembershipStarted", membership },
    {
      _tag: "EmailRequested",
      sendId,
      recipient: person.email,
      email: {
        _tag: "AddedToTeam",
        locale: emailLocaleOf(state, person.id),
        teamName: team.name,
        leadName: adder.email,
        signInUrl: member.signInUrl,
      },
    },
  );

  return accept(changes, [index]);
};

export const decide = (
  state: DirectoryState,
  actorId: PersonId,
  command: DirectoryCommand,
  now: number,
): Decision => {
  const actor = actorOf(state, actorId);
  const adder = state.people.find((person) => person.id === actorId);

  if (Option.isNone(actor) || adder === undefined) {
    return forbidden;
  }

  const allowed = actor.value;
  const organization = { _tag: "Organization" } as const;

  switch (command._tag) {
    case "CreateTeam": {
      if (!can(allowed, "organization.createTeam", organization)) {
        return forbidden;
      }

      if (nameTaken(state, command.name)) {
        return reject({ _tag: "TeamNameTaken" });
      }

      const team: TeamRecord = { id: command.teamId, name: command.name, timeZone: command.timeZone };

      if (findTeam(state, team.id) !== undefined) {
        return reject({ _tag: "TeamNameTaken" });
      }

      const withTeam: DirectoryState = { ...state, teams: [...state.teams, team] };
      const lead = putInTeam(withTeam, adder, team, "lead", command.lead, now);

      if (lead._tag === "Rejected") {
        return lead;
      }

      return accept([{ _tag: "TeamAdded", team }, ...lead.changes], lead.followUps);
    }

    case "UpdateTeam": {
      if (!can(allowed, "team.update", { _tag: "Team", teamId: command.teamId })) {
        return forbidden;
      }

      if (findTeam(state, command.teamId) === undefined) {
        return reject({ _tag: "TeamNotFound" });
      }

      if (nameTaken(state, command.name, command.teamId)) {
        return reject({ _tag: "TeamNameTaken" });
      }

      return accept([
        { _tag: "TeamUpdated", team: { id: command.teamId, name: command.name, timeZone: command.timeZone } },
      ]);
    }

    case "AddMember": {
      const action = command.role === "lead" ? "team.assignLead" : "team.addMember";

      if (!can(allowed, action, { _tag: "Team", teamId: command.teamId })) {
        return forbidden;
      }

      const team = findTeam(state, command.teamId);

      if (team === undefined) {
        return reject({ _tag: "TeamNotFound" });
      }

      return putInTeam(state, adder, team, command.role, command.member, now);
    }

    case "RemoveMember": {
      const resource = { _tag: "Team", teamId: command.teamId } as const;

      if (!can(allowed, "team.removeMember", resource)) {
        return forbidden;
      }

      if (findTeam(state, command.teamId) === undefined) {
        return reject({ _tag: "TeamNotFound" });
      }

      const membership = activeMembershipOf(state, command.teamId, command.personId);

      if (membership === undefined) {
        return reject({ _tag: "PersonNotFound" });
      }

      if (membership.role === "lead") {
        if (!can(allowed, "team.removeLead", resource)) {
          return forbidden;
        }

        if (leadsOf(state, command.teamId).length <= 1) {
          return reject({ _tag: "LastLead", teamId: command.teamId });
        }
      }

      return accept([{ _tag: "MembershipEnded", membershipId: membership.id, at: now }]);
    }

    case "RemoveLead": {
      if (!can(allowed, "team.removeLead", { _tag: "Team", teamId: command.teamId })) {
        return forbidden;
      }

      if (findTeam(state, command.teamId) === undefined) {
        return reject({ _tag: "TeamNotFound" });
      }

      const membership = activeMembershipOf(state, command.teamId, command.personId);

      if (membership?.role !== "lead") {
        return reject({ _tag: "PersonNotFound" });
      }

      if (leadsOf(state, command.teamId).length <= 1) {
        return reject({ _tag: "LastLead", teamId: command.teamId });
      }

      return accept([
        { _tag: "MembershipEnded", membershipId: membership.id, at: now },
        {
          _tag: "MembershipStarted",
          membership: {
            id: command.membershipId,
            teamId: command.teamId,
            personId: command.personId,
            role: "member",
            startedAt: now,
            endedAt: null,
          },
        },
      ]);
    }

    case "RemovePerson": {
      if (!can(allowed, "organization.removePerson", organization)) {
        return forbidden;
      }

      if (command.personId === actorId) {
        return forbidden;
      }

      const person = state.people.find((each) => each.id === command.personId);

      if (person === undefined) {
        return reject({ _tag: "PersonNotFound" });
      }

      const followUps: FollowUp[] = [{ _tag: "UnindexPerson", personId: person.id }];

      if (person.removedAt !== null) {
        return accept([], followUps);
      }

      const memberships = state.memberships.filter(
        (membership) => membership.personId === person.id && isActive(membership),
      );

      for (const membership of memberships) {
        if (membership.role === "lead" && leadsOf(state, membership.teamId).length <= 1) {
          return reject({ _tag: "LastLead", teamId: membership.teamId });
        }
      }

      if (
        person.organizationAdmin &&
        activePeople(state).filter((each) => each.organizationAdmin).length <= 1
      ) {
        return reject({ _tag: "LastAdmin" });
      }

      const changes: DirectoryChange[] = memberships.map((membership) => ({
        _tag: "MembershipEnded",
        membershipId: membership.id,
        at: now,
      }));

      if (person.organizationAdmin) {
        changes.push({ _tag: "AdminSet", personId: person.id, organizationAdmin: false });
      }

      changes.push({ _tag: "PersonRemoved", personId: person.id, at: now });

      return accept(changes, followUps);
    }

    case "ErasePerson": {
      const person = state.people.find((each) => each.id === command.personId);

      if (command.personId !== actorId && !can(allowed, "organization.removePerson", organization)) {
        return forbidden;
      }

      if (person === undefined) {
        return reject({ _tag: "PersonNotFound" });
      }

      const followUp: FollowUp = {
        _tag: "ErasePersonIndex",
        person: refOf(person),
        sendIds: [],
        testTokenHashes: [],
      };

      if (person.erasedAt !== null) {
        return accept([], [followUp]);
      }

      if (normaliseEmail(command.confirmation) !== person.email) {
        return reject({ _tag: "ErasureNotConfirmed" });
      }

      const memberships = state.memberships.filter(
        (membership) => membership.personId === person.id && isActive(membership),
      );

      for (const membership of memberships) {
        if (membership.role === "lead" && leadsOf(state, membership.teamId).length <= 1) {
          return reject({ _tag: "LastLead", teamId: membership.teamId });
        }
      }

      if (
        person.removedAt === null &&
        person.organizationAdmin &&
        activePeople(state).filter((each) => each.organizationAdmin).length <= 1
      ) {
        return reject({ _tag: "LastAdmin" });
      }

      return accept(
        [
          ...memberships.map((membership): DirectoryChange => ({
            _tag: "MembershipEnded",
            membershipId: membership.id,
            at: now,
          })),
          { _tag: "PersonErased", personId: person.id, at: now },
        ],
        [followUp],
      );
    }

    case "SetAdmin": {
      if (!can(allowed, "organization.setAdmin", organization)) {
        return forbidden;
      }

      const person = activePeople(state).find((each) => each.id === command.personId);

      if (person === undefined) {
        return reject({ _tag: "PersonNotFound" });
      }

      if (
        person.organizationAdmin &&
        !command.organizationAdmin &&
        activePeople(state).filter((each) => each.organizationAdmin).length <= 1
      ) {
        return reject({ _tag: "LastAdmin" });
      }

      if (person.organizationAdmin === command.organizationAdmin) {
        return accept([]);
      }

      return accept([
        { _tag: "AdminSet", personId: person.id, organizationAdmin: command.organizationAdmin },
      ]);
    }

    case "UpdateSettings": {
      if (!can(allowed, "organization.updateSettings", organization)) {
        return forbidden;
      }

      return accept([
        {
          _tag: "SettingsUpdated",
          minimumGroupSize: command.minimumGroupSize ?? state.minimumGroupSize,
          aiProcessing: command.aiProcessing ?? state.aiProcessing,
          defaultLocale: command.defaultLocale ?? state.defaultLocale,
        },
      ]);
    }

    case "UpdateOwnLanguage": {
      return accept([
        {
          _tag: "PersonLanguageSet",
          personId: actorId,
          locale: command.locale === undefined ? adder.locale : command.locale,
          detectedLocale: command.detectedLocale ?? adder.detectedLocale,
        },
      ]);
    }
  }
};

const applyChange = (state: DirectoryState, change: DirectoryChange): DirectoryState => {
  const updatePerson = (personId: PersonId, update: (person: PersonRecord) => PersonRecord) => ({
    ...state,
    people: state.people.map((person) => (person.id === personId ? update(person) : person)),
  });

  switch (change._tag) {
    case "PersonAdded": {
      return { ...state, people: [...state.people, change.person] };
    }

    case "PersonRestored": {
      return updatePerson(change.personId, (person) => ({ ...person, removedAt: null }));
    }

    case "PersonRemoved": {
      return updatePerson(change.personId, (person) => ({ ...person, removedAt: change.at }));
    }

    case "PersonErased": {
      return updatePerson(change.personId, (person) => ({
        ...person,
        email: erasedEmailOf(person.id),
        authUserId: null,
        organizationAdmin: false,
        removedAt: person.removedAt ?? change.at,
        erasedAt: change.at,
        locale: null,
        detectedLocale: null,
      }));
    }

    case "AdminSet": {
      return updatePerson(change.personId, (person) => ({
        ...person,
        organizationAdmin: change.organizationAdmin,
      }));
    }

    case "TeamAdded": {
      return { ...state, teams: [...state.teams, change.team] };
    }

    case "TeamUpdated": {
      return {
        ...state,
        teams: state.teams.map((team) => (team.id === change.team.id ? change.team : team)),
      };
    }

    case "MembershipStarted": {
      return { ...state, memberships: [...state.memberships, change.membership] };
    }

    case "MembershipEnded": {
      return {
        ...state,
        memberships: state.memberships.map((membership) =>
          membership.id === change.membershipId ? { ...membership, endedAt: change.at } : membership,
        ),
      };
    }

    case "SettingsUpdated": {
      return {
        ...state,
        minimumGroupSize: change.minimumGroupSize,
        aiProcessing: change.aiProcessing,
        defaultLocale: change.defaultLocale,
      };
    }

    case "PersonLanguageSet": {
      return updatePerson(change.personId, (person) => ({
        ...person,
        locale: change.locale,
        detectedLocale: change.detectedLocale,
      }));
    }

    case "EmailRequested": {
      return state;
    }
  }
};

export const applyChanges = (state: DirectoryState, changes: readonly DirectoryChange[]): DirectoryState => {
  let current = state;

  for (const change of changes) {
    current = applyChange(current, change);
  }

  return current;
};

export const teamSummaryOf = (team: TeamRecord, actor: Actor, memberCount?: number): TeamSummary => ({
  id: team.id,
  name: team.name,
  timeZone: team.timeZone,
  yourRole: actor.roles.get(team.id) ?? null,

  ...(memberCount === undefined ? {} : { memberCount }),
});

const activeMembersOf = (state: DirectoryState, teamId: TeamId): number =>
  state.memberships.filter((membership) => membership.teamId === teamId && membership.endedAt === null)
    .length;

const byName = (a: { readonly name: string }, b: { readonly name: string }) =>
  a.name.localeCompare(b.name, "en");

export const teamsView = (state: DirectoryState, actorId: PersonId): Viewed<readonly TeamSummary[]> => {
  const actor = actorOf(state, actorId);

  if (Option.isNone(actor)) {
    return forbidden;
  }

  const listAll = can(actor.value, "organization.listTeams", { _tag: "Organization" });

  const teams = state.teams.filter(
    (team) => listAll || can(actor.value, "team.view", { _tag: "Team", teamId: team.id }),
  );

  return {
    _tag: "Viewed",
    value: [...teams]
      .sort(byName)
      .map((team) => teamSummaryOf(team, actor.value, activeMembersOf(state, team.id))),
  };
};

const ROLE_ORDER: Readonly<Record<MembershipRole, number>> = { lead: 0, member: 1, viewer: 2 };

export const teamView = (state: DirectoryState, actorId: PersonId, teamId: TeamId): Viewed<TeamDetail> => {
  const actor = actorOf(state, actorId);

  if (Option.isNone(actor)) {
    return forbidden;
  }

  const resource = { _tag: "Team", teamId } as const;

  if (!can(actor.value, "team.viewRoster", resource)) {
    return forbidden;
  }

  const team = findTeam(state, teamId);

  if (team === undefined) {
    return reject({ _tag: "TeamNotFound" });
  }

  const emails = new Map(state.people.map((person) => [person.id, person.email]));

  const roster = activeMemberships(state, teamId)
    .flatMap((membership) => {
      const email = emails.get(membership.personId);

      return email === undefined
        ? []
        : [{ personId: membership.personId, email, role: membership.role, since: membership.startedAt }];
    })
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.email.localeCompare(b.email, "en"));

  return {
    _tag: "Viewed",
    value: {
      team: teamSummaryOf(team, actor.value, activeMembersOf(state, team.id)),
      roster,
      may: {
        update: can(actor.value, "team.update", resource),
        manageLeads: can(actor.value, "team.assignLead", resource),
        manageMembers: can(actor.value, "team.addMember", resource),
        managePulses: can(actor.value, "team.editPulse", resource),
        viewResults: can(actor.value, "team.viewResults", resource),
      },
    },
  };
};

export const settingsView = (state: DirectoryState, actorId: PersonId): Viewed<OrganizationSettings> => {
  const actor = actorOf(state, actorId);

  if (Option.isNone(actor)) {
    return forbidden;
  }

  if (!can(actor.value, "organization.viewSettings", { _tag: "Organization" })) {
    return forbidden;
  }

  return {
    _tag: "Viewed",
    value: {
      name: state.organizationName,
      minimumGroupSize: state.minimumGroupSize,
      aiProcessing: state.aiProcessing,
      defaultLocale: state.defaultLocale,
      people: activePeople(state)
        .map((person) => ({
          personId: person.id,
          email: person.email,
          organizationAdmin: person.organizationAdmin,
          linked: person.authUserId !== null,
        }))
        .sort((a, b) => a.email.localeCompare(b.email, "en")),
      removedPeople: state.people
        .filter((person) => person.removedAt !== null && person.erasedAt === null)
        .map((person) => ({ personId: person.id, email: person.email }))
        .sort((a, b) => a.email.localeCompare(b.email, "en")),
    },
  };
};

export const isEmailAdmin = (state: DirectoryState, actorId: PersonId): boolean => {
  const actor = actorOf(state, actorId);

  return Option.isSome(actor) && can(actor.value, "organization.updateSettings", { _tag: "Organization" });
};

export const emailStatusView = (
  state: DirectoryState,
  actorId: PersonId,
  status: FailedEmailStatus | null,
): Viewed<FailedEmailStatus> => {
  if (!isEmailAdmin(state, actorId)) {
    return forbidden;
  }

  if (status === null) {
    return reject({ _tag: "FailedEmailNotFound" });
  }

  return { _tag: "Viewed", value: status };
};

export const failedEmailsView = (
  state: DirectoryState,
  actorId: PersonId,
  failed: readonly FailedEmail[],
): Viewed<FailedEmails> => {
  const actor = actorOf(state, actorId);

  if (Option.isNone(actor)) {
    return forbidden;
  }

  if (!can(actor.value, "organization.viewSettings", { _tag: "Organization" })) {
    return forbidden;
  }

  return { _tag: "Viewed", value: { emails: failed } };
};
