// @effect-diagnostics asyncFunction:off -- the vitest runner awaits a plain Promise here; the test never enters an Effect.

import { describe, expect, it } from "@effect/vitest";
import { SendId } from "@surveybeat/domain";
import type { OrganizationId, PersonId, SendState } from "@surveybeat/domain";
import { Browser, ORIGIN, SignInWorld } from "./testing.ts";

/**
 * The directory API over HTTP: real handlers, the real domain rules and permission table, and
 * in-memory stand-ins for sign-in, the D1 index, the Organization Durable Objects, and the email
 * queue. Each role signs in through the in-memory provider and is linked by verified email.
 */

const setup = async () => {
  const world = new SignInWorld();
  const acme = world.addOrganization("Acme");
  const adminId = world.addPerson(acme.id, "admin@example.com", true);

  const as = async (email: string) => {
    const browser = new Browser(world.handler());
    browser.signIn(world.sessions.login(email));
    const session = await browser.session();

    return { browser, session };
  };

  const admin = (await as("admin@example.com")).browser;
  expect((await admin.session()).body).toMatchObject({ _tag: "SignedIn", organizationAdmin: true });

  const created = await admin.call("POST", "/api/teams", {
    name: "Platform",
    timeZone: "Europe/Berlin",
    leadEmail: "Grace@Example.com",
  });

  expect(created.status).toBe(200);
  const teamId = teamIdOf(created.body);
  const lead = (await as("grace@example.com")).browser;
  expect((await lead.call("POST", `/api/teams/${teamId}/members`, { email: "ada@example.com" })).status).toBe(
    204,
  );
  const member = (await as("ada@example.com")).browser;
  const personId = (email: string) => personIdOf(world, acme.id, email);

  return { world, acme, adminId, admin, lead, member, teamId, as, personId };
};

const teamIdOf = (body: unknown): string => {
  if (typeof body === "object" && body !== null && "team" in body) {
    const { team } = body;

    if (typeof team === "object" && team !== null && "id" in team && typeof team.id === "string") {
      return team.id;
    }
  }

  throw new Error("no Team in the response");
};

const personIdOf = (world: SignInWorld, organizationId: OrganizationId, email: string): PersonId => {
  const person = world.durable.organizations
    .get(organizationId)
    ?.state.people.find((each) => each.email === email);

  if (person === undefined) {
    throw new Error(`no Person ${email}`);
  }

  return person.id;
};

const roster = async (browser: Browser, teamId: string) => {
  const { status, body } = await browser.call("GET", `/api/teams/${teamId}`);
  expect(status).toBe(200);

  if (typeof body !== "object" || body === null || !("roster" in body) || !Array.isArray(body.roster)) {
    throw new Error("no roster");
  }

  return body.roster.map((entry: { role: string; email: string }) => `${entry.role} ${entry.email}`);
};

describe("an Organization admin", () => {
  it("creates a Team with its Lead: a Person with email only, a Membership, and the email", async () => {
    const world = new SignInWorld();
    const acme = world.addOrganization("Acme");
    world.addPerson(acme.id, "admin@example.com", true);
    const admin = new Browser(world.handler());
    admin.signIn(world.sessions.login("admin@example.com"));
    await admin.session();

    const created = await admin.call("POST", "/api/teams", {
      name: "Platform",
      timeZone: "Europe/Berlin",
      leadEmail: "grace@example.com",
    });

    expect(created).toMatchObject({
      status: 200,
      body: {
        team: { name: "Platform", timeZone: "Europe/Berlin", yourRole: null },
        roster: [{ email: "grace@example.com", role: "lead" }],
        may: { update: true, manageLeads: true, manageMembers: true, managePulses: true, viewResults: false },
      },
    });
    const grace = personIdOf(world, acme.id, "grace@example.com");
    expect(world.durable.person(acme.id, grace)).toMatchObject({
      authUserId: null,
      organizationAdmin: false,
    });
    // Linkable at sign-in: the index offers the Person to that verified email.
    expect(world.index.persons.get(`${acme.id}/${grace}`)).toMatchObject({
      email: "grace@example.com",
      userId: null,
    });
    const sends = [...(world.durable.organizations.get(acme.id)?.sends.entries() ?? [])];
    expect(sends).toHaveLength(1);
    expect(sends[0]?.[1]).toEqual({
      recipient: "grace@example.com",
      email: {
        _tag: "AddedToTeam",
        locale: "en",
        teamName: "Platform",
        leadName: "admin@example.com",
        signInUrl: `${ORIGIN}/`,
      },
      state: { _tag: "Pending", attempts: 0, lastCode: null },
    });
  });

  it("sees every Team and its roster, but holds no role and may not see Results", async () => {
    const { admin, teamId } = await setup();
    expect(await admin.call("GET", "/api/teams")).toMatchObject({
      status: 200,
      // Two people in the Team, and no Round scheduled yet.
      body: [{ id: teamId, name: "Platform", yourRole: null, memberCount: 2, nextRoundDate: null }],
    });
    expect(await roster(admin, teamId)).toEqual(["lead grace@example.com", "member ada@example.com"]);
    expect((await admin.call("GET", `/api/teams/${teamId}`)).body).toMatchObject({
      may: { viewResults: false },
    });
  });

  it("renames a Team and changes its time zone, refusing unknown zones and taken names", async () => {
    const { admin, teamId } = await setup();
    expect(
      (await admin.call("PATCH", `/api/teams/${teamId}`, { name: "Core", timeZone: "UTC" })).status,
    ).toBe(204);
    expect((await admin.call("GET", `/api/teams/${teamId}`)).body).toMatchObject({
      team: { name: "Core", timeZone: "UTC" },
    });
    expect(
      (await admin.call("PATCH", `/api/teams/${teamId}`, { name: "Core", timeZone: "Mars/Base" })).status,
    ).toBe(400);
    expect(
      (await admin.call("POST", "/api/teams", { name: "core", timeZone: "UTC", leadEmail: "x@example.com" }))
        .body,
    ).toMatchObject({ _tag: "TeamNameTaken" });
    expect((await admin.call("PATCH", "/api/teams/missing", { name: "X", timeZone: "UTC" })).status).toBe(
      404,
    );
  });

  it("assigns and removes Leads, never the last one", async () => {
    const { admin, teamId, personId } = await setup();

    const removeGrace = () =>
      admin.call("DELETE", `/api/teams/${teamId}/leads/${personId("grace@example.com")}`);

    expect(await removeGrace()).toMatchObject({ status: 409, body: { _tag: "LastLead" } });
    expect(
      (await admin.call("POST", `/api/teams/${teamId}/leads`, { email: "ada@example.com" })).status,
    ).toBe(204);
    expect(await roster(admin, teamId)).toEqual(["lead ada@example.com", "lead grace@example.com"]);
    expect((await removeGrace()).status).toBe(204);
    expect(await roster(admin, teamId)).toEqual(["lead ada@example.com", "member grace@example.com"]);
  });

  it("removes a Person: Memberships end, sign-in drops them, the next request denies them", async () => {
    const { world, acme, admin, lead, member, teamId, personId } = await setup();
    const ada = personId("ada@example.com");

    expect((await admin.call("DELETE", `/api/organization/people/${ada}`)).status).toBe(204);
    expect(world.durable.person(acme.id, ada)?.removedAt).not.toBeNull();
    expect(world.index.persons.get(`${acme.id}/${ada}`)?.removedAt).toEqual(expect.any(Number));
    // History stays: the Membership is ended, not deleted.
    const memberships = world.durable.organizations.get(acme.id)?.state.memberships ?? [];
    expect(memberships.filter((membership) => membership.personId === ada)).toEqual([
      expect.objectContaining({ role: "member", endedAt: expect.any(Number) }),
    ]);
    expect(await roster(admin, teamId)).toEqual(["lead grace@example.com"]);

    // Their still-valid access token no longer gets them in: the Durable Object says no.
    expect(await member.session()).toEqual({ status: 200, body: { _tag: "NotInOrganization" } });
    expect((await member.call("GET", "/api/teams")).status).toBe(403);

    // Only an admin can restore a removed Person; a Lead gets 403 PersonWasRemoved.
    expect(
      await lead.call("POST", `/api/teams/${teamId}/members`, { email: "ada@example.com" }),
    ).toMatchObject({
      status: 403,
      body: { _tag: "PersonWasRemoved" },
    });
    expect(
      (await admin.call("POST", `/api/teams/${teamId}/members`, { email: "ada@example.com" })).status,
    ).toBe(204);
    expect(world.index.persons.get(`${acme.id}/${ada}`)?.removedAt).toBeNull();
  });

  it("refuses to remove a Team's last Lead, revoke the last admin, or remove yourself", async () => {
    const { admin, adminId, personId, lead, member } = await setup();
    expect(
      await admin.call("DELETE", `/api/organization/people/${personId("grace@example.com")}`),
    ).toMatchObject({
      status: 409,
      body: { _tag: "LastLead" },
    });
    expect(await admin.call("DELETE", `/api/organization/admins/${adminId}`)).toMatchObject({
      status: 409,
      body: { _tag: "LastAdmin" },
    });
    // Removing yourself from the Organization is forbidden for admins, Leads, and members.
    expect(await admin.call("DELETE", `/api/organization/people/${adminId}`)).toMatchObject({
      status: 403,
      body: { _tag: "Forbidden" },
    });
    expect(
      (await lead.call("DELETE", `/api/organization/people/${personId("grace@example.com")}`)).status,
    ).toBe(403);
    expect(
      (await member.call("DELETE", `/api/organization/people/${personId("ada@example.com")}`)).status,
    ).toBe(403);
  });

  it("allows an admin to add themselves to a Team, visibly in the roster with start date", async () => {
    const { admin, lead, teamId } = await setup();
    expect(
      (await admin.call("POST", `/api/teams/${teamId}/members`, { email: "admin@example.com" })).status,
    ).toBe(204);
    const teamRoster = await roster(lead, teamId);
    expect(teamRoster).toContain("member admin@example.com");
  });

  it("reads and sets the minimum group size, at least 3 and 4 by default", async () => {
    const { admin } = await setup();
    expect(await admin.call("GET", "/api/organization")).toMatchObject({
      status: 200,
      body: {
        name: "Acme",
        minimumGroupSize: 4,
        people: [
          { email: "ada@example.com", organizationAdmin: false, linked: true },
          { email: "admin@example.com", organizationAdmin: true, linked: true },
          { email: "grace@example.com", organizationAdmin: false, linked: true },
        ],
      },
    });
    expect((await admin.call("PATCH", "/api/organization", { minimumGroupSize: 2 })).status).toBe(400);
    expect((await admin.call("PATCH", "/api/organization", { minimumGroupSize: 5 })).status).toBe(204);
    expect((await admin.call("GET", "/api/organization")).body).toMatchObject({ minimumGroupSize: 5 });
  });

  it("reads the Organization's default language, which the session carries (ADR 0018, ADR 0025)", async () => {
    const { admin, lead } = await setup();
    expect((await admin.call("GET", "/api/organization")).body).toMatchObject({ defaultLocale: "en" });
    expect((await admin.session()).body).toMatchObject({ organizationLocale: "en" });
    expect((await admin.call("PATCH", "/api/organization", { defaultLocale: "en" })).status).toBe(204);
    expect((await admin.call("PATCH", "/api/organization", { defaultLocale: "de" })).status).toBe(400);
    expect((await admin.call("GET", "/api/organization")).body).toMatchObject({ defaultLocale: "en" });
    expect((await lead.call("PATCH", "/api/organization", { defaultLocale: "en" })).status).toBe(403);
  });

  it("lets each Person set their own language, which the session carries, and nobody else's", async () => {
    const { admin, member } = await setup();
    expect((await member.session()).body).toMatchObject({ locale: null, detectedLocale: null });
    expect((await member.call("PATCH", "/api/me/language", { locale: "en" })).status).toBe(204);
    expect((await member.session()).body).toMatchObject({ locale: "en", detectedLocale: null });
    expect((await member.call("PATCH", "/api/me/language", { detectedLocale: "en" })).status).toBe(204);
    expect((await member.session()).body).toMatchObject({ locale: "en", detectedLocale: "en" });
    expect((await member.call("PATCH", "/api/me/language", { locale: null })).status).toBe(204);
    expect((await member.session()).body).toMatchObject({ locale: null, detectedLocale: "en" });
    expect((await member.call("PATCH", "/api/me/language", { locale: "fr" })).status).toBe(400);
    expect((await member.call("PATCH", "/api/me/language", { locale: "de" })).status).toBe(400);
    expect((await admin.session()).body).toMatchObject({ locale: null, detectedLocale: null });
  });

  it("makes another Person admin in the Durable Object", async () => {
    const { admin, lead, personId, adminId } = await setup();
    const grace = personId("grace@example.com");
    expect((await admin.call("PUT", `/api/organization/admins/${grace}`)).status).toBe(204);
    expect((await lead.session()).body).toMatchObject({ organizationAdmin: true });
    expect((await lead.call("DELETE", `/api/organization/admins/${adminId}`)).status).toBe(204);
    expect((await admin.session()).body).toMatchObject({ organizationAdmin: false });
    expect((await admin.call("GET", "/api/organization")).status).toBe(403);
  });

  it("is judged by the Durable Object, not by the session", async () => {
    const { world, acme, admin, adminId } = await setup();
    world.durable.update(acme.id, adminId, { organizationAdmin: false });
    expect((await admin.session()).body).toMatchObject({ _tag: "SignedIn", organizationAdmin: false });
    expect((await admin.call("GET", "/api/organization")).status).toBe(403);
    expect(
      (await admin.call("POST", "/api/teams", { name: "X", timeZone: "UTC", leadEmail: "x@example.com" }))
        .status,
    ).toBe(403);
  });
});

describe("a Lead", () => {
  it("adds members by email, sending the email once per Membership", async () => {
    const { world, acme, lead, teamId } = await setup();
    const sendCount = () => world.durable.organizations.get(acme.id)?.sends.size ?? 0;
    const before = sendCount();
    expect(
      (await lead.call("POST", `/api/teams/${teamId}/members`, { email: "Linus@Example.com" })).status,
    ).toBe(204);
    expect(await roster(lead, teamId)).toEqual([
      "lead grace@example.com",
      "member ada@example.com",
      "member linus@example.com",
    ]);
    expect(sendCount()).toBe(before + 1);
    // Adding again changes nothing, and makes no second send for the same Membership.
    await lead.call("POST", `/api/teams/${teamId}/members`, { email: "linus@example.com" });
    expect(sendCount()).toBe(before + 1);
    expect(await roster(lead, teamId)).toHaveLength(3);
  });

  it("removes a member, ending the Membership on that date and keeping the Person", async () => {
    const { world, acme, lead, member, teamId, personId } = await setup();
    const ada = personId("ada@example.com");
    expect((await lead.call("DELETE", `/api/teams/${teamId}/members/${ada}`)).status).toBe(204);
    expect(await roster(lead, teamId)).toEqual(["lead grace@example.com"]);
    expect(world.durable.person(acme.id, ada)?.removedAt).toBeNull();
    // Still a Person of the Organization, in no Team now.
    expect(await member.call("GET", "/api/teams")).toEqual({ status: 200, body: [] });
    expect((await lead.call("DELETE", `/api/teams/${teamId}/members/${ada}`)).status).toBe(404);
  });

  it("may not assign or remove Leads, rename the Team, or touch Organization settings", async () => {
    const { lead, teamId, personId, adminId } = await setup();
    const grace = personId("grace@example.com");

    for (const [method, path, body] of [
      ["POST", `/api/teams/${teamId}/leads`, { email: "ada@example.com" }],
      ["DELETE", `/api/teams/${teamId}/leads/${grace}`, undefined],
      ["DELETE", `/api/teams/${teamId}/members/${grace}`, undefined],
      ["PATCH", `/api/teams/${teamId}`, { name: "Mine", timeZone: "UTC" }],
      ["POST", "/api/teams", { name: "Mine", timeZone: "UTC", leadEmail: "x@example.com" }],
      ["GET", "/api/organization", undefined],
      ["PATCH", "/api/organization", { minimumGroupSize: 3 }],
      ["PUT", `/api/organization/admins/${grace}`, undefined],
      ["DELETE", `/api/organization/admins/${adminId}`, undefined],
      ["DELETE", `/api/organization/people/${personId("ada@example.com")}`, undefined],
    ] as const) {
      expect((await lead.call(method, path, body)).status, `${method} ${path}`).toBe(403);
    }
  });

  it("loses the Team at once when their Membership ends", async () => {
    const { admin, lead, teamId, personId } = await setup();
    await admin.call("POST", `/api/teams/${teamId}/leads`, { email: "ada@example.com" });
    expect(
      (await admin.call("DELETE", `/api/teams/${teamId}/members/${personId("grace@example.com")}`)).status,
    ).toBe(204);
    expect((await lead.call("GET", `/api/teams/${teamId}`)).status).toBe(403);
    expect(
      (await lead.call("POST", `/api/teams/${teamId}/members`, { email: "eve@example.com" })).status,
    ).toBe(403);
    expect(await lead.call("GET", "/api/teams")).toEqual({ status: 200, body: [] });
  });

  it("sees only their own Teams", async () => {
    const { admin, lead } = await setup();
    await admin.call("POST", "/api/teams", {
      name: "Design",
      timeZone: "UTC",
      leadEmail: "linus@example.com",
    });
    expect(await lead.call("GET", "/api/teams")).toMatchObject({
      status: 200,
      body: [{ name: "Platform", yourRole: "lead" }],
    });
  });
});

describe("a member", () => {
  it("sees their Teams but no roster, and changes nothing", async () => {
    const { member, teamId, personId } = await setup();
    expect(await member.call("GET", "/api/teams")).toMatchObject({
      status: 200,
      body: [{ id: teamId, yourRole: "member" }],
    });
    expect((await member.call("GET", `/api/teams/${teamId}`)).status).toBe(403);
    expect(
      (await member.call("POST", `/api/teams/${teamId}/members`, { email: "eve@example.com" })).status,
    ).toBe(403);
    expect(
      (await member.call("DELETE", `/api/teams/${teamId}/members/${personId("ada@example.com")}`)).status,
    ).toBe(403);
    expect((await member.call("GET", "/api/organization")).status).toBe(403);
  });
});

describe("erasing a Person (GDPR 307)", () => {
  const erase = (browser: Browser, personId: PersonId, confirmation: string) =>
    browser.call("POST", `/api/organization/people/${personId}/erasure`, { confirmation });

  it("scrubs a Person for an admin once the address is typed, and sign-in no longer finds them", async () => {
    const { world, acme, admin, member, teamId, personId } = await setup();
    const ada = personId("ada@example.com");

    expect((await erase(admin, ada, "ada@example.com")).status).toBe(204);

    expect(world.durable.person(acme.id, ada)).toMatchObject({
      email: `erased-${ada}@erased.invalid`,
      authUserId: null,
      organizationAdmin: false,
      removedAt: expect.any(Number),
      erasedAt: expect.any(Number),
    });

    expect(world.index.persons.has(`${acme.id}/${ada}`)).toBe(false);
    expect(await roster(admin, teamId)).toEqual(["lead grace@example.com"]);
    expect(await member.session()).toEqual({ status: 200, body: { _tag: "NotInOrganization" } });
    expect(world.index.erasedAccounts.size).toBe(1);
  });

  it("refuses without the exact address, and changes nothing", async () => {
    const { world, acme, admin, personId } = await setup();
    const ada = personId("ada@example.com");

    expect(await erase(admin, ada, "someone@example.com")).toMatchObject({
      status: 422,
      body: { _tag: "ErasureNotConfirmed" },
    });

    expect(world.durable.person(acme.id, ada)).toMatchObject({
      email: "ada@example.com",
      erasedAt: null,
      removedAt: null,
    });
  });

  it("accepts the address in any case", async () => {
    const { world, acme, admin, personId } = await setup();
    const ada = personId("ada@example.com");

    expect((await erase(admin, ada, "ADA@Example.com")).status).toBe(204);
    expect(world.durable.person(acme.id, ada)?.erasedAt).toEqual(expect.any(Number));
  });

  it("erases a removed Person who never signed in", async () => {
    const { world, acme, admin, personId } = await setup();
    const id = world.addPerson(acme.id, "ghost@example.com", false);
    expect((await admin.call("DELETE", `/api/organization/people/${id}`)).status).toBe(204);

    const settings = await admin.call("GET", "/api/organization");

    expect(settings.body).toMatchObject({
      removedPeople: [{ personId: id, email: "ghost@example.com", linked: false }],
    });

    expect((await erase(admin, id, "ghost@example.com")).status).toBe(204);
    expect(world.durable.person(acme.id, id)?.email).toBe(`erased-${id}@erased.invalid`);
    expect(world.index.persons.has(`${acme.id}/${id}`)).toBe(false);
    expect(personId("admin@example.com")).not.toBe(id);

    expect((await admin.call("GET", "/api/organization")).body).toMatchObject({ removedPeople: [] });
  });

  it("refuses the only Lead of a Team and the only Organization admin until the role is handed over", async () => {
    const { world, acme, admin, adminId, personId, teamId } = await setup();
    const grace = personId("grace@example.com");

    expect(await erase(admin, grace, "grace@example.com")).toMatchObject({
      status: 409,
      body: { _tag: "LastLead" },
    });

    expect(await erase(admin, adminId, "admin@example.com")).toMatchObject({
      status: 409,
      body: { _tag: "LastAdmin" },
    });

    expect(world.durable.person(acme.id, grace)?.erasedAt).toBeNull();
    expect(world.durable.person(acme.id, adminId)?.erasedAt).toBeNull();

    expect(
      (await admin.call("POST", `/api/teams/${teamId}/leads`, { email: "ada@example.com" })).status,
    ).toBe(204);

    expect((await erase(admin, grace, "grace@example.com")).status).toBe(204);
  });

  it("keeps an Action's owner as a former member without the tombstone address", async () => {
    const { admin, lead, teamId, personId } = await setup();
    const ada = personId("ada@example.com");

    const created = await lead.call("POST", `/api/teams/${teamId}/actions`, {
      roundId: "round-1",
      title: "Fewer meetings",
      ownerId: ada,
      dueDate: null,
      dimension: null,
    });

    expect(created.status).toBe(200);
    expect((await erase(admin, ada, "ada@example.com")).status).toBe(204);

    const listed = await lead.call("GET", `/api/teams/${teamId}/actions`);

    expect(JSON.stringify(listed.body)).not.toContain("erased.invalid");
    expect(listed.body).toMatchObject({ actions: [{ ownerId: ada, ownerEmail: null }] });
  });

  it("only lets an Organization admin use the organization route, including for their own Person", async () => {
    const { world, acme, lead, member, personId } = await setup();
    const ada = personId("ada@example.com");
    const grace = personId("grace@example.com");

    expect((await erase(lead, ada, "ada@example.com")).status).toBe(403);
    expect((await erase(member, grace, "grace@example.com")).status).toBe(403);
    expect((await erase(member, ada, "ada@example.com")).status).toBe(403);
    expect((await erase(lead, grace, "grace@example.com")).status).toBe(403);
    expect(world.durable.person(acme.id, ada)?.erasedAt).toBeNull();
    expect(world.durable.person(acme.id, grace)?.erasedAt).toBeNull();
  });

  it("answers 404 for a Person who does not exist", async () => {
    const { admin } = await setup();

    expect(await erase(admin, "missing" as PersonId, "x@example.com")).toMatchObject({
      status: 404,
      body: { _tag: "PersonNotFound" },
    });
  });

  it("starts a new Person, not the tombstone, when the same address is added again", async () => {
    const { world, acme, admin, teamId, personId } = await setup();
    const before = personId("ada@example.com");

    expect((await erase(admin, before, "ada@example.com")).status).toBe(204);

    expect(
      (await admin.call("POST", `/api/teams/${teamId}/members`, { email: "ada@example.com" })).status,
    ).toBe(204);

    const after = personId("ada@example.com");

    expect(after).not.toBe(before);
    expect(world.durable.person(acme.id, before)?.erasedAt).toEqual(expect.any(Number));
    expect(world.durable.person(acme.id, after)).toMatchObject({ erasedAt: null, removedAt: null });
  });
});

describe("correcting a Person's email (GDPR 309)", () => {
  it("changes the address of a Person who has not signed in, in the Durable Object and the index", async () => {
    const { world, acme, admin } = await setup();
    const pat = world.addPerson(acme.id, "pat@example.com");

    const response = await admin.call("POST", `/api/organization/people/${pat}/email`, {
      email: " Pat.New@Example.com ",
    });

    expect(response).toEqual({ status: 204, body: null });
    expect(world.durable.person(acme.id, pat)?.email).toBe("pat.new@example.com");
    expect(world.index.persons.get(`${acme.id}/${pat}`)?.email).toBe("pat.new@example.com");
  });

  it("refuses a Person who has signed in and an address an account already has", async () => {
    const { world, acme, admin, personId } = await setup();
    const pat = world.addPerson(acme.id, "pat@example.com");

    const signedIn = await admin.call(
      "POST",
      `/api/organization/people/${personId("ada@example.com")}/email`,
      {
        email: "ada.new@example.com",
      },
    );

    const taken = await admin.call("POST", `/api/organization/people/${pat}/email`, {
      email: "ada@example.com",
    });

    const another = await admin.call("POST", `/api/organization/people/${pat}/email`, {
      email: "grace@example.com",
    });

    expect(signedIn).toEqual({ status: 409, body: { _tag: "PersonHasAccount" } });
    expect(taken).toEqual({ status: 409, body: { _tag: "EmailTaken" } });
    expect(another).toEqual({ status: 409, body: { _tag: "EmailTaken" } });
    expect(world.durable.person(acme.id, pat)?.email).toBe("pat@example.com");
    expect(world.durable.person(acme.id, personId("ada@example.com"))?.email).toBe("ada@example.com");
  });

  it("refuses an address that cannot be matched at sign-in", async () => {
    const { world, acme, admin } = await setup();
    const pat = world.addPerson(acme.id, "pat@example.com");

    const response = await admin.call("POST", `/api/organization/people/${pat}/email`, {
      email: "pät@example.com",
    });

    expect(response).toEqual({ status: 422, body: { _tag: "EmailUnusable" } });
    expect(world.durable.person(acme.id, pat)?.email).toBe("pat@example.com");
  });

  it("is for an Organization admin on the same origin", async () => {
    const { world, acme, admin, lead, member } = await setup();
    const pat = world.addPerson(acme.id, "pat@example.com");
    const body = { email: "pat.new@example.com" };

    expect((await lead.call("POST", `/api/organization/people/${pat}/email`, body)).status).toBe(403);
    expect((await member.call("POST", `/api/organization/people/${pat}/email`, body)).status).toBe(403);
    expect(
      (await admin.send("POST", `/api/organization/people/${pat}/email`, body, "https://evil.example"))
        .status,
    ).toBe(403);
    expect(world.durable.person(acme.id, pat)?.email).toBe("pat@example.com");
  });
});

describe("every directory endpoint", () => {
  const team = { name: "X", timeZone: "UTC", leadEmail: "x@example.com" };
  const email = { email: "x@example.com" };

  const ENDPOINTS: readonly (readonly [string, string, unknown])[] = [
    ["GET", "/api/teams", undefined],
    ["POST", "/api/teams", team],
    ["GET", "/api/teams/t", undefined],
    ["PATCH", "/api/teams/t", { name: "X", timeZone: "UTC" }],
    ["POST", "/api/teams/t/members", email],
    ["DELETE", "/api/teams/t/members/p", undefined],
    ["POST", "/api/teams/t/leads", email],
    ["DELETE", "/api/teams/t/leads/p", undefined],
    ["GET", "/api/organization", undefined],
    ["GET", "/api/organization/failed-emails", undefined],
    ["POST", "/api/organization/failed-emails/s/resend", undefined],
    ["GET", "/api/organization/failed-emails/s", undefined],
    ["PATCH", "/api/organization", { minimumGroupSize: 4 }],
    ["PATCH", "/api/me/language", { locale: "en" }],
    ["PUT", "/api/organization/admins/p", undefined],
    ["DELETE", "/api/organization/admins/p", undefined],
    ["DELETE", "/api/organization/people/p", undefined],
    ["POST", "/api/organization/people/p/erasure", { confirmation: "x@example.com" }],
    ["POST", "/api/organization/people/p/email", email],
  ];

  it.each(ENDPOINTS)("%s %s answers 401 without a session", async (method, path, body) => {
    const world = new SignInWorld();
    expect((await new Browser(world.handler()).send(method, path, body)).status).toBe(401);
  });

  it("answers 403 to someone signed in but not in an Organization", async () => {
    const world = new SignInWorld();
    const browser = new Browser(world.handler());
    browser.signIn(world.sessions.login("nobody@example.com"));
    expect((await browser.call("GET", "/api/teams")).status).toBe(403);
  });

  it("refuses changes from another origin", async () => {
    const { world, admin, teamId } = await setup();

    const response = await admin.send(
      "POST",
      `/api/teams/${teamId}/members`,
      { email: "eve@example.com" },
      "https://pr-1.submit.surveybeat.app",
    );

    expect(response.status).toBe(403);
    expect(world.durable.organizations.values().next().value?.state.people).toHaveLength(3);
  });

  it("never reaches another Organization's Teams", async () => {
    const { world, teamId } = await setup();
    const globex = world.addOrganization("Globex");
    world.addPerson(globex.id, "boss@example.com", true);
    const outsider = new Browser(world.handler());
    outsider.signIn(world.sessions.login("boss@example.com"));
    await outsider.session();
    expect((await outsider.call("GET", `/api/teams/${teamId}`)).status).toBe(404);
    expect(await outsider.call("GET", "/api/teams")).toEqual({ status: 200, body: [] });
  });
});

describe("the failed emails of the Organization (issue 147)", () => {
  /** Marks the Organization's send to `recipient` as failed, the way the email queue would. */
  const failSendTo = (world: SignInWorld, recipient: string, state: SendState) => {
    for (const organization of world.durable.organizations.values()) {
      for (const [sendId, send] of organization.sends) {
        if (send.recipient === recipient) {
          organization.sends.set(sendId, { ...send, state });
        }
      }
    }
  };

  it("lists the failed sends to an admin, newest first, with kind, recipient, reason, code, and time", async () => {
    const { world, admin } = await setup();
    failSendTo(world, "grace@example.com", {
      _tag: "Failed",
      reason: "rejected",
      code: "E_SENDER_NOT_VERIFIED",
      failedAt: 30,
    });
    failSendTo(world, "ada@example.com", { _tag: "Failed", reason: "unknown", code: null, failedAt: 40 });
    expect(await admin.call("GET", "/api/organization/failed-emails")).toMatchObject({
      status: 200,
      body: {
        emails: [
          {
            sendId: expect.any(String),
            kind: "AddedToTeam",
            recipient: "ada@example.com",
            reason: "unknown",
            code: null,
            failedAt: 40,
          },
          {
            sendId: expect.any(String),
            kind: "AddedToTeam",
            recipient: "grace@example.com",
            reason: "rejected",
            code: "E_SENDER_NOT_VERIFIED",
            failedAt: 30,
          },
        ],
      },
    });
  });

  it("lists nothing but the failed sends, and nothing at all when none failed", async () => {
    const { admin } = await setup();
    expect(await admin.call("GET", "/api/organization/failed-emails")).toEqual({
      status: 200,
      body: { emails: [] },
    });
  });

  it("is refused to a Lead and to a member, who are not Organization admins", async () => {
    const { lead, member } = await setup();
    expect((await lead.call("GET", "/api/organization/failed-emails")).status).toBe(403);
    expect((await member.call("GET", "/api/organization/failed-emails")).status).toBe(403);
  });
});

describe("resending a failed email (issue 159)", () => {
  /** The Organization's send to `recipient`, as the setup made it. */
  const sendTo = (world: SignInWorld, recipient: string): SendId => {
    for (const organization of world.durable.organizations.values()) {
      for (const [sendId, send] of organization.sends) {
        if (send.recipient === recipient) {
          return sendId;
        }
      }
    }

    throw new Error(`no send to ${recipient}`);
  };

  /** Marks the send to `recipient` as `state`, the way the email queue would, and returns its id. */
  const failedTo = (world: SignInWorld, recipient: string, state: SendState): SendId => {
    const sendId = sendTo(world, recipient);

    for (const organization of world.durable.organizations.values()) {
      const send = organization.sends.get(sendId);

      if (send !== undefined) {
        organization.sends.set(sendId, { ...send, state });
      }
    }

    return sendId;
  };

  const rejected: SendState = {
    _tag: "Failed",
    reason: "rejected",
    code: "E_SENDER_NOT_VERIFIED",
    failedAt: 30,
  };

  const stateOf = (world: SignInWorld, sendId: SendId) =>
    [...world.durable.organizations.values()]
      .find((organization) => organization.sends.has(sendId))
      ?.sends.get(sendId)?.state;

  const resendPath = (sendId: SendId) => `/api/organization/failed-emails/${sendId}/resend`;
  const statusPath = (sendId: SendId) => `/api/organization/failed-emails/${sendId}`;

  it("sends a failed email again for an admin, under the same id, and a repeat changes nothing", async () => {
    const { world, admin } = await setup();
    const sendId = failedTo(world, "ada@example.com", rejected);

    const queued = { status: 200, body: { sendId, state: { _tag: "Queued", attempts: 0, lastCode: null } } };
    expect(await admin.call("POST", resendPath(sendId))).toEqual(queued);
    expect(stateOf(world, sendId)).toMatchObject({ _tag: "Pending" });
    // A double click: the second request answers the same and leaves the send pending, so it is sent once.
    expect(await admin.call("POST", resendPath(sendId))).toEqual(queued);
    expect(stateOf(world, sendId)).toMatchObject({ _tag: "Pending" });

    // The send is pending again, so the failed list no longer shows it, and the status reads as queued.
    expect(await admin.call("GET", "/api/organization/failed-emails")).toEqual({
      status: 200,
      body: { emails: [] },
    });
    expect(await admin.call("GET", statusPath(sendId))).toEqual(queued);
  });

  it("shows a failed send's state to an admin: its reason, code, and time, and nothing else", async () => {
    const { world, admin } = await setup();
    const sendId = failedTo(world, "ada@example.com", rejected);
    expect(await admin.call("GET", statusPath(sendId))).toEqual({
      status: 200,
      body: {
        sendId,
        state: { _tag: "Failed", reason: "rejected", code: "E_SENDER_NOT_VERIFIED", failedAt: 30 },
      },
    });
  });

  it("says in the failed list which failed emails may be resent", async () => {
    const { world, admin } = await setup();
    failedTo(world, "ada@example.com", rejected);
    failedTo(world, "grace@example.com", { _tag: "Failed", reason: "complained", code: null, failedAt: 40 });
    expect(await admin.call("GET", "/api/organization/failed-emails")).toMatchObject({
      status: 200,
      body: {
        emails: [
          { recipient: "grace@example.com", reason: "complained", resendable: false },
          { recipient: "ada@example.com", reason: "rejected", resendable: true },
        ],
      },
    });
  });

  it("is refused to a Lead and to a member, who are not Organization admins, and changes nothing", async () => {
    const { world, lead, member } = await setup();
    const sendId = failedTo(world, "ada@example.com", rejected);

    for (const browser of [lead, member]) {
      expect((await browser.call("POST", resendPath(sendId))).status).toBe(403);
      expect((await browser.call("GET", statusPath(sendId))).status).toBe(403);
    }

    expect(stateOf(world, sendId)).toMatchObject({ _tag: "Failed" });
  });

  it("answers 404 for a send the Organization does not have, and for another Organization's send", async () => {
    const { world, admin } = await setup();
    const sendId = failedTo(world, "ada@example.com", rejected);
    expect((await admin.call("POST", resendPath(SendId.make("no-such-send")))).status).toBe(404);
    expect((await admin.call("GET", statusPath(SendId.make("no-such-send")))).status).toBe(404);

    const globex = world.addOrganization("Globex");
    world.addPerson(globex.id, "boss@example.com", true);
    const outsider = new Browser(world.handler());
    outsider.signIn(world.sessions.login("boss@example.com"));
    await outsider.session();
    expect((await outsider.call("POST", resendPath(sendId))).status).toBe(404);
    expect((await outsider.call("GET", statusPath(sendId))).status).toBe(404);
    // Acme's send is still failed, and was not changed by the other Organization's admin.
    expect(await admin.call("GET", statusPath(sendId))).toMatchObject({
      status: 200,
      body: { state: { _tag: "Failed" } },
    });
  });

  it("refuses to send again an email that was complained about, and changes nothing", async () => {
    const { world, admin } = await setup();

    const sendId = failedTo(world, "ada@example.com", {
      _tag: "Failed",
      reason: "complained",
      code: null,
      failedAt: 40,
    });

    expect((await admin.call("POST", resendPath(sendId))).status).toBe(409);
    expect(await admin.call("GET", statusPath(sendId))).toMatchObject({
      status: 200,
      body: { state: { _tag: "Failed", reason: "complained" } },
    });
  });
});

describe("offboarding an Organization (GDPR 308)", () => {
  const exportPath = "/api/organization/offboarding-export";

  const offboard = (browser: Browser, confirmation: string) =>
    browser.call("POST", "/api/organization/offboarding", { confirmation });

  it("downloads the export for an admin as a file with no Results in it", async () => {
    const { admin } = await setup();

    const response = await admin.get(exportPath);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("surveybeat-organization.json");

    const exported = JSON.parse(await response.text());

    expect(exported).toMatchObject({
      organization: { name: "Acme" },
      teams: [{ name: "Platform" }],
      people: expect.arrayContaining([expect.objectContaining({ email: "ada@example.com" })]),
    });
    expect(Object.keys(exported).sort()).toEqual([
      "exportedAt",
      "memberships",
      "organization",
      "people",
      "pulses",
      "schemaVersion",
      "teams",
    ]);
  });

  it("refuses the export to a Lead and a member", async () => {
    const { lead, member } = await setup();

    const leadResponse = await lead.get(exportPath);
    const memberResponse = await member.get(exportPath);

    expect(leadResponse.status).toBe(403);
    expect(memberResponse.status).toBe(403);
    expect(leadResponse.headers.get("content-disposition")).toBeNull();
    expect(memberResponse.headers.get("content-disposition")).toBeNull();
  });

  it("refuses to delete for a Lead and a member, and changes nothing", async () => {
    const { world, acme, lead, member } = await setup();

    expect((await offboard(lead, "Acme")).status).toBe(403);
    expect((await offboard(member, "Acme")).status).toBe(403);
    expect(world.durable.organizations.has(acme.id)).toBe(true);
    expect(world.offboardings.size).toBe(0);
  });

  it("refuses a wrong Organization name with 422 and changes nothing", async () => {
    const { world, acme, admin } = await setup();

    for (const wrong of ["", "acme", "Acme ", "Globex"]) {
      expect(await offboard(admin, wrong)).toMatchObject({
        status: 422,
        body: { _tag: "ErasureNotConfirmed" },
      });
    }

    expect(world.durable.organizations.has(acme.id)).toBe(true);
    expect(world.index.organizations.has(acme.id)).toBe(true);
    expect(world.offboardings.size).toBe(0);
    expect((await admin.session()).body).toMatchObject({ _tag: "SignedIn" });
  });

  it("refuses a request from another origin", async () => {
    const { world, acme, admin } = await setup();

    const response = await admin.post(
      "/api/organization/offboarding",
      { confirmation: "Acme" },
      "https://evil.example",
    );

    expect(response.status).toBe(403);
    expect(world.durable.organizations.has(acme.id)).toBe(true);
  });

  it("deletes the Organization for its admin once the name is typed", async () => {
    const { world, acme, admin } = await setup();

    expect((await offboard(admin, "Acme")).status).toBe(204);

    expect(world.durable.organizations.has(acme.id)).toBe(false);
    expect(world.index.organizations.has(acme.id)).toBe(false);
    expect([...world.index.persons.values()].some((person) => person.organizationId === acme.id)).toBe(false);
  });

  it("finishes a wiped Organization without reading it again", async () => {
    const { world, acme, admin } = await setup();

    const userId = world.sessions.userIdOf("admin@example.com");
    world.offboardings.set(acme.id, userId);
    world.durable.organizations.delete(acme.id);

    expect((await offboard(admin, "")).status).toBe(204);
    expect(world.index.organizations.has(acme.id)).toBe(false);
    expect([...world.index.persons.values()].some((person) => person.organizationId === acme.id)).toBe(false);
  });

  it("finishes the pending Organization when the session is in another one with the same name", async () => {
    const { world, acme, admin } = await setup();

    const globex = world.addOrganization("Acme");
    const userId = world.sessions.userIdOf("admin@example.com");
    const personId = world.addPerson(globex.id, "admin@example.com", true);
    world.durable.update(globex.id, personId, { authUserId: userId });

    const indexed = world.index.persons.get(`${globex.id}/${personId}`);

    if (indexed === undefined) {
      throw new Error("globex person missing");
    }

    indexed.userId = userId;
    world.offboardings.set(acme.id, userId);

    const session = [...world.sessions.sessions.values()].find((each) => each.userId === userId);

    if (session === undefined) {
      throw new Error("no session");
    }

    world.sessions.chosen.set(session.sessionId, globex.id);

    expect((await admin.session()).body).toMatchObject({
      _tag: "SignedIn",
      organization: { id: globex.id },
    });
    expect((await offboard(admin, "Acme")).status).toBe(204);
    expect(world.durable.organizations.has(globex.id)).toBe(true);
    expect(world.index.organizations.has(globex.id)).toBe(true);
    expect(world.durable.organizations.has(acme.id)).toBe(false);
    expect(world.index.organizations.has(acme.id)).toBe(false);
    expect(world.offboardings.has(globex.id)).toBe(false);
  });
});
