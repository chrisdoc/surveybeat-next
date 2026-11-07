import type { PersonId } from "./Identity.ts";
import type { MembershipRole, TeamId } from "./Team.ts";

/**
 * Who is asking, as the Organization's Durable Object knows them right now (never a token
 * claim): an active Person, whether they are an Organization admin, and their active Memberships.
 */
export interface Actor {
  readonly personId: PersonId;
  readonly organizationAdmin: boolean;
  /** One role per Team, from active Memberships only. An ended Membership grants nothing. */
  readonly roles: ReadonlyMap<TeamId, MembershipRole>;
}

/** Actions on the Organization as a whole. */
export type OrganizationAction =
  | "organization.viewSettings"
  | "organization.updateSettings"
  | "organization.setAdmin"
  | "organization.removePerson"
  | "organization.listTeams"
  | "organization.createTeam";

/** Actions on one Team. */
export type TeamAction =
  | "team.view"
  | "team.update"
  | "team.viewRoster"
  | "team.addMember"
  | "team.removeMember"
  | "team.assignLead"
  | "team.removeLead"
  | "team.viewResults"
  | "team.viewPulses"
  | "team.createPulse"
  | "team.editPulse";

export type Action = OrganizationAction | TeamAction;

export type Resource = { readonly _tag: "Organization" } | { readonly _tag: "Team"; readonly teamId: TeamId };

/** Each action takes the resource it is about, so a Team action cannot be asked of the Organization. */
export type ResourceOf<A extends Action> = A extends TeamAction
  ? Extract<Resource, { readonly _tag: "Team" }>
  : Extract<Resource, { readonly _tag: "Organization" }>;

/** Who an action is open to: Organization admins, or a role in the Team the action is about. */
type Grantee = "admin" | MembershipRole;

/**
 * The permission table (SPEC §5.6), the only place permissions are defined. Being an
 * Organization admin covers administration only (ADR 0003): an admin reads a Team's roster
 * because adding, removing, and assigning Leads needs it, but never its Results, which take a
 * Membership in that Team.
 */
export const PERMISSIONS: { readonly [A in Action]: ReadonlyArray<Grantee> } = {
  "organization.viewSettings": ["admin"],
  "organization.updateSettings": ["admin"],
  "organization.setAdmin": ["admin"],
  "organization.removePerson": ["admin"],
  "organization.listTeams": ["admin"],
  "organization.createTeam": ["admin"],
  "team.view": ["admin", "lead", "member", "viewer"],
  "team.update": ["admin"],
  "team.viewRoster": ["admin", "lead"],
  "team.addMember": ["admin", "lead"],
  "team.removeMember": ["admin", "lead"],
  "team.assignLead": ["admin"],
  "team.removeLead": ["admin"],
  "team.viewResults": ["lead", "member", "viewer"],
  // A Pulse's Questions and settings hold no Result data, so admins set them up like the roster.
  "team.viewPulses": ["admin", "lead"],
  "team.createPulse": ["admin", "lead"],
  "team.editPulse": ["admin", "lead"],
};

/** Whether `actor` may do `action` to `resource`. */
export const can = <A extends Action>(actor: Actor, action: A, resource: ResourceOf<A>): boolean => {
  const grantees = PERMISSIONS[action];
  if (actor.organizationAdmin && grantees.includes("admin")) return true;
  if (resource._tag !== "Team") return false;
  const role = actor.roles.get(resource.teamId);
  return role !== undefined && grantees.includes(role);
};
