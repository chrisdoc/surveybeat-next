// @effect-diagnostics asyncFunction:off -- the vitest runner awaits a plain Promise here; the test never enters an Effect.

import { describe, expect, it } from "@effect/vitest";
import { SESSION_COOKIE } from "./AuthHandlers.ts";
import { Browser, ORIGIN, SignInWorld } from "../testing.ts";

/**
 * The sign-in API end to end over HTTP: real handlers, real domain flow, and in-memory stand-ins
 * for the session provider, the D1 index, and the Organization Durable Objects.
 */

const setup = (allowlist = "") => {
  const world = new SignInWorld(allowlist);
  return { world, browser: new Browser(world.handler()), newBrowser: () => new Browser(world.handler()) };
};

describe("the sign-in start", () => {
  it("sends the browser to the app's own email-code form", async () => {
    const { browser } = setup();
    const login = await browser.get("/auth/login");
    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toBe(`${ORIGIN}/`);
  });

  it("answers 401 without a session", async () => {
    const { browser } = setup();
    expect((await browser.session()).status).toBe(401);
  });
});

describe("first sign-in with no matching Person", () => {
  it("offers an allowlisted verified email to create an Organization, and makes the creator its admin", async () => {
    const { world, browser } = setup("Ops@Example.com, other@example.com");
    browser.signIn(world.sessions.login("ops@example.com"));
    expect(await browser.session()).toEqual({ status: 200, body: { _tag: "CreateOrganization" } });

    const created = await browser.post("/auth/organization", { name: "Acme" });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      _tag: "SignedIn",
      organization: { name: "Acme" },
      organizationAdmin: true,
    });

    const organizationId = [...world.durable.organizations.keys()][0];
    if (organizationId === undefined) throw new Error("no Organization");
    expect(world.durable.organizations.get(organizationId)?.state.organizationName).toBe("Acme");
    expect((await browser.session()).body).toMatchObject({
      _tag: "SignedIn",
      organization: { id: organizationId },
    });
  });

  it("tells anyone else they are not part of an Organization yet, and refuses to create one", async () => {
    const { world, browser } = setup("ops@example.com");
    browser.signIn(world.sessions.login("someone@example.com"));
    expect(await browser.session()).toEqual({ status: 200, body: { _tag: "NotInOrganization" } });
    expect((await browser.post("/auth/organization", { name: "Acme" })).status).toBe(403);
    expect(world.durable.organizations.size).toBe(0);
  });

  it("does not trust an unverified email on the allowlist", async () => {
    const { world, browser } = setup("ops@example.com");
    browser.signIn(world.sessions.login("ops@example.com", false));
    expect((await browser.session()).body).toEqual({ _tag: "NotInOrganization" });
    expect((await browser.post("/auth/organization", { name: "Acme" })).status).toBe(403);
  });

  it("rejects a blank or untrimmed name", async () => {
    const { world, browser } = setup("ops@example.com");
    browser.signIn(world.sessions.login("ops@example.com"));
    expect((await browser.post("/auth/organization", { name: "" })).status).toBe(400);
    expect((await browser.post("/auth/organization", { name: " Acme" })).status).toBe(400);
  });
});

describe("creating an Organization is idempotent per user", () => {
  it("creates exactly one Organization from a double submit with the same session", async () => {
    const { world, browser } = setup("ops@example.com");
    const token = world.sessions.login("ops@example.com");
    browser.signIn(token);
    const second = new Browser(world.handler());
    second.signIn(token);
    const [a, b] = await Promise.all([
      browser.post("/auth/organization", { name: "Acme" }),
      second.post("/auth/organization", { name: "Acme twice" }),
    ]);
    const bodies: unknown[] = [await a.json(), await b.json()];
    expect(world.durable.organizations.size).toBe(1);
    expect(world.index.claims.size).toBe(1);
    const [organizationId] = [...world.durable.organizations.keys()];
    for (const body of bodies) {
      expect(body).toMatchObject({ _tag: "SignedIn", organization: { id: organizationId, name: "Acme" } });
    }
  });

  it("finishes an interrupted creation on the next session check", async () => {
    const { world, browser } = setup("ops@example.com");
    browser.signIn(world.sessions.login("ops@example.com"));
    const [claim] = [...world.index.claims.values()];
    expect(claim).toBeUndefined();
    await browser.post("/auth/organization", { name: "Acme" });
    expect(world.index.claims.size).toBe(1);
    expect((await browser.session()).body).toMatchObject({
      _tag: "SignedIn",
      organization: { name: "Acme" },
    });
  });

  it("enters the finished Organization on a later sign-in, without creating it again", async () => {
    const { world, browser, newBrowser } = setup("ops@example.com");
    browser.signIn(world.sessions.login("ops@example.com"));
    await browser.post("/auth/organization", { name: "Acme" });

    const later = newBrowser();
    later.signIn(world.sessions.login("ops@example.com"));
    expect((await later.session()).body).toMatchObject({ _tag: "SignedIn", organizationAdmin: true });
    expect(world.durable.organizations.size).toBe(1);
  });
});

describe("a creator removed from their Organization", () => {
  const removeCreator = (world: SignInWorld) => {
    const [claim] = [...world.index.claims.values()];
    if (claim === undefined) throw new Error("no claim");
    world.durable.remove(claim.organization.id, claim.adminPersonId);
  };

  it("is not made admin again by the session check or another create", async () => {
    const { world, browser } = setup("ops@example.com");
    browser.signIn(world.sessions.login("ops@example.com"));
    expect((await browser.post("/auth/organization", { name: "Acme" })).status).toBe(200);
    removeCreator(world);

    expect(await browser.session()).toEqual({ status: 200, body: { _tag: "NotInOrganization" } });
    expect((await browser.post("/auth/organization", { name: "Acme again" })).status).toBe(403);
    expect(world.durable.organizations.size).toBe(1);
  });
});

describe("languages in the session (ADR 0018)", () => {
  it("carries the Person's language, the browser language, and the Organization's default", async () => {
    const { world, browser } = setup();
    const acme = world.addOrganization("Acme");
    const personId = world.addPerson(acme.id, "ada@example.com");
    const organization = world.durable.organizations.get(acme.id);
    if (organization === undefined) throw new Error("no Organization");
    organization.state = { ...organization.state, defaultLocale: "en" };
    world.durable.update(acme.id, personId, { locale: "en", detectedLocale: "en" });

    browser.signIn(world.sessions.login("ada@example.com"));

    expect((await browser.session()).body).toMatchObject({
      _tag: "SignedIn",
      personId,
      locale: "en",
      detectedLocale: "en",
      organizationLocale: "en",
    });
  });
});

describe("linking a signed-in user to a Person", () => {
  it("links by an exact match on a verified email, whatever its case", async () => {
    const { world, browser } = setup();
    const acme = world.addOrganization("Acme");
    const personId = world.addPerson(acme.id, "ada@example.com");
    browser.signIn(world.sessions.login("Ada@Example.COM"));

    expect((await browser.session()).body).toEqual({
      _tag: "SignedIn",
      organization: { id: acme.id, name: "Acme" },
      personId,
      organizationAdmin: false,
      locale: null,
      detectedLocale: null,
      organizationLocale: "en",
    });
    expect(world.durable.person(acme.id, personId)?.authUserId).toBe("user_1");
    expect(world.index.persons.get(`${acme.id}/${personId}`)?.userId).toBe("user_1");
  });

  it("never links an unverified email", async () => {
    const { world, browser } = setup("ada@example.com");
    const acme = world.addOrganization("Acme");
    const personId = world.addPerson(acme.id, "ada@example.com");
    browser.signIn(world.sessions.login("ada@example.com", false));

    expect((await browser.session()).body).toEqual({ _tag: "NotInOrganization" });
    expect((await browser.post("/auth/organization/choose", { organizationId: acme.id })).status).toBe(403);
    expect(world.durable.person(acme.id, personId)?.authUserId).toBeNull();
    expect(world.index.persons.get(`${acme.id}/${personId}`)?.userId).toBeNull();
  });

  it("does not link a similar but different email", async () => {
    const { world, browser } = setup();
    const acme = world.addOrganization("Acme");
    world.addPerson(acme.id, "ada@example.com");
    browser.signIn(world.sessions.login("ada+work@example.com"));
    expect((await browser.session()).body).toEqual({ _tag: "NotInOrganization" });
  });

  it("never links a non-ASCII email that only normalises to the Person's", async () => {
    const { world, browser } = setup("kate@example.com");
    const acme = world.addOrganization("Acme");
    const personId = world.addPerson(acme.id, "kate@example.com");
    browser.signIn(world.sessions.login("\u212Aate@example.com"));

    expect((await browser.session()).body).toEqual({ _tag: "NotInOrganization" });
    expect(world.durable.person(acme.id, personId)?.authUserId).toBeNull();
  });

  it("offers an Organization picker when the email matches Persons in several Organizations", async () => {
    const { world, browser } = setup();
    const acme = world.addOrganization("Acme");
    const globex = world.addOrganization("Globex");
    world.addPerson(globex.id, "ada@example.com");
    const acmePerson = world.addPerson(acme.id, "ada@example.com");
    browser.signIn(world.sessions.login("ada@example.com"));

    expect((await browser.session()).body).toEqual({
      _tag: "ChooseOrganization",
      organizations: [
        { id: acme.id, name: "Acme" },
        { id: globex.id, name: "Globex" },
      ],
    });
    const chosen = await browser.post("/auth/organization/choose", { organizationId: acme.id });
    expect(await chosen.json()).toEqual({
      _tag: "SignedIn",
      organization: { id: acme.id, name: "Acme" },
      personId: acmePerson,
      organizationAdmin: false,
      locale: null,
      detectedLocale: null,
      organizationLocale: "en",
    });
    expect((await browser.session()).body).toMatchObject({ _tag: "SignedIn", organization: { id: acme.id } });
  });

  it("keeps one session while the chosen Organization changes", async () => {
    const { world, browser } = setup();
    const acme = world.addOrganization("Acme");
    const globex = world.addOrganization("Globex");
    world.addPerson(acme.id, "ada@example.com");
    world.addPerson(globex.id, "ada@example.com");
    const token = world.sessions.login("ada@example.com");
    browser.signIn(token);

    await browser.post("/auth/organization/choose", { organizationId: acme.id });
    expect(browser.cookies.get(SESSION_COOKIE)).toBe(token);
    await browser.post("/auth/organization/choose", { organizationId: globex.id });
    expect(browser.cookies.get(SESSION_COOKIE)).toBe(token);
    expect((await browser.session()).body).toMatchObject({
      _tag: "SignedIn",
      organization: { id: globex.id },
    });
  });

  it("refuses to enter an Organization that was not offered", async () => {
    const { world, browser } = setup();
    const acme = world.addOrganization("Acme");
    const globex = world.addOrganization("Globex");
    world.addPerson(acme.id, "ada@example.com");
    world.addPerson(globex.id, "ada@example.com");
    const other = world.addOrganization("Initech");
    browser.signIn(world.sessions.login("ada@example.com"));
    expect((await browser.post("/auth/organization/choose", { organizationId: other.id })).status).toBe(403);
  });

  it("refuses state-changing requests from another origin", async () => {
    const { world, browser } = setup("ops@example.com");
    browser.signIn(world.sessions.login("ops@example.com"));
    const response = await browser.post(
      "/auth/organization",
      { name: "Acme" },
      "https://pr-1.submit.surveybeat.app",
    );
    expect(response.status).toBe(403);
    expect(world.durable.organizations.size).toBe(0);
  });
});

describe("the per-request session check", () => {
  const signedIn = () => {
    const context = setup();
    const acme = context.world.addOrganization("Acme");
    const personId = context.world.addPerson(acme.id, "ada@example.com");
    const token = context.world.sessions.login("ada@example.com");
    context.browser.signIn(token);
    return { ...context, acme, personId, token };
  };

  it("revokes the session on sign-out, so a copied cookie stops working", async () => {
    const { world, browser, newBrowser, token } = signedIn();
    const logout = await browser.fetch("/auth/logout", { method: "POST", headers: { origin: ORIGIN } });
    expect(logout.status).toBe(303);
    expect(logout.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);
    expect(world.sessions.revocations).toEqual([world.sessions.sessions.get(token)?.sessionId]);

    const replay = newBrowser();
    replay.signIn(token);
    expect((await replay.session()).status).toBe(401);
  });

  it("drops a removed Person from the Organization on the next request, but keeps the session", async () => {
    const { world, browser, acme, personId } = signedIn();
    world.durable.remove(acme.id, personId);
    expect(await browser.session()).toEqual({ status: 200, body: { _tag: "NotInOrganization" } });
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(true);
  });

  it("offers the Organizations a removed Person still belongs to", async () => {
    const { world, browser } = setup();
    const acme = world.addOrganization("Acme");
    const globex = world.addOrganization("Globex");
    const acmePerson = world.addPerson(acme.id, "ada@example.com");
    const globexPerson = world.addPerson(globex.id, "ada@example.com");
    browser.signIn(world.sessions.login("ada@example.com"));
    await browser.post("/auth/organization/choose", { organizationId: acme.id });
    world.durable.remove(acme.id, acmePerson);

    expect((await browser.session()).body).toMatchObject({ _tag: "ChooseOrganization" });
    const chosen = await browser.post("/auth/organization/choose", { organizationId: globex.id });
    expect(await chosen.json()).toMatchObject({ _tag: "SignedIn", personId: globexPerson });
  });

  it("signs out with 403 and keeps the cookie when the request comes from another origin", async () => {
    const { world, browser } = signedIn();
    const logout = await browser.fetch("/auth/logout", {
      method: "POST",
      headers: { origin: "https://pr-1.submit.surveybeat.app" },
    });
    expect(logout.status).toBe(403);
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(true);
    expect(world.sessions.revocations).toEqual([]);
  });

  it("answers 503 when the session cannot be revoked, after dropping the cookie", async () => {
    const { world, browser, newBrowser, token } = signedIn();
    world.sessions.failRevoke = true;
    const logout = await browser.fetch("/auth/logout", { method: "POST", headers: { origin: ORIGIN } });
    expect(logout.status).toBe(503);
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);

    const replay = newBrowser();
    replay.signIn(token);
    expect((await replay.session()).status).toBe(200);
  });

  it("signs out a cookie no session answers", async () => {
    const { browser } = setup();
    const logout = await browser.fetch("/auth/logout", { method: "POST", headers: { origin: ORIGIN } });
    expect(logout.status).toBe(303);
    expect(logout.headers.get("location")).toBe(`${ORIGIN}/`);
  });
});
