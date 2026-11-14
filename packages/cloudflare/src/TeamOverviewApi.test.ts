// @effect-diagnostics asyncFunction:off -- the vitest runner awaits a plain Promise here; the test never enters an Effect.

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

  const created = await admin.call("POST", "/api/teams", {
    name: "Platform",
    timeZone: "Europe/Berlin",
    leadEmail: "grace@example.com",
  });
  const teamId = (created.body as { readonly team: { readonly id: string } }).team.id;

  const lead = await as("grace@example.com");
  const addedMember = await lead.call("POST", `/api/teams/${teamId}/members`, { email: "ada@example.com" });
  expect(addedMember.status).toBe(204);

  const member = await as("ada@example.com");
  const outsider = await as("linus@example.com");

  return { admin, lead, member, outsider, teamId };
};

describe("Team overview API (Issue #107, ADR 0003)", () => {
  it("authorizes the overview route: Team members and Leads get 200, Organization admins outside the Team get 403", async () => {
    const { admin, lead, member, outsider, teamId } = await setup();

    const adminView = await admin.call("GET", `/api/teams/${teamId}/overview`);
    expect(adminView.status).toBe(403);

    const outsiderView = await outsider.call("GET", `/api/teams/${teamId}/overview`);
    expect(outsiderView.status).toBe(403);

    const memberView = await member.call("GET", `/api/teams/${teamId}/overview`);
    expect(memberView.status).toBe(200);
    expect(memberView.body).toMatchObject({ teamId, rounds: [], dimensions: [], markers: [] });

    const leadView = await lead.call("GET", `/api/teams/${teamId}/overview`);
    expect(leadView.status).toBe(200);
  });
});
