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
  const anonymous = new Browser(world.handler());

  return { member, anonymous };
};

describe("Member history API (Issue #108, ADR 0017)", () => {
  it("answers a signed-in member with their history, and an unauthenticated browser with 401", async () => {
    const { member, anonymous } = await setup();

    const memberView = await member.call("GET", "/api/me/history");
    expect(memberView.status).toBe(200);
    expect(memberView.body).toEqual({ rounds: [] });

    const anonymousView = await anonymous.call("GET", "/api/me/history");
    expect(anonymousView.status).toBe(401);
  });
});
