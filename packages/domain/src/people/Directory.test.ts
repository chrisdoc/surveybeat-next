import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import { EmailAddress } from "../email/Email.ts";
import {
  actorOf,
  applyChanges,
  type Decision,
  decide,
  type DirectoryCommand,
  type DirectoryState,
  emailLocaleOf,
  type NewMember,
  settingsView,
  teamsView,
  teamView,
} from "./Directory.ts";
import { PersonId, WorkosUserId } from "./Identity.ts";
import { MembershipId, MinimumGroupSize, TeamId, TimeZone } from "./Team.ts";

const ADMIN = PersonId.make("admin");
const DAY = 86_400_000;

const initial: DirectoryState = {
  organizationName: "Acme",
  minimumGroupSize: 4,
  aiProcessing: false,
  defaultLocale: "en",
  people: [
    {
      id: ADMIN,
      email: EmailAddress.make("admin@example.com"),
      workosUserId: WorkosUserId.make("user_admin"),
      organizationAdmin: true,
      removedAt: null,
      locale: null,
      detectedLocale: null,
    },
  ],
  teams: [],
  memberships: [],
};

/** A small Organization to run commands against, keeping every committed state. */
class World {
  state = initial;
  private ids = 0;
  now = 1_000 * DAY;

  newMember(email: string): NewMember {
    const n = ++this.ids;
    return {
      email: EmailAddress.make(email),
      personId: PersonId.make(`person-${n}`),
      membershipId: MembershipId.make(`membership-${n}`),
      signInUrl: "https://app.surveybeat.app/",
    };
  }

  run(actor: PersonId, command: DirectoryCommand): Decision {
    const decision = decide(this.state, actor, command, this.now);
    if (decision._tag === "Accepted") this.state = applyChanges(this.state, decision.changes);
    return decision;
  }

  /** Runs a command that must succeed. */
  ok(actor: PersonId, command: DirectoryCommand): Extract<Decision, { _tag: "Accepted" }> {
    const decision = this.run(actor, command);
    if (decision._tag !== "Accepted") throw new Error(`${command._tag} rejected: ${decision.rejection._tag}`);
    return decision;
  }

  createTeam(name: string, leadEmail: string): TeamId {
    const teamId = TeamId.make(`team-${++this.ids}`);
    this.ok(ADMIN, {
      _tag: "CreateTeam",
      teamId,
      name,
      timeZone: TimeZone.make("Europe/Berlin"),
      lead: this.newMember(leadEmail),
    });
    return teamId;
  }

  add(actor: PersonId, teamId: TeamId, email: string, role: "lead" | "member" = "member") {
    return this.run(actor, { _tag: "AddMember", teamId, role, member: this.newMember(email) });
  }

  personWith(email: string): PersonId {
    const person = this.state.people.find((each) => each.email === email);
    if (person === undefined) throw new Error(`no Person ${email}`);
    return person.id;
  }

  roster(teamId: TeamId) {
    const view = teamView(this.state, ADMIN, teamId);
    if (view._tag !== "Viewed") throw new Error("no roster");
    return view.value.roster.map(({ email, role }) => `${role} ${email}`);
  }
}

const rejection = (decision: Decision) =>
  decision._tag === "Rejected" ? decision.rejection._tag : "Accepted";

describe("adding members by email", () => {
  it("creates a Person with email only, a Membership, and the 'You've been added' email", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    const grace = world.personWith("grace@example.com");
    const decision = world.add(grace, platform, "Ada@Example.COM");
    if (decision._tag !== "Accepted") throw new Error("rejected");

    const ada = world.state.people.find((person) => person.email === "ada@example.com");
    expect(ada).toMatchObject({ workosUserId: null, organizationAdmin: false, removedAt: null });
    expect(world.roster(platform)).toEqual(["lead grace@example.com", "member ada@example.com"]);
    expect(decision.changes).toContainEqual({
      _tag: "EmailRequested",
      sendId: expect.stringMatching(/^added-/),
      recipient: "ada@example.com",
      email: {
        _tag: "AddedToTeam",
        teamName: "Platform",
        leadName: "grace@example.com",
        signInUrl: "https://app.surveybeat.app/",
        locale: "en",
      },
    });
    expect(decision.followUps.map((step) => step._tag)).toEqual(["IndexPerson", "QueueEmail"]);
  });

  it("reuses the Person an email already has, in any Team", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    const design = world.createTeam("Design", "linus@example.com");
    world.add(ADMIN, platform, "ada@example.com");
    world.add(ADMIN, design, "ada@example.com");
    expect(world.state.people.filter((person) => person.email === "ada@example.com")).toHaveLength(1);
  });

  it("changes nothing for someone already in the Team, but repeats the follow-ups", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    world.add(ADMIN, platform, "ada@example.com");
    const again = world.add(ADMIN, platform, "ada@example.com");
    expect(again).toMatchObject({ _tag: "Accepted", changes: [] });
    if (again._tag === "Accepted") {
      expect(again.followUps.map((step) => step._tag)).toEqual(["IndexPerson", "QueueEmail"]);
    }
    // Adding a Lead as a member does not demote them.
    expect(world.add(ADMIN, platform, "grace@example.com")).toMatchObject({ changes: [] });
    expect(world.roster(platform)).toEqual(["lead grace@example.com", "member ada@example.com"]);
  });

  it("lets only an admin or that Team's Lead add members, and only an admin assign Leads", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    const design = world.createTeam("Design", "linus@example.com");
    world.add(ADMIN, platform, "ada@example.com");
    const grace = world.personWith("grace@example.com");
    const ada = world.personWith("ada@example.com");
    const linus = world.personWith("linus@example.com");

    expect(rejection(world.add(ada, platform, "eve@example.com"))).toBe("Forbidden");
    expect(rejection(world.add(linus, platform, "eve@example.com"))).toBe("Forbidden");
    expect(rejection(world.add(grace, platform, "eve@example.com", "lead"))).toBe("Forbidden");
    expect(rejection(world.add(grace, design, "eve@example.com"))).toBe("Forbidden");
    expect(rejection(world.add(grace, platform, "eve@example.com"))).toBe("Accepted");
  });

  it("refuses a Team that does not exist without telling a non-admin whether it does", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    const grace = world.personWith("grace@example.com");
    const missing = TeamId.make("missing");
    expect(rejection(world.add(ADMIN, missing, "eve@example.com"))).toBe("TeamNotFound");
    expect(rejection(world.add(grace, missing, "eve@example.com"))).toBe("Forbidden");
    expect(rejection(world.add(grace, platform, "eve@example.com"))).toBe("Accepted");
  });
});

describe("Leads", () => {
  it("creates every Team with a Lead, and makes a member Lead by ending one Membership and starting another", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    world.add(ADMIN, platform, "ada@example.com");
    world.now += DAY;
    world.ok(ADMIN, {
      _tag: "AddMember",
      teamId: platform,
      role: "lead",
      member: world.newMember("ada@example.com"),
    });
    expect(world.roster(platform)).toEqual(["lead ada@example.com", "lead grace@example.com"]);
    const ada = world.personWith("ada@example.com");
    const history = world.state.memberships.filter((membership) => membership.personId === ada);
    expect(history.map(({ role, startedAt, endedAt }) => ({ role, startedAt, endedAt }))).toEqual([
      { role: "member", startedAt: 1_000 * DAY, endedAt: 1_001 * DAY },
      { role: "lead", startedAt: 1_001 * DAY, endedAt: null },
    ]);
  });

  it("never removes the last Lead, either as Lead or as member", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    const grace = world.personWith("grace@example.com");
    const removeLead = (personId: PersonId) =>
      world.run(ADMIN, {
        _tag: "RemoveLead",
        teamId: platform,
        personId,
        membershipId: MembershipId.make(`demoted-${personId}`),
      });

    expect(world.run(ADMIN, { _tag: "RemoveMember", teamId: platform, personId: grace })).toEqual({
      _tag: "Rejected",
      rejection: { _tag: "LastLead", teamId: platform },
    });
    expect(rejection(removeLead(grace))).toBe("LastLead");
    expect(rejection(world.run(ADMIN, { _tag: "RemovePerson", personId: grace }))).toBe("LastLead");

    world.add(ADMIN, platform, "ada@example.com", "lead");
    expect(rejection(removeLead(grace))).toBe("Accepted");
    expect(world.roster(platform)).toEqual(["lead ada@example.com", "member grace@example.com"]);
    expect(rejection(removeLead(world.personWith("ada@example.com")))).toBe("LastLead");
  });

  it("lets a Lead remove members but not another Lead", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    world.add(ADMIN, platform, "linus@example.com", "lead");
    world.add(ADMIN, platform, "ada@example.com");
    const grace = world.personWith("grace@example.com");
    const linus = world.personWith("linus@example.com");
    const ada = world.personWith("ada@example.com");
    expect(rejection(world.run(grace, { _tag: "RemoveMember", teamId: platform, personId: linus }))).toBe(
      "Forbidden",
    );
    expect(rejection(world.run(grace, { _tag: "RemoveMember", teamId: platform, personId: ada }))).toBe(
      "Accepted",
    );
    expect(rejection(world.run(ADMIN, { _tag: "RemoveMember", teamId: platform, personId: linus }))).toBe(
      "Accepted",
    );
  });
});

describe("removing", () => {
  it("ends a member's Membership on that date and keeps the Person and their history", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    world.add(ADMIN, platform, "ada@example.com");
    const ada = world.personWith("ada@example.com");
    world.now += 3 * DAY;
    world.ok(ADMIN, { _tag: "RemoveMember", teamId: platform, personId: ada });

    expect(world.roster(platform)).toEqual(["lead grace@example.com"]);
    expect(world.state.people.find((person) => person.id === ada)?.removedAt).toBeNull();
    expect(world.state.memberships.find((membership) => membership.personId === ada)).toMatchObject({
      startedAt: 1_000 * DAY,
      endedAt: 1_003 * DAY,
    });
    expect(rejection(world.run(ADMIN, { _tag: "RemoveMember", teamId: platform, personId: ada }))).toBe(
      "PersonNotFound",
    );
  });

  it("removes a Person from the Organization: every Membership ends, the record and history stay", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    const design = world.createTeam("Design", "linus@example.com");
    world.add(ADMIN, platform, "ada@example.com");
    world.add(ADMIN, design, "ada@example.com");
    const ada = world.personWith("ada@example.com");
    world.now += DAY;
    const removed = world.ok(ADMIN, { _tag: "RemovePerson", personId: ada });

    expect(world.state.people.find((person) => person.id === ada)?.removedAt).toBe(1_001 * DAY);
    const history = world.state.memberships.filter((membership) => membership.personId === ada);
    expect(history.map((membership) => membership.endedAt)).toEqual([1_001 * DAY, 1_001 * DAY]);
    expect(Option.isNone(actorOf(world.state, ada))).toBe(true);
    // Never signed in: only the index needs to forget them, WorkOS has no membership.
    expect(removed.followUps).toEqual([{ _tag: "UnindexPerson", personId: ada }]);
  });

  it("deactivates the WorkOS membership of a signed-in Person, and repeats the follow-ups on a retry", () => {
    const world = new World();
    world.state = {
      ...world.state,
      people: [
        ...world.state.people,
        {
          id: PersonId.make("ada"),
          email: EmailAddress.make("ada@example.com"),
          workosUserId: WorkosUserId.make("user_ada"),
          organizationAdmin: false,
          removedAt: null,
          locale: null,
          detectedLocale: null,
        },
      ],
    };
    const followUps = [
      { _tag: "UnindexPerson", personId: "ada" },
      { _tag: "DeactivateWorkosMembership", userId: "user_ada" },
    ];
    expect(world.ok(ADMIN, { _tag: "RemovePerson", personId: PersonId.make("ada") }).followUps).toEqual(
      followUps,
    );
    expect(world.ok(ADMIN, { _tag: "RemovePerson", personId: PersonId.make("ada") })).toEqual({
      _tag: "Accepted",
      changes: [],
      followUps,
    });
  });

  it("restores a removed Person added back, but only when an admin does it", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    world.add(ADMIN, platform, "ada@example.com");
    const grace = world.personWith("grace@example.com");
    const ada = world.personWith("ada@example.com");
    world.ok(ADMIN, { _tag: "SetAdmin", personId: ada, organizationAdmin: true });
    world.ok(ADMIN, { _tag: "RemovePerson", personId: ada });

    // A Lead adding a removed Person gets PersonWasRemoved.
    expect(rejection(world.add(grace, platform, "ada@example.com"))).toBe("PersonWasRemoved");

    // Only an admin may restore them.
    world.add(ADMIN, platform, "ada@example.com");

    expect(world.state.people.filter((person) => person.email === "ada@example.com")).toEqual([
      expect.objectContaining({ id: ada, removedAt: null, organizationAdmin: false }),
    ]);
    expect(world.state.memberships.filter((membership) => membership.personId === ada)).toHaveLength(2);
  });

  it("forbids removing yourself from the Organization, requiring another admin", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    world.add(ADMIN, platform, "ada@example.com");
    const grace = world.personWith("grace@example.com");
    const ada = world.personWith("ada@example.com");

    // Lead or member removing themselves is forbidden.
    expect(rejection(world.run(grace, { _tag: "RemovePerson", personId: grace }))).toBe("Forbidden");
    expect(rejection(world.run(ada, { _tag: "RemovePerson", personId: ada }))).toBe("Forbidden");

    // Admin removing themselves is forbidden even with another admin present.
    world.ok(ADMIN, { _tag: "SetAdmin", personId: grace, organizationAdmin: true });
    expect(rejection(world.run(ADMIN, { _tag: "RemovePerson", personId: ADMIN }))).toBe("Forbidden");

    // Another admin can remove them.
    expect(rejection(world.run(grace, { _tag: "RemovePerson", personId: ADMIN }))).toBe("Accepted");
  });

  it("refuses a removed Person's own commands and views", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    world.add(ADMIN, platform, "linus@example.com", "lead");
    const grace = world.personWith("grace@example.com");
    world.ok(ADMIN, { _tag: "RemovePerson", personId: grace });
    expect(rejection(world.add(grace, platform, "eve@example.com"))).toBe("Forbidden");
    expect(teamView(world.state, grace, platform)._tag).toBe("Rejected");
    expect(teamsView(world.state, grace)._tag).toBe("Rejected");
  });
});

describe("Organization admins", () => {
  it("keeps at least one admin", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    const grace = world.personWith("grace@example.com");
    expect(rejection(world.run(ADMIN, { _tag: "SetAdmin", personId: ADMIN, organizationAdmin: false }))).toBe(
      "LastAdmin",
    );
    expect(rejection(world.run(ADMIN, { _tag: "RemovePerson", personId: ADMIN }))).toBe("Forbidden");

    world.ok(ADMIN, { _tag: "SetAdmin", personId: grace, organizationAdmin: true });
    expect(rejection(world.run(grace, { _tag: "SetAdmin", personId: ADMIN, organizationAdmin: false }))).toBe(
      "Accepted",
    );
    expect(rejection(world.run(ADMIN, { _tag: "CreateTeam", ...newTeam(world) }))).toBe("Forbidden");
    expect(teamView(world.state, grace, platform)).toMatchObject({ value: { may: { manageLeads: true } } });
  });

  it("puts the WorkOS role in step for a signed-in Person only", () => {
    const world = new World();
    world.createTeam("Platform", "grace@example.com");
    const grace = world.personWith("grace@example.com");
    expect(world.ok(ADMIN, { _tag: "SetAdmin", personId: grace, organizationAdmin: true }).followUps).toEqual(
      [],
    );
    world.ok(grace, { _tag: "SetAdmin", personId: ADMIN, organizationAdmin: false });
    expect(world.ok(grace, { _tag: "SetAdmin", personId: ADMIN, organizationAdmin: true }).followUps).toEqual(
      [{ _tag: "SetWorkosRole", userId: "user_admin", role: "admin" }],
    );
  });

  it("sees every Team and administers it, but holds no role and no Results there", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    world.createTeam("Design", "linus@example.com");
    const teams = teamsView(world.state, ADMIN);
    expect(teams).toMatchObject({
      _tag: "Viewed",
      value: [
        { name: "Design", yourRole: null },
        { name: "Platform", yourRole: null },
      ],
    });
    expect(teamView(world.state, ADMIN, platform)).toMatchObject({
      _tag: "Viewed",
      value: {
        may: { update: true, manageLeads: true, manageMembers: true, managePulses: true, viewResults: false },
      },
    });
  });

  it("allows an admin to add themselves to a Team, visibly in the roster with their start date", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    const grace = world.personWith("grace@example.com");
    world.now += DAY;
    world.ok(ADMIN, {
      _tag: "AddMember",
      teamId: platform,
      role: "member",
      member: world.newMember("admin@example.com"),
    });

    const view = teamView(world.state, grace, platform);
    expect(view._tag).toBe("Viewed");
    if (view._tag === "Viewed") {
      expect(view.value.roster).toContainEqual({
        personId: ADMIN,
        email: "admin@example.com",
        role: "member",
        since: 1_001 * DAY,
      });
    }
  });
});

describe("views for non-admins", () => {
  it("shows a Lead their Teams and roster, and a member only their Teams", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    world.createTeam("Design", "linus@example.com");
    world.add(ADMIN, platform, "ada@example.com");
    const grace = world.personWith("grace@example.com");
    const ada = world.personWith("ada@example.com");

    expect(teamsView(world.state, grace)).toMatchObject({ value: [{ name: "Platform", yourRole: "lead" }] });
    expect(teamView(world.state, grace, platform)).toMatchObject({
      value: {
        may: {
          update: false,
          manageLeads: false,
          manageMembers: true,
          managePulses: true,
          viewResults: true,
        },
      },
    });
    expect(teamsView(world.state, ada)).toMatchObject({ value: [{ name: "Platform", yourRole: "member" }] });
    expect(teamView(world.state, ada, platform)).toEqual({
      _tag: "Rejected",
      rejection: { _tag: "Forbidden" },
    });
    expect(settingsView(world.state, grace)._tag).toBe("Rejected");
  });

  it("stops granting anything once a Membership ends", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    world.add(ADMIN, platform, "linus@example.com", "lead");
    const grace = world.personWith("grace@example.com");
    world.ok(ADMIN, { _tag: "RemoveMember", teamId: platform, personId: grace });
    expect(teamsView(world.state, grace)).toEqual({ _tag: "Viewed", value: [] });
    expect(rejection(world.add(grace, platform, "eve@example.com"))).toBe("Forbidden");
  });
});

describe("Teams", () => {
  it("keeps Team names unique within the Organization, ignoring case", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    expect(rejection(world.run(ADMIN, { _tag: "CreateTeam", ...newTeam(world), name: "platform" }))).toBe(
      "TeamNameTaken",
    );
    const rename = (name: string) =>
      world.run(ADMIN, { _tag: "UpdateTeam", teamId: platform, name, timeZone: TimeZone.make("UTC") });
    expect(rejection(rename("PLATFORM"))).toBe("Accepted");
    world.createTeam("Design", "linus@example.com");
    expect(rejection(rename("design"))).toBe("TeamNameTaken");
  });

  it("lets only an admin create or rename a Team", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    const grace = world.personWith("grace@example.com");
    expect(rejection(world.run(grace, { _tag: "CreateTeam", ...newTeam(world) }))).toBe("Forbidden");
    expect(
      rejection(
        world.run(grace, {
          _tag: "UpdateTeam",
          teamId: platform,
          name: "Core",
          timeZone: TimeZone.make("UTC"),
        }),
      ),
    ).toBe("Forbidden");
  });

  it("accepts IANA time zone names only", () => {
    const decode = Schema.decodeUnknownOption(TimeZone);
    for (const name of ["Europe/Berlin", "America/Argentina/Buenos_Aires", "UTC", "Etc/GMT+5"]) {
      expect(Option.isSome(decode(name)), name).toBe(true);
    }
    for (const name of ["+01:00", "Mars/Olympus", "Europe/Berlin ", "", "europe berlin"]) {
      expect(Option.isNone(decode(name)), name).toBe(true);
    }
  });
});

describe("the minimum group size", () => {
  it("is at least 3, defaults to 4, and only an admin changes it", () => {
    const decode = Schema.decodeUnknownOption(MinimumGroupSize);
    expect(Option.isNone(decode(2))).toBe(true);
    expect(Option.isNone(decode(3.5))).toBe(true);
    expect(Option.isSome(decode(3))).toBe(true);

    const world = new World();
    world.createTeam("Platform", "grace@example.com");
    expect(settingsView(world.state, ADMIN)).toMatchObject({ value: { minimumGroupSize: 4 } });
    const grace = world.personWith("grace@example.com");
    expect(rejection(world.run(grace, { _tag: "UpdateSettings", minimumGroupSize: 5 }))).toBe("Forbidden");
    world.ok(ADMIN, { _tag: "UpdateSettings", minimumGroupSize: 5 });
    expect(settingsView(world.state, ADMIN)).toMatchObject({ value: { minimumGroupSize: 5 } });
  });
});

describe("the AI processing setting", () => {
  it("is off by default, only an admin changes it, and it leaves the minimum group size alone", () => {
    const world = new World();
    world.createTeam("Platform", "grace@example.com");
    expect(settingsView(world.state, ADMIN)).toMatchObject({
      value: { aiProcessing: false, minimumGroupSize: 4 },
    });
    const grace = world.personWith("grace@example.com");
    expect(rejection(world.run(grace, { _tag: "UpdateSettings", aiProcessing: true }))).toBe("Forbidden");
    expect(settingsView(world.state, ADMIN)).toMatchObject({ value: { aiProcessing: false } });

    const turnedOn = world.ok(ADMIN, { _tag: "UpdateSettings", aiProcessing: true });
    expect(turnedOn.changes).toEqual([
      { _tag: "SettingsUpdated", minimumGroupSize: 4, aiProcessing: true, defaultLocale: "en" },
    ]);
    expect(settingsView(world.state, ADMIN)).toMatchObject({
      value: { aiProcessing: true, minimumGroupSize: 4 },
    });
  });

  it("changing the minimum group size alone keeps the AI processing setting", () => {
    const world = new World();
    world.ok(ADMIN, { _tag: "UpdateSettings", aiProcessing: true });
    world.ok(ADMIN, { _tag: "UpdateSettings", minimumGroupSize: 6 });
    expect(settingsView(world.state, ADMIN)).toMatchObject({
      value: { aiProcessing: true, minimumGroupSize: 6 },
    });
    world.ok(ADMIN, { _tag: "UpdateSettings", aiProcessing: false });
    expect(settingsView(world.state, ADMIN)).toMatchObject({
      value: { aiProcessing: false, minimumGroupSize: 6 },
    });
  });
});

function newTeam(world: World) {
  return {
    teamId: TeamId.make("new-team"),
    name: "New",
    timeZone: TimeZone.make("UTC"),
    lead: world.newMember("new-lead@example.com"),
  };
}

describe("languages (ADR 0018)", () => {
  const setPerson = (world: World, email: string, patch: Partial<DirectoryState["people"][number]>) => {
    world.state = {
      ...world.state,
      people: world.state.people.map((person) => (person.email === email ? { ...person, ...patch } : person)),
    };
  };

  const addedEmailLocale = (world: World, teamId: TeamId, email: string) => {
    const decision = world.add(ADMIN, teamId, email);
    if (decision._tag !== "Accepted") throw new Error("rejected");
    const sent = decision.changes.find((change) => change._tag === "EmailRequested");
    if (sent?._tag !== "EmailRequested" || sent.email._tag !== "AddedToTeam") throw new Error("no email");
    return sent.email.locale;
  };

  describe("emailLocaleOf", () => {
    const base = (people: DirectoryState["people"], defaultLocale: "en" | "de"): DirectoryState => ({
      organizationName: "Acme",
      minimumGroupSize: 4,
      aiProcessing: false,
      defaultLocale,
      people,
      teams: [],
      memberships: [],
    });
    const ada = (locale: "en" | "de" | null, detectedLocale: "en" | "de" | null) => ({
      id: PersonId.make("ada"),
      email: EmailAddress.make("ada@example.com"),
      workosUserId: null,
      organizationAdmin: false,
      removedAt: null,
      locale,
      detectedLocale,
    });

    it("prefers the Person's own choice, then the browser language, then the Organization default", () => {
      const adaId = PersonId.make("ada");
      expect(emailLocaleOf(base([ada("de", "en")], "en"), adaId)).toBe("de");
      expect(emailLocaleOf(base([ada(null, "de")], "en"), adaId)).toBe("de");
      expect(emailLocaleOf(base([ada(null, null)], "de"), adaId)).toBe("de");
      expect(emailLocaleOf(base([ada(null, null)], "en"), adaId)).toBe("en");
    });

    it("is the Organization default for a Person who is not in the state", () => {
      expect(emailLocaleOf(base([], "de"), PersonId.make("nobody"))).toBe("de");
    });
  });

  it("UpdateOwnLanguage sets the actor's own language and keeps the fields it omits", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    world.add(ADMIN, platform, "ada@example.com");
    const grace = world.personWith("grace@example.com");
    const ada = world.personWith("ada@example.com");

    world.ok(ada, { _tag: "UpdateOwnLanguage", detectedLocale: "de" });
    expect(world.state.people.find((person) => person.id === ada)).toMatchObject({
      locale: null,
      detectedLocale: "de",
    });

    const chosen = world.ok(ada, { _tag: "UpdateOwnLanguage", locale: "en" });
    expect(chosen.changes).toEqual([
      { _tag: "PersonLanguageSet", personId: ada, locale: "en", detectedLocale: "de" },
    ]);
    expect(world.state.people.find((person) => person.id === ada)).toMatchObject({
      locale: "en",
      detectedLocale: "de",
    });

    world.ok(ada, { _tag: "UpdateOwnLanguage", locale: null });
    expect(world.state.people.find((person) => person.id === ada)).toMatchObject({
      locale: null,
      detectedLocale: "de",
    });
    expect(world.state.people.find((person) => person.id === grace)).toMatchObject({ locale: null });
  });

  it("lets a plain member set only their own language, never someone else's", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    world.add(ADMIN, platform, "ada@example.com");
    const ada = world.personWith("ada@example.com");
    const grace = world.personWith("grace@example.com");

    world.ok(grace, { _tag: "UpdateOwnLanguage", locale: "de" });
    expect(world.state.people.find((person) => person.id === grace)).toMatchObject({ locale: "de" });
    expect(world.state.people.find((person) => person.id === ada)).toMatchObject({ locale: null });
  });

  it("refuses a removed Person", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");
    world.add(ADMIN, platform, "ada@example.com");
    const ada = world.personWith("ada@example.com");
    world.ok(ADMIN, { _tag: "RemovePerson", personId: ada });
    expect(rejection(world.run(ada, { _tag: "UpdateOwnLanguage", locale: "de" }))).toBe("Forbidden");
  });

  it("UpdateSettings sets the Organization default only for admins, and keeps it when omitted", () => {
    const world = new World();
    world.createTeam("Platform", "grace@example.com");
    expect(settingsView(world.state, ADMIN)).toMatchObject({ value: { defaultLocale: "en" } });
    const grace = world.personWith("grace@example.com");
    expect(rejection(world.run(grace, { _tag: "UpdateSettings", defaultLocale: "de" }))).toBe("Forbidden");

    const changed = world.ok(ADMIN, { _tag: "UpdateSettings", defaultLocale: "de" });
    expect(changed.changes).toEqual([
      { _tag: "SettingsUpdated", minimumGroupSize: 4, aiProcessing: false, defaultLocale: "de" },
    ]);
    expect(settingsView(world.state, ADMIN)).toMatchObject({ value: { defaultLocale: "de" } });

    world.ok(ADMIN, { _tag: "UpdateSettings", minimumGroupSize: 6 });
    expect(settingsView(world.state, ADMIN)).toMatchObject({
      value: { defaultLocale: "de", minimumGroupSize: 6 },
    });
  });

  it("the 'You've been added' email follows the recipient's language", () => {
    const world = new World();
    const platform = world.createTeam("Platform", "grace@example.com");

    // A brand-new Person has no language yet: the Organization default.
    expect(addedEmailLocale(world, platform, "new@example.com")).toBe("en");
    world.ok(ADMIN, { _tag: "UpdateSettings", defaultLocale: "de" });
    expect(addedEmailLocale(world, platform, "newer@example.com")).toBe("de");

    // An existing Person's own choice, then their browser language.
    const ada = world.personWith("new@example.com");
    world.ok(ada, { _tag: "UpdateOwnLanguage", locale: "de" });
    expect(addedEmailLocale(world, world.createTeam("Design", "linus@example.com"), "new@example.com")).toBe(
      "de",
    );
    setPerson(world, "new@example.com", { locale: null, detectedLocale: "en" });
    expect(addedEmailLocale(world, world.createTeam("Ops", "lena@example.com"), "new@example.com")).toBe(
      "en",
    );
  });
});
