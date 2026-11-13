import { Option } from "effect";
import { EmailAddress, SendId, type TransactionalEmail } from "../email/Email.ts";
import type { FailedEmail, FailedEmails, FailedEmailStatus } from "../email/FailedEmails.ts";
import { normaliseEmail, type PersonId, type WorkosUserId } from "./Identity.ts";
import { type Actor, can } from "./Permissions.ts";
import { type Locale, resolveLocale } from "./Locale.ts";
import type { OrganizationRole } from "./SignInPorts.ts";
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

/**
 * The People, Teams, and Memberships of one Organization, and the rules that change them.
 * Everything here is pure: the Organization Durable Object loads its state, asks `decide`, and
 * applies the changes in one transaction (ADR 0006); the in-memory fakes do the same. Records are
 * plain data (`null`, not `Option`) because they cross the Durable Object's RPC boundary.
 */

export interface PersonRecord {
  readonly id: PersonId;
  readonly email: EmailAddress;
  readonly workosUserId: WorkosUserId | null;
  readonly organizationAdmin: boolean;
  /** When the Person was removed from the Organization (epoch ms). Their history stays. */
  readonly removedAt: number | null;
  /** The language the Person chose, or `null` to follow the browser (ADR 0018). */
  readonly locale: Locale | null;
  /** The browser's language last seen at sign-in: what emails, which have no browser, follow. */
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
  /** When it ended (epoch ms); `null` while active. Ended Memberships are kept as history. */
  readonly endedAt: number | null;
}

export interface DirectoryState {
  readonly organizationName: string;
  readonly minimumGroupSize: number;
  /** Whether comments may be sent to the AI service (ADR 0015). Off by default. */
  readonly aiProcessing: boolean;
  /** The language for People who chose none and whose browser language is unknown (ADR 0018). */
  readonly defaultLocale: Locale;
  readonly people: ReadonlyArray<PersonRecord>;
  readonly teams: ReadonlyArray<TeamRecord>;
  readonly memberships: ReadonlyArray<MembershipRecord>;
}

/**
 * Someone added by email. The ids are minted by the caller and used only when a new Person or
 * Membership is needed, so `decide` stays pure.
 */
export interface NewMember {
  readonly email: EmailAddress;
  readonly personId: PersonId;
  readonly membershipId: MembershipId;
  /** Where the "You've been added" email sends them. */
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
  /** Adds by email in `role`. `lead` assigns a Lead, promoting a member who is in the Team already. */
  | {
      readonly _tag: "AddMember";
      readonly teamId: TeamId;
      readonly role: AssignableRole;
      readonly member: NewMember;
    }
  /** Ends the Person's Membership in the Team, whatever its role. */
  | { readonly _tag: "RemoveMember"; readonly teamId: TeamId; readonly personId: PersonId }
  /** Ends a Lead's lead Membership; they stay in the Team as a member. */
  | {
      readonly _tag: "RemoveLead";
      readonly teamId: TeamId;
      readonly personId: PersonId;
      readonly membershipId: MembershipId;
    }
  | { readonly _tag: "RemovePerson"; readonly personId: PersonId }
  | { readonly _tag: "SetAdmin"; readonly personId: PersonId; readonly organizationAdmin: boolean }
  /** Absent fields keep their current value. */
  | {
      readonly _tag: "UpdateSettings";
      readonly minimumGroupSize?: number | undefined;
      readonly aiProcessing?: boolean | undefined;
      readonly defaultLocale?: Locale | undefined;
    }
  /**
   * The actor's own language, for no one else (any active Person may). Absent fields keep their
   * current value; `locale: null` clears the choice so the browser's language is followed again.
   */
  | {
      readonly _tag: "UpdateOwnLanguage";
      readonly locale?: Locale | null | undefined;
      readonly detectedLocale?: Locale | undefined;
    };

/** A change to the Organization's own data, applied atomically with the others of a decision. */
export type DirectoryChange =
  | { readonly _tag: "PersonAdded"; readonly person: PersonRecord }
  | { readonly _tag: "PersonRestored"; readonly personId: PersonId }
  | { readonly _tag: "PersonRemoved"; readonly personId: PersonId; readonly at: number }
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
  /** Creates the send (idempotent per id) in the same transaction, through the send states. */
  | {
      readonly _tag: "EmailRequested";
      readonly sendId: SendId;
      readonly recipient: EmailAddress;
      readonly email: TransactionalEmail;
    };

/** A Person as the global index and WorkOS need to hear about them. */
export interface PersonRef {
  readonly id: PersonId;
  readonly email: EmailAddress;
  readonly workosUserId: WorkosUserId | null;
}

/**
 * What must happen outside the Organization once its changes are committed. Each is idempotent,
 * and repeating the command repeats them, so a crash halfway is mended by a retry.
 */
export type FollowUp =
  /** Keep the D1 `person_index` row (sign-in routing) in step with an active Person. */
  | { readonly _tag: "IndexPerson"; readonly person: PersonRef }
  /** A removed Person is no longer a sign-in candidate. */
  | { readonly _tag: "UnindexPerson"; readonly personId: PersonId }
  /** So AuthKit stops putting the user back into this Organization at sign-in (ADR 0010). */
  | { readonly _tag: "DeactivateWorkosMembership"; readonly userId: WorkosUserId }
  | { readonly _tag: "SetWorkosRole"; readonly userId: WorkosUserId; readonly role: OrganizationRole }
  /** Ask the Queue consumer to deliver the send, if it is still pending. */
  | { readonly _tag: "QueueEmail"; readonly sendId: SendId };

/** Why a command or a view was refused. Plain data; the flow turns it into the API's errors. */
export type DirectoryRejection =
  | { readonly _tag: "Forbidden" }
  | { readonly _tag: "TeamNotFound" }
  | { readonly _tag: "PersonNotFound" }
  | { readonly _tag: "PersonWasRemoved" }
  | { readonly _tag: "LastLead"; readonly teamId: TeamId }
  | { readonly _tag: "LastAdmin" }
  | { readonly _tag: "TeamNameTaken" }
  | { readonly _tag: "FailedEmailNotFound" }
  | { readonly _tag: "EmailNotResendable" };

export type Decision =
  | { readonly _tag: "Rejected"; readonly rejection: DirectoryRejection }
  | {
      readonly _tag: "Accepted";
      readonly changes: ReadonlyArray<DirectoryChange>;
      readonly followUps: ReadonlyArray<FollowUp>;
    };

/** A view, or why it was refused. */
export type Viewed<A> =
  | { readonly _tag: "Viewed"; readonly value: A }
  | { readonly _tag: "Rejected"; readonly rejection: DirectoryRejection };

/**
 * An admin's Resend: refused, or accepted with the send's status. `queue` says whether the caller must hand the
 * send to the email queue (only the Resend that moved it from failed to pending does).
 */
export type ResendResult =
  | { readonly _tag: "Rejected"; readonly rejection: DirectoryRejection }
  | { readonly _tag: "Accepted"; readonly status: FailedEmailStatus; readonly queue: boolean };

const reject = (
  rejection: DirectoryRejection,
): { readonly _tag: "Rejected"; readonly rejection: DirectoryRejection } => ({
  _tag: "Rejected",
  rejection,
});
const forbidden = reject({ _tag: "Forbidden" });

const accept = (
  changes: ReadonlyArray<DirectoryChange>,
  followUps: ReadonlyArray<FollowUp> = [],
): Decision => ({
  _tag: "Accepted",
  changes,
  followUps,
});

/** The send id of the "You've been added" email for a Membership: one email per Membership. */
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
  workosUserId: person.workosUserId,
});

/** The actor for an active Person, from this state alone. None for a removed or unknown Person. */
export const actorOf = (state: DirectoryState, personId: PersonId): Option.Option<Actor> => {
  const person = state.people.find((each) => each.id === personId && each.removedAt === null);
  if (person === undefined) return Option.none();
  const roles = new Map<TeamId, MembershipRole>();
  for (const membership of state.memberships) {
    if (membership.personId === personId && isActive(membership))
      roles.set(membership.teamId, membership.role);
  }
  return Option.some({ personId, organizationAdmin: person.organizationAdmin, roles });
};

/**
 * The language an email to this Person is written in (ADR 0018): their own choice, then the
 * browser language last seen at sign-in, then the Organization's default. A Person not (yet) in
 * the state, such as one being added, has neither, so the default.
 */
export const emailLocaleOf = (state: DirectoryState, personId: PersonId): Locale => {
  const person = state.people.find((each) => each.id === personId);
  if (person === undefined) return state.defaultLocale;
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

/**
 * Puts someone into a Team in `role`: finds their Person by email (restoring a removed one, whose
 * history stays) or creates one with email only (ADR 0002), starts the Membership, and asks for
 * the "You've been added to <Team> by <Lead>" email. Already in the Team in that role (or as Lead
 * when `member` is asked): nothing changes, and the follow-ups run again.
 */
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
    workosUserId: null,
    organizationAdmin: false,
    removedAt: null,
    locale: null,
    detectedLocale: null,
  };
  const changes: Array<DirectoryChange> = [];
  if (existing === undefined) changes.push({ _tag: "PersonAdded", person });
  else if (existing.removedAt !== null) changes.push({ _tag: "PersonRestored", personId: existing.id });

  const index: FollowUp = { _tag: "IndexPerson", person: refOf(person) };
  const current = existing === undefined ? undefined : activeMembershipOf(state, team.id, existing.id);
  if (current !== undefined && (current.role === role || current.role === "lead")) {
    return accept(changes, [index, { _tag: "QueueEmail", sendId: addedEmailSendId(current.id) }]);
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
    // A member made Lead: one role per Membership, so the member one ends and a lead one starts.
    changes.push({ _tag: "MembershipEnded", membershipId: current.id, at: now });
    changes.push({ _tag: "MembershipStarted", membership });
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
  return accept(changes, [index, { _tag: "QueueEmail", sendId }]);
};

/**
 * Decides one command by `actorId`, from the Organization's current state. The permission table
 * is asked first, so a refusal never says whether a Team or Person exists to someone who may not
 * know. Then the rules: a Team always keeps a Lead, the Organization always keeps an admin, and
 * removing someone ends Memberships on that date but never deletes a Person or their history.
 */
export const decide = (
  state: DirectoryState,
  actorId: PersonId,
  command: DirectoryCommand,
  now: number,
): Decision => {
  const actor = actorOf(state, actorId);
  const adder = state.people.find((person) => person.id === actorId);
  if (Option.isNone(actor) || adder === undefined) return forbidden;
  const allowed = actor.value;
  const organization = { _tag: "Organization" } as const;

  switch (command._tag) {
    case "CreateTeam": {
      if (!can(allowed, "organization.createTeam", organization)) return forbidden;
      if (nameTaken(state, command.name)) return reject({ _tag: "TeamNameTaken" });
      const team: TeamRecord = { id: command.teamId, name: command.name, timeZone: command.timeZone };
      if (findTeam(state, team.id) !== undefined) return reject({ _tag: "TeamNameTaken" });
      const withTeam: DirectoryState = { ...state, teams: [...state.teams, team] };
      const lead = putInTeam(withTeam, adder, team, "lead", command.lead, now);
      if (lead._tag === "Rejected") return lead;
      return accept([{ _tag: "TeamAdded", team }, ...lead.changes], lead.followUps);
    }

    case "UpdateTeam": {
      if (!can(allowed, "team.update", { _tag: "Team", teamId: command.teamId })) return forbidden;
      if (findTeam(state, command.teamId) === undefined) return reject({ _tag: "TeamNotFound" });
      if (nameTaken(state, command.name, command.teamId)) return reject({ _tag: "TeamNameTaken" });
      return accept([
        { _tag: "TeamUpdated", team: { id: command.teamId, name: command.name, timeZone: command.timeZone } },
      ]);
    }

    case "AddMember": {
      const action = command.role === "lead" ? "team.assignLead" : "team.addMember";
      if (!can(allowed, action, { _tag: "Team", teamId: command.teamId })) return forbidden;
      const team = findTeam(state, command.teamId);
      if (team === undefined) return reject({ _tag: "TeamNotFound" });
      return putInTeam(state, adder, team, command.role, command.member, now);
    }

    case "RemoveMember": {
      const resource = { _tag: "Team", teamId: command.teamId } as const;
      if (!can(allowed, "team.removeMember", resource)) return forbidden;
      if (findTeam(state, command.teamId) === undefined) return reject({ _tag: "TeamNotFound" });
      const membership = activeMembershipOf(state, command.teamId, command.personId);
      if (membership === undefined) return reject({ _tag: "PersonNotFound" });
      if (membership.role === "lead") {
        // Taking a Lead out of a Team is a Lead change, which only an admin makes.
        if (!can(allowed, "team.removeLead", resource)) return forbidden;
        if (leadsOf(state, command.teamId).length <= 1)
          return reject({ _tag: "LastLead", teamId: command.teamId });
      }
      return accept([{ _tag: "MembershipEnded", membershipId: membership.id, at: now }]);
    }

    case "RemoveLead": {
      if (!can(allowed, "team.removeLead", { _tag: "Team", teamId: command.teamId })) return forbidden;
      if (findTeam(state, command.teamId) === undefined) return reject({ _tag: "TeamNotFound" });
      const membership = activeMembershipOf(state, command.teamId, command.personId);
      if (membership?.role !== "lead") return reject({ _tag: "PersonNotFound" });
      if (leadsOf(state, command.teamId).length <= 1)
        return reject({ _tag: "LastLead", teamId: command.teamId });
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
      if (!can(allowed, "organization.removePerson", organization)) return forbidden;
      if (command.personId === actorId) return forbidden;
      const person = state.people.find((each) => each.id === command.personId);
      if (person === undefined) return reject({ _tag: "PersonNotFound" });
      const followUps: Array<FollowUp> = [{ _tag: "UnindexPerson", personId: person.id }];
      if (person.workosUserId !== null) {
        followUps.push({ _tag: "DeactivateWorkosMembership", userId: person.workosUserId });
      }
      // Removed already: nothing changes here, but the index and WorkOS are put in step again.
      if (person.removedAt !== null) return accept([], followUps);

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
      const changes: Array<DirectoryChange> = memberships.map((membership) => ({
        _tag: "MembershipEnded",
        membershipId: membership.id,
        at: now,
      }));
      // A Person added back later starts as a plain member, never as the admin they were.
      if (person.organizationAdmin)
        changes.push({ _tag: "AdminSet", personId: person.id, organizationAdmin: false });
      changes.push({ _tag: "PersonRemoved", personId: person.id, at: now });
      return accept(changes, followUps);
    }

    case "SetAdmin": {
      if (!can(allowed, "organization.setAdmin", organization)) return forbidden;
      const person = activePeople(state).find((each) => each.id === command.personId);
      if (person === undefined) return reject({ _tag: "PersonNotFound" });
      if (
        person.organizationAdmin &&
        !command.organizationAdmin &&
        activePeople(state).filter((each) => each.organizationAdmin).length <= 1
      ) {
        return reject({ _tag: "LastAdmin" });
      }
      const followUps: ReadonlyArray<FollowUp> =
        person.workosUserId === null
          ? []
          : [
              {
                _tag: "SetWorkosRole",
                userId: person.workosUserId,
                role: command.organizationAdmin ? "admin" : "member",
              },
            ];
      if (person.organizationAdmin === command.organizationAdmin) return accept([], followUps);
      return accept(
        [{ _tag: "AdminSet", personId: person.id, organizationAdmin: command.organizationAdmin }],
        followUps,
      );
    }

    case "UpdateSettings": {
      if (!can(allowed, "organization.updateSettings", organization)) return forbidden;
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
      // Any active Person may set their own language, and only their own: the actor is the target.
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

/** Applies a decision's changes to an in-memory state: what the Durable Object does in SQL. */
export const applyChanges = (
  state: DirectoryState,
  changes: ReadonlyArray<DirectoryChange>,
): DirectoryState =>
  changes.reduce<DirectoryState>((current, change) => {
    const updatePerson = (personId: PersonId, update: (person: PersonRecord) => PersonRecord) => ({
      ...current,
      people: current.people.map((person) => (person.id === personId ? update(person) : person)),
    });
    switch (change._tag) {
      case "PersonAdded":
        return { ...current, people: [...current.people, change.person] };
      case "PersonRestored":
        return updatePerson(change.personId, (person) => ({ ...person, removedAt: null }));
      case "PersonRemoved":
        return updatePerson(change.personId, (person) => ({ ...person, removedAt: change.at }));
      case "AdminSet":
        return updatePerson(change.personId, (person) => ({
          ...person,
          organizationAdmin: change.organizationAdmin,
        }));
      case "TeamAdded":
        return { ...current, teams: [...current.teams, change.team] };
      case "TeamUpdated":
        return {
          ...current,
          teams: current.teams.map((team) => (team.id === change.team.id ? change.team : team)),
        };
      case "MembershipStarted":
        return { ...current, memberships: [...current.memberships, change.membership] };
      case "MembershipEnded":
        return {
          ...current,
          memberships: current.memberships.map((membership) =>
            membership.id === change.membershipId ? { ...membership, endedAt: change.at } : membership,
          ),
        };
      case "SettingsUpdated":
        return {
          ...current,
          minimumGroupSize: change.minimumGroupSize,
          aiProcessing: change.aiProcessing,
          defaultLocale: change.defaultLocale,
        };
      case "PersonLanguageSet":
        return updatePerson(change.personId, (person) => ({
          ...person,
          locale: change.locale,
          detectedLocale: change.detectedLocale,
        }));
      case "EmailRequested":
        return current;
    }
  }, state);

/** A Team as a list shows it to `actor`, with how many people are actively in it. */
export const teamSummaryOf = (team: TeamRecord, actor: Actor, memberCount?: number): TeamSummary => ({
  id: team.id,
  name: team.name,
  timeZone: team.timeZone,
  yourRole: actor.roles.get(team.id) ?? null,
  // Only the Teams list counts people; other views leave the key out.
  ...(memberCount === undefined ? {} : { memberCount }),
});

/** The active memberships of one Team: ended memberships do not count. */
const activeMembersOf = (state: DirectoryState, teamId: TeamId): number =>
  state.memberships.filter((membership) => membership.teamId === teamId && membership.endedAt === null)
    .length;

const byName = (a: { readonly name: string }, b: { readonly name: string }) =>
  a.name.localeCompare(b.name, "en");

/** The Teams the actor sees: every Team for an admin, otherwise the Teams they are in. */
export const teamsView = (state: DirectoryState, actorId: PersonId): Viewed<ReadonlyArray<TeamSummary>> => {
  const actor = actorOf(state, actorId);
  if (Option.isNone(actor)) return forbidden;
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

/** A Team's roster, for its Leads and for Organization admins (who need it to administer it). */
export const teamView = (state: DirectoryState, actorId: PersonId, teamId: TeamId): Viewed<TeamDetail> => {
  const actor = actorOf(state, actorId);
  if (Option.isNone(actor)) return forbidden;
  const resource = { _tag: "Team", teamId } as const;
  if (!can(actor.value, "team.viewRoster", resource)) return forbidden;
  const team = findTeam(state, teamId);
  if (team === undefined) return reject({ _tag: "TeamNotFound" });
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

/** The Organization settings: N, and the active People with their admin flag. Admins only. */
export const settingsView = (state: DirectoryState, actorId: PersonId): Viewed<OrganizationSettings> => {
  const actor = actorOf(state, actorId);
  if (Option.isNone(actor)) return forbidden;
  if (!can(actor.value, "organization.viewSettings", { _tag: "Organization" })) return forbidden;
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
          linked: person.workosUserId !== null,
        }))
        .sort((a, b) => a.email.localeCompare(b.email, "en")),
    },
  };
};

/**
 * Who may Resend a failed send or read a send's status: the Organization's admins only (ADR 0006). Same rule as
 * `failedEmailsView`, so no non-admin learns whether a send exists.
 */
export const isEmailAdmin = (state: DirectoryState, actorId: PersonId): boolean => {
  const actor = actorOf(state, actorId);
  return Option.isSome(actor) && can(actor.value, "organization.updateSettings", { _tag: "Organization" });
};

/** One send's status for an admin. `status` is null when the Organization has no such send. */
export const emailStatusView = (
  state: DirectoryState,
  actorId: PersonId,
  status: FailedEmailStatus | null,
): Viewed<FailedEmailStatus> => {
  if (!isEmailAdmin(state, actorId)) return forbidden;
  if (status === null) return reject({ _tag: "FailedEmailNotFound" });
  return { _tag: "Viewed", value: status };
};

/**
 * The Organization's most recent failed sends, for its admins (never anyone else). `failed` is what the
 * Durable Object read: the rows already newest first, and only the fields an admin may see.
 */
export const failedEmailsView = (
  state: DirectoryState,
  actorId: PersonId,
  failed: ReadonlyArray<FailedEmail>,
): Viewed<FailedEmails> => {
  const actor = actorOf(state, actorId);
  if (Option.isNone(actor)) return forbidden;
  if (!can(actor.value, "organization.viewSettings", { _tag: "Organization" })) return forbidden;
  return { _tag: "Viewed", value: { emails: failed } };
};
