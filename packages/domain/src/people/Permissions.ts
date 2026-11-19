import type { PersonId } from "./Identity.ts";
import type { MembershipRole, TeamId } from "./Team.ts";

export interface Actor {
  readonly personId: PersonId;
  readonly organizationAdmin: boolean;

  readonly roles: ReadonlyMap<TeamId, MembershipRole>;
}

export type OrganizationAction =
  | "organization.viewSettings"
  | "organization.updateSettings"
  | "organization.setAdmin"
  | "organization.removePerson"
  | "organization.listTeams"
  | "organization.createTeam";

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
  | "team.editPulse"
  | "team.viewRounds"
  | "team.manageRounds"
  | "team.viewActions"
  | "team.createAction"
  | "team.updateAction"
  | "team.viewNote"
  | "team.writeNote";

export type Action = OrganizationAction | TeamAction;

export type Resource = { readonly _tag: "Organization" } | { readonly _tag: "Team"; readonly teamId: TeamId };

export type ResourceOf<A extends Action> = A extends TeamAction
  ? Extract<Resource, { readonly _tag: "Team" }>
  : Extract<Resource, { readonly _tag: "Organization" }>;

type Grantee = "admin" | MembershipRole;

export const PERMISSIONS: Readonly<Record<Action, readonly Grantee[]>> = {
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

  "team.viewPulses": ["admin", "lead"],
  "team.createPulse": ["admin", "lead"],
  "team.editPulse": ["admin", "lead"],
  "team.viewRounds": ["admin", "lead"],
  "team.manageRounds": ["admin", "lead"],

  "team.viewActions": ["lead", "member", "viewer"],
  "team.createAction": ["lead"],
  "team.updateAction": ["lead"],

  "team.viewNote": ["lead", "member", "viewer"],
  "team.writeNote": ["lead"],
};

export const can = <A extends Action>(actor: Actor, action: A, resource: ResourceOf<A>): boolean => {
  const grantees = PERMISSIONS[action];

  if (actor.organizationAdmin && grantees.includes("admin")) {
    return true;
  }

  if (resource._tag !== "Team") {
    return false;
  }

  const role = actor.roles.get(resource.teamId);

  return role !== undefined && grantees.includes(role);
};
