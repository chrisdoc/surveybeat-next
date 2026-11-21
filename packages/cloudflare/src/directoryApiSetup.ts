import { expect } from "@effect/vitest";
import type { OrganizationId, PersonId } from "@surveybeat/domain";
import { Browser, SignInWorld } from "./testing.ts";

export const setup = () => {
  const world = new SignInWorld();
  const acme = world.addOrganization("Acme");
  const adminId = world.addPerson(acme.id, "admin@example.com", true);
  const personId = (email: string) => personIdOf(world, acme.id, email);
  const browsers = new Map<string, Browser>();

  const as = (email: string) => {
    const browser = new Browser(world.handler());
    browser.signIn(world.sessions.login(email));
    browsers.set(email, browser);

    return browser.session().then((session) => ({ browser, session }));
  };

  const browserFor = (email: string): Browser => {
    const browser = browsers.get(email);

    if (browser === undefined) {
      throw new Error(`no browser for ${email}`);
    }

    return browser;
  };

  let teamId = "";

  return as("admin@example.com")
    .then(({ browser }) => browser.session())
    .then((session) => {
      expect(session.body).toMatchObject({ _tag: "SignedIn", organizationAdmin: true });

      return browserFor("admin@example.com").call("POST", "/api/teams", {
        name: "Platform",
        timeZone: "Europe/Berlin",
        leadEmail: "Grace@Example.com",
      });
    })
    .then((created) => {
      expect(created.status).toBe(200);
      teamId = teamIdOf(created.body);

      return as("grace@example.com");
    })
    .then(() =>
      browserFor("grace@example.com").call("POST", `/api/teams/${teamId}/members`, {
        email: "ada@example.com",
      }),
    )
    .then((added) => {
      expect(added.status).toBe(204);

      return as("ada@example.com");
    })
    .then(() => ({
      world,
      acme,
      adminId,
      admin: browserFor("admin@example.com"),
      lead: browserFor("grace@example.com"),
      member: browserFor("ada@example.com"),
      teamId,
      as,
      personId,
    }));
};

export const teamIdOf = (body: unknown): string => {
  if (typeof body === "object" && body !== null && "team" in body) {
    const { team } = body;

    if (typeof team === "object" && team !== null && "id" in team && typeof team.id === "string") {
      return team.id;
    }
  }

  throw new Error("no Team in the response");
};

export const personIdOf = (world: SignInWorld, organizationId: OrganizationId, email: string): PersonId => {
  const person = world.durable.organizations
    .get(organizationId)
    ?.state.people.find((each) => each.email === email);

  if (person === undefined) {
    throw new Error(`no Person ${email}`);
  }

  return person.id;
};

export const roster = (browser: Browser, teamId: string) =>
  browser.call("GET", `/api/teams/${teamId}`).then(({ status, body }) => {
    expect(status).toBe(200);

    if (typeof body !== "object" || body === null || !("roster" in body) || !Array.isArray(body.roster)) {
      throw new Error("no roster");
    }

    return body.roster.map((entry: { role: string; email: string }) => `${entry.role} ${entry.email}`);
  });
