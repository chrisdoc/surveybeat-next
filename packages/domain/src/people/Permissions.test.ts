import { describe, expect, it } from "@effect/vitest";
import { PersonId } from "./Identity.ts";
import { type Action, type Actor, can, PERMISSIONS, type TeamAction } from "./Permissions.ts";
import { type MembershipRole, TeamId } from "./Team.ts";

const team = TeamId.make("platform");
const otherTeam = TeamId.make("design");

const actor = (organizationAdmin: boolean, role?: MembershipRole): Actor => ({
  personId: PersonId.make("person"),
  organizationAdmin,
  roles: new Map(role === undefined ? [] : [[team, role]]),
});

/** The people the table is about: every role in `team`, an admin with and without a Membership, and outsiders. */
const ACTORS = {
  admin: actor(true),
  adminLead: actor(true, "lead"),
  lead: actor(false, "lead"),
  member: actor(false, "member"),
  viewer: actor(false, "viewer"),
  leadElsewhere: { ...actor(false), roles: new Map([[otherTeam, "lead" as const]]) },
  nobody: actor(false),
} satisfies Record<string, Actor>;
type Who = keyof typeof ACTORS;
const EVERYONE = Object.keys(ACTORS) as ReadonlyArray<Who>;

/**
 * SPEC §5.6: one row per action, listing exactly who may do it (to `team` for Team actions).
 * Everyone not listed is refused. An Organization admin administers but never reads Results
 * (ADR 0003), and a role in another Team grants nothing here.
 */
const TABLE: { readonly [A in Action]: ReadonlyArray<Who> } = {
  "organization.viewSettings": ["admin", "adminLead"],
  "organization.updateSettings": ["admin", "adminLead"],
  "organization.setAdmin": ["admin", "adminLead"],
  "organization.removePerson": ["admin", "adminLead"],
  "organization.listTeams": ["admin", "adminLead"],
  "organization.createTeam": ["admin", "adminLead"],
  "team.view": ["admin", "adminLead", "lead", "member", "viewer"],
  "team.update": ["admin", "adminLead"],
  "team.viewRoster": ["admin", "adminLead", "lead"],
  "team.addMember": ["admin", "adminLead", "lead"],
  "team.removeMember": ["admin", "adminLead", "lead"],
  "team.assignLead": ["admin", "adminLead"],
  "team.removeLead": ["admin", "adminLead"],
  "team.viewResults": ["adminLead", "lead", "member", "viewer"],
};

const isTeamAction = (action: Action): action is TeamAction => action.startsWith("team.");

const ask = (who: Who, action: Action): boolean =>
  can(ACTORS[who], action, isTeamAction(action) ? { _tag: "Team", teamId: team } : { _tag: "Organization" });

const rows = (Object.keys(TABLE) as ReadonlyArray<Action>).flatMap((action) =>
  EVERYONE.map((who) => ({ action, who, allowed: TABLE[action].includes(who) })),
);

describe("the permission table", () => {
  it("covers every action the permission function knows", () => {
    expect(Object.keys(TABLE).sort()).toEqual(Object.keys(PERMISSIONS).sort());
  });

  it.each(rows)("$who → $action: $allowed", ({ who, action, allowed }) => {
    expect(ask(who, action)).toBe(allowed);
  });

  it("never lets an Organization admin without a Membership read a Team's Results", () => {
    expect(can(ACTORS.admin, "team.viewResults", { _tag: "Team", teamId: team })).toBe(false);
    expect(can(ACTORS.admin, "team.viewRoster", { _tag: "Team", teamId: team })).toBe(true);
  });

  it("grants a role only in its own Team", () => {
    expect(can(ACTORS.leadElsewhere, "team.addMember", { _tag: "Team", teamId: otherTeam })).toBe(true);
    expect(can(ACTORS.leadElsewhere, "team.addMember", { _tag: "Team", teamId: team })).toBe(false);
  });
});
