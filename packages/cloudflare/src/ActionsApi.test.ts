import { describe, expect, it } from "@effect/vitest";
import { Browser, SignInWorld } from "./auth/testing.ts";

const setup = async () => {
  const world = new SignInWorld();
  const acme = world.addOrganization("Acme");
  world.addPerson(acme.id, "admin@example.com", true);

  const as = async (email: string) => {
    const browser = new Browser(world.handler());
    await browser.signIn(world.workos.addUser(email));
    await browser.session();
    return browser;
  };

  const admin = await as("admin@example.com");

  // Create team Platform with Grace as Lead
  const created = await admin.call("POST", "/api/teams", {
    name: "Platform",
    timeZone: "Europe/Berlin",
    leadEmail: "grace@example.com",
  });
  const teamId = (created.body as { readonly team: { readonly id: string } }).team.id;

  // Create another team Design with Linus as Lead
  const other = await admin.call("POST", "/api/teams", {
    name: "Design",
    timeZone: "UTC",
    leadEmail: "linus@example.com",
  });
  const otherTeamId = (other.body as { readonly team: { readonly id: string } }).team.id;

  const lead = await as("grace@example.com");
  // Add Ada as Member in Platform
  const addedMember = await lead.call("POST", `/api/teams/${teamId}/members`, { email: "ada@example.com" });
  expect(addedMember.status).toBe(204);

  // Get roster to find PersonId for Ada and Grace
  const teamDetail = await lead.call("GET", `/api/teams/${teamId}`);
  expect(teamDetail.status).toBe(200);
  const roster = (
    teamDetail.body as {
      readonly roster: ReadonlyArray<{
        readonly personId: string;
        readonly email: string;
        readonly role: string;
      }>;
    }
  ).roster;
  const adaPerson = roster.find((r) => r.email === "ada@example.com")!;
  const gracePerson = roster.find((r) => r.email === "grace@example.com")!;

  const member = await as("ada@example.com");
  const otherLead = await as("linus@example.com");

  return { world, admin, lead, member, otherLead, teamId, otherTeamId, adaPerson, gracePerson };
};

describe("Actions API", () => {
  it("allows Lead to create an Action from a Result and list it", async () => {
    const { lead, member, teamId, adaPerson } = await setup();

    const roundId = "round-1";
    const createRes = await lead.call("POST", `/api/teams/${teamId}/actions`, {
      roundId,
      title: "Shorten pairing sessions",
      ownerId: adaPerson.personId,
      dueDate: "2026-11-20",
      dimension: "workload",
    });

    expect(createRes.status).toBe(200);
    const createdAction = createRes.body as {
      readonly id: string;
      readonly teamId: string;
      readonly roundId: string;
      readonly title: string;
      readonly ownerId: string;
      readonly ownerEmail: string;
      readonly dueDate: string | null;
      readonly dimension: string | null;
      readonly status: string;
      readonly doneAt: number | null;
    };

    expect(createdAction.title).toBe("Shorten pairing sessions");
    expect(createdAction.ownerId).toBe(adaPerson.personId);
    expect(createdAction.ownerEmail).toBe("ada@example.com");
    expect(createdAction.dueDate).toBe("2026-11-20");
    expect(createdAction.dimension).toBe("workload");
    expect(createdAction.status).toBe("committed");
    expect(createdAction.doneAt).toBeNull();

    // Member can view Actions list
    const listRes = await member.call("GET", `/api/teams/${teamId}/actions`);
    expect(listRes.status).toBe(200);
    const list = listRes.body as { readonly actions: ReadonlyArray<typeof createdAction> };
    expect(list.actions).toHaveLength(1);
    expect(list.actions[0]!.title).toBe("Shorten pairing sessions");
  });

  it("allows Lead to update an Action status to done and dropped", async () => {
    const { lead, teamId, gracePerson } = await setup();

    const createRes = await lead.call("POST", `/api/teams/${teamId}/actions`, {
      roundId: "round-1",
      title: "Update onboarding docs",
      ownerId: gracePerson.personId,
      dueDate: null,
      dimension: null,
    });
    expect(createRes.status).toBe(200);
    const actionId = (createRes.body as { readonly id: string }).id;

    // Mark as done
    const doneRes = await lead.call("PATCH", `/api/teams/${teamId}/actions/${actionId}`, {
      status: "done",
    });
    expect(doneRes.status).toBe(200);
    const doneAction = doneRes.body as { readonly status: string; readonly doneAt: number | null };
    expect(doneAction.status).toBe("done");
    expect(doneAction.doneAt).not.toBeNull();

    // Reopen / set to dropped
    const droppedRes = await lead.call("PATCH", `/api/teams/${teamId}/actions/${actionId}`, {
      status: "dropped",
    });
    expect(droppedRes.status).toBe(200);
    const droppedAction = droppedRes.body as { readonly status: string; readonly doneAt: number | null };
    expect(droppedAction.status).toBe("dropped");
    expect(droppedAction.doneAt).toBeNull();
  });

  it("rejects non-members and organization admin without membership (ADR 0003)", async () => {
    const { admin, member, otherLead, teamId, adaPerson } = await setup();

    // Org admin without team membership cannot create action
    const adminCreate = await admin.call("POST", `/api/teams/${teamId}/actions`, {
      roundId: "round-1",
      title: "Admin action",
      ownerId: adaPerson.personId,
      dueDate: null,
      dimension: null,
    });
    expect(adminCreate.status).toBe(403);

    // Org admin without team membership cannot view actions
    const adminView = await admin.call("GET", `/api/teams/${teamId}/actions`);
    expect(adminView.status).toBe(403);

    // Outsider (Lead of another team) cannot view actions
    const otherView = await otherLead.call("GET", `/api/teams/${teamId}/actions`);
    expect(otherView.status).toBe(403);

    // Regular member cannot create action (Leads only)
    const memberCreate = await member.call("POST", `/api/teams/${teamId}/actions`, {
      roundId: "round-1",
      title: "Member action",
      ownerId: adaPerson.personId,
      dueDate: null,
      dimension: null,
    });
    expect(memberCreate.status).toBe(403);
  });

  it("rejects assigning an owner who is not in the team", async () => {
    const { lead, teamId, otherLead } = await setup();

    // Get Linus's personId
    const linusDetail = await otherLead.session();
    const linusPersonId = (linusDetail.body as { readonly personId: string }).personId;

    const res = await lead.call("POST", `/api/teams/${teamId}/actions`, {
      roundId: "round-1",
      title: "Cross-team action",
      ownerId: linusPersonId,
      dueDate: null,
      dimension: null,
    });
    expect(res.status).toBe(400);
  });
});
