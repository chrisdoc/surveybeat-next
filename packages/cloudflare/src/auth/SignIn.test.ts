import { describe, expect, it } from "@effect/vitest";
import { SESSION_COOKIE, STATE_COOKIE } from "./AuthHandlers.ts";
import { Browser, ORIGIN, SignInWorld } from "./testing.ts";

/**
 * The sign-in API end to end over HTTP: real handlers, real domain flow, and in-memory stand-ins
 * for WorkOS, the D1 index, and the Organization Durable Objects.
 */

const setup = (allowlist = "") => {
  const world = new SignInWorld(allowlist);
  return { world, browser: new Browser(world.handler()), newBrowser: () => new Browser(world.handler()) };
};

describe("AuthKit redirect flow", () => {
  it("sends the browser to AuthKit with a state cookie and our callback URL", async () => {
    const { browser } = setup();
    const login = await browser.get("/auth/login");
    expect(login.status).toBe(302);
    const location = new URL(login.headers.get("location") ?? "");
    expect(location.origin).toBe("https://auth.example.test");
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/callback`);
    expect(location.searchParams.get("state")).toBe(browser.cookies.get(STATE_COOKIE));
    expect(login.headers.getSetCookie()[0]).toMatch(/HttpOnly/i);
  });

  it("sets an HttpOnly, Secure, SameSite=Lax session cookie on a valid callback", async () => {
    const { world, browser } = setup();
    const code = world.workos.addUser("ada@example.com");
    const login = await browser.get("/auth/login");
    const state = new URL(login.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const callback = await browser.get(`/auth/callback?${new URLSearchParams({ code, state }).toString()}`);
    expect(callback.status).toBe(302);
    const cookie = callback.headers.getSetCookie().find((header) => header.startsWith(`${SESSION_COOKIE}=`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(browser.cookies.has(STATE_COOKIE)).toBe(false);
  });

  it("refuses a callback whose state does not match, without exchanging the code", async () => {
    const { world, browser } = setup();
    const code = world.workos.addUser("ada@example.com");
    await browser.get("/auth/login");
    const callback = await browser.get(
      `/auth/callback?${new URLSearchParams({ code, state: "forged" }).toString()}`,
    );
    expect(callback.headers.get("location")).toBe(`${ORIGIN}/?signin=failed`);
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);
    expect(world.workos.codes.has(code)).toBe(true);
  });

  it("refuses a callback with no state cookie, without exchanging the code", async () => {
    const { world, browser } = setup();
    const code = world.workos.addUser("ada@example.com");
    const callback = await browser.get(
      `/auth/callback?${new URLSearchParams({ code, state: "s" }).toString()}`,
    );
    expect(callback.headers.get("location")).toBe(`${ORIGIN}/?signin=failed`);
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);
    expect(world.workos.codes.has(code)).toBe(true);
  });

  it("refuses a callback with no code", async () => {
    const { browser } = setup();
    const login = await browser.get("/auth/login");
    const state = new URL(login.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const callback = await browser.get(`/auth/callback?${new URLSearchParams({ state }).toString()}`);
    expect(callback.headers.get("location")).toBe(`${ORIGIN}/?signin=failed`);
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);
  });

  it("answers 401 without a session", async () => {
    const { browser } = setup();
    expect((await browser.session()).status).toBe(401);
  });
});

describe("first sign-in with no matching Person", () => {
  it("offers an allowlisted verified email to create an Organization, and makes the creator its admin", async () => {
    const { world, browser } = setup("Ops@Example.com, other@example.com");
    await browser.signIn(world.workos.addUser("ops@example.com"));
    expect(await browser.session()).toEqual({ status: 200, body: { _tag: "CreateOrganization" } });

    const created = await browser.post("/auth/organization", { name: "Acme" });
    expect(created.status).toBe(200);
    const body: unknown = await created.json();
    expect(body).toMatchObject({ _tag: "SignedIn", organization: { name: "Acme" }, organizationAdmin: true });

    const [created_] = [...world.workos.organizations];
    if (created_ === undefined) throw new Error("no WorkOS organization");
    const [organizationId, workosOrganization] = created_;
    expect(world.workos.memberships.get(`user_1/${workosOrganization.id}`)).toBe("admin");
    expect(world.durable.organizations.get(organizationId)?.state.organizationName).toBe("Acme");
    // The new cookie is scoped to the Organization, so the next request is signed in.
    expect((await browser.session()).body).toMatchObject({
      _tag: "SignedIn",
      organization: { id: organizationId },
    });
  });

  it("tells anyone else they are not part of an Organization yet, and refuses to create one", async () => {
    const { world, browser } = setup("ops@example.com");
    await browser.signIn(world.workos.addUser("someone@example.com"));
    expect(await browser.session()).toEqual({ status: 200, body: { _tag: "NotInOrganization" } });
    expect((await browser.post("/auth/organization", { name: "Acme" })).status).toBe(403);
    expect(world.workos.createOrganizationCalls).toBe(0);
  });

  it("does not trust an unverified email on the allowlist", async () => {
    const { world, browser } = setup("ops@example.com");
    await browser.signIn(world.workos.addUser("ops@example.com", false));
    expect((await browser.session()).body).toEqual({ _tag: "NotInOrganization" });
    expect((await browser.post("/auth/organization", { name: "Acme" })).status).toBe(403);
  });

  it("rejects a blank or untrimmed name", async () => {
    const { world, browser } = setup("ops@example.com");
    await browser.signIn(world.workos.addUser("ops@example.com"));
    expect((await browser.post("/auth/organization", { name: "" })).status).toBe(400);
    expect((await browser.post("/auth/organization", { name: " Acme" })).status).toBe(400);
  });
});

describe("creating an Organization is idempotent per WorkOS user", () => {
  it("creates exactly one Organization from a double submit with the same cookie", async () => {
    const { world, browser } = setup("ops@example.com");
    await browser.signIn(world.workos.addUser("ops@example.com"));
    const cookie = browser.cookies.get(SESSION_COOKIE) ?? "";
    // Both requests leave with the pre-creation cookie, as two quick clicks would.
    const second = new Browser(world.handler());
    second.cookies.set(SESSION_COOKIE, cookie);
    const [a, b] = await Promise.all([
      browser.post("/auth/organization", { name: "Acme" }),
      second.post("/auth/organization", { name: "Acme twice" }),
    ]);
    const bodies: Array<unknown> = [await a.json(), await b.json()];
    expect(world.workos.organizations.size).toBe(1);
    expect(world.durable.organizations.size).toBe(1);
    expect(world.index.claims.size).toBe(1);
    const [organizationId] = [...world.durable.organizations.keys()];
    for (const body of bodies) {
      expect(body).toMatchObject({ _tag: "SignedIn", organization: { id: organizationId, name: "Acme" } });
    }
  });

  it("finishes the same Organization when a retry follows a failure halfway", async () => {
    const { world, browser } = setup("ops@example.com");
    await browser.signIn(world.workos.addUser("ops@example.com"));
    world.workos.failCreateOrganization = 1;
    expect((await browser.post("/auth/organization", { name: "Acme" })).status).toBe(503);
    expect(world.durable.organizations.size).toBe(1);

    // The retry may even carry another name: the first claim wins.
    const retry = await browser.post("/auth/organization", { name: "Other" });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ _tag: "SignedIn", organization: { name: "Acme" } });
    expect(world.workos.organizations.size).toBe(1);
    expect(world.durable.organizations.size).toBe(1);
  });

  it("enters a finished Organization on a later sign-in, without creating it again", async () => {
    const { world, browser, newBrowser } = setup("ops@example.com");
    const code = world.workos.addUser("ops@example.com");
    const userId = world.workos.codes.get(code);
    await browser.signIn(code);
    await browser.post("/auth/organization", { name: "Acme" });
    expect(world.workos.createOrganizationCalls).toBe(1);

    const later = newBrowser();
    await later.signIn(world.workos.newCode(userId));
    expect((await later.session()).body).toMatchObject({ _tag: "SignedIn", organizationAdmin: true });
    expect(world.workos.createOrganizationCalls).toBe(1);
  });

  it("finishes an interrupted creation on the next session check", async () => {
    const { world, browser } = setup("ops@example.com");
    await browser.signIn(world.workos.addUser("ops@example.com"));
    world.workos.failCreateOrganization = 1;
    await browser.post("/auth/organization", { name: "Acme" });
    expect((await browser.session()).body).toMatchObject({
      _tag: "SignedIn",
      organization: { name: "Acme" },
    });
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
    await browser.signIn(world.workos.addUser("ops@example.com"));
    expect((await browser.post("/auth/organization", { name: "Acme" })).status).toBe(200);
    removeCreator(world);
    const calls = world.workos.ensureMembershipCalls;

    // Still signed in, but no longer in the Organization the session points at.
    expect(await browser.session()).toEqual({ status: 200, body: { _tag: "NotInOrganization" } });
    expect((await browser.post("/auth/organization", { name: "Acme again" })).status).toBe(403);
    expect(await browser.session()).toEqual({ status: 200, body: { _tag: "NotInOrganization" } });
    expect(world.workos.ensureMembershipCalls).toBe(calls);
    expect(world.workos.organizations.size).toBe(1);
  });

  it("closes a creation interrupted before the removal, without making them admin", async () => {
    const { world, browser } = setup("ops@example.com");
    await browser.signIn(world.workos.addUser("ops@example.com"));
    world.workos.failCreateOrganization = 1;
    expect((await browser.post("/auth/organization", { name: "Acme" })).status).toBe(503);
    removeCreator(world);

    expect((await browser.post("/auth/organization", { name: "Acme" })).status).toBe(403);
    expect(await browser.session()).toEqual({ status: 200, body: { _tag: "NotInOrganization" } });
    expect(world.workos.ensureMembershipCalls).toBe(0);
    expect([...world.index.claims.values()][0]?.completed).toBe(true);
  });
});

describe("languages in the session (ADR 0018)", () => {
  it("carries the Person's language, the browser language, and the Organization's default", async () => {
    const { world, browser } = setup();
    const acme = world.addOrganization("Acme");
    const personId = world.addPerson(acme.id, "ada@example.com");
    const organization = world.durable.organizations.get(acme.id);
    if (organization === undefined) throw new Error("no Organization");
    organization.state = { ...organization.state, defaultLocale: "de" };
    world.durable.update(acme.id, personId, { locale: "en", detectedLocale: "de" });

    await browser.signIn(world.workos.addUser("ada@example.com"));

    expect((await browser.session()).body).toMatchObject({
      _tag: "SignedIn",
      personId,
      locale: "en",
      detectedLocale: "de",
      organizationLocale: "de",
    });
  });
});

describe("linking a WorkOS user to a Person", () => {
  it("links by an exact match on a verified email, whatever its case", async () => {
    const { world, browser } = setup();
    const acme = world.addOrganization("Acme");
    const personId = world.addPerson(acme.id, "ada@example.com");
    await browser.signIn(world.workos.addUser("Ada@Example.COM"));

    expect((await browser.session()).body).toEqual({
      _tag: "SignedIn",
      organization: { id: acme.id, name: "Acme" },
      personId,
      organizationAdmin: false,
      locale: null,
      detectedLocale: null,
      organizationLocale: "en",
    });
    expect(world.durable.person(acme.id, personId)?.workosUserId).toBe("user_1");
    expect(world.index.persons.get(`${acme.id}/${personId}`)?.userId).toBe("user_1");
    expect(world.workos.memberships.get(`user_1/${acme.workos}`)).toBe("member");
  });

  it("never links an unverified email", async () => {
    const { world, browser } = setup("ada@example.com");
    const acme = world.addOrganization("Acme");
    const personId = world.addPerson(acme.id, "ada@example.com");
    await browser.signIn(world.workos.addUser("ada@example.com", false));

    expect((await browser.session()).body).toEqual({ _tag: "NotInOrganization" });
    expect((await browser.post("/auth/organization/choose", { organizationId: acme.id })).status).toBe(403);
    expect(world.durable.person(acme.id, personId)?.workosUserId).toBeNull();
    expect(world.index.persons.get(`${acme.id}/${personId}`)?.userId).toBeNull();
    expect(world.workos.memberships.size).toBe(0);
  });

  it("does not link a similar but different email", async () => {
    const { world, browser } = setup();
    const acme = world.addOrganization("Acme");
    world.addPerson(acme.id, "ada@example.com");
    await browser.signIn(world.workos.addUser("ada+work@example.com"));
    expect((await browser.session()).body).toEqual({ _tag: "NotInOrganization" });
  });

  it("never links a non-ASCII email that only normalises to the Person's", async () => {
    const { world, browser } = setup("kate@example.com");
    const acme = world.addOrganization("Acme");
    const personId = world.addPerson(acme.id, "kate@example.com");
    // U+212A KELVIN SIGN lower-cases to an ASCII `k`.
    await browser.signIn(world.workos.addUser("\u212aate@example.com"));

    expect((await browser.session()).body).toEqual({ _tag: "NotInOrganization" });
    expect(world.durable.person(acme.id, personId)?.workosUserId).toBeNull();
    expect(world.workos.memberships.size).toBe(0);
  });

  it("offers an Organization picker when the email matches Persons in several Organizations", async () => {
    const { world, browser } = setup();
    const acme = world.addOrganization("Acme");
    const globex = world.addOrganization("Globex");
    world.addPerson(globex.id, "ada@example.com");
    const acmePerson = world.addPerson(acme.id, "ada@example.com");
    await browser.signIn(world.workos.addUser("ada@example.com"));

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

  it("refuses to enter an Organization that was not offered", async () => {
    const { world, browser } = setup();
    const acme = world.addOrganization("Acme");
    const globex = world.addOrganization("Globex");
    world.addPerson(acme.id, "ada@example.com");
    world.addPerson(globex.id, "ada@example.com");
    const other = world.addOrganization("Initech");
    await browser.signIn(world.workos.addUser("ada@example.com"));
    expect((await browser.post("/auth/organization/choose", { organizationId: other.id })).status).toBe(403);
  });
});

describe("the per-request session check", () => {
  const signedIn = async () => {
    const context = setup();
    const acme = context.world.addOrganization("Acme");
    const personId = context.world.addPerson(acme.id, "ada@example.com");
    await context.browser.signIn(context.world.workos.addUser("ada@example.com"));
    expect((await context.browser.session()).status).toBe(200);
    return { ...context, acme, personId };
  };

  it("denies a signed-out session on the next request, although its access token is still valid", async () => {
    const { world, browser, newBrowser } = await signedIn();
    const stolen = browser.cookies.get(SESSION_COOKIE) ?? "";

    const logout = await browser.fetch("/auth/logout", { method: "POST", headers: { origin: ORIGIN } });
    expect(logout.status).toBe(303);
    expect(logout.headers.get("location")).toMatch(
      /^https:\/\/auth\.example\.test\/logout\?session_id=session_/,
    );
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);

    // The fake still accepts the token, as WorkOS's JWT would until it expires: our deny list decides.
    expect(world.workos.sessions.has(stolen)).toBe(true);
    const replay = newBrowser();
    replay.cookies.set(SESSION_COOKIE, stolen);
    expect((await replay.session()).status).toBe(401);
  });

  it("drops a removed Person from the Organization on the next request, but keeps the session", async () => {
    const { world, browser, acme, personId } = await signedIn();
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
    await browser.signIn(world.workos.addUser("ada@example.com"));
    await browser.post("/auth/organization/choose", { organizationId: acme.id });
    world.durable.remove(acme.id, acmePerson);

    expect((await browser.session()).body).toMatchObject({ _tag: "ChooseOrganization" });
    const chosen = await browser.post("/auth/organization/choose", { organizationId: globex.id });
    expect(await chosen.json()).toMatchObject({ _tag: "SignedIn", personId: globexPerson });
  });

  it("denies a revoked session even after its expired access token is refreshed", async () => {
    const { world, browser, newBrowser } = await signedIn();
    const stolen = browser.cookies.get(SESSION_COOKIE) ?? "";
    world.workos.failRevokeSession = true; // only our deny list stands between the copy and access
    await browser.fetch("/auth/logout", { method: "POST", headers: { origin: ORIGIN } });
    world.workos.expire(stolen);

    const replay = newBrowser();
    replay.cookies.set(SESSION_COOKIE, stolen);
    expect((await replay.session()).status).toBe(401);
    expect(replay.cookies.has(SESSION_COOKIE)).toBe(false);
  });

  it("refreshes an expired access token and writes the rotated cookie", async () => {
    const { world, browser } = await signedIn();
    const before = browser.cookies.get(SESSION_COOKIE) ?? "";
    world.workos.expire(before);
    expect((await browser.session()).body).toMatchObject({ _tag: "SignedIn" });
    const after = browser.cookies.get(SESSION_COOKIE);
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    expect((await browser.session()).status).toBe(200);
  });

  it("signs out a session whose refresh token is gone", async () => {
    const { world, browser } = await signedIn();
    const sealed = browser.cookies.get(SESSION_COOKIE) ?? "";
    world.workos.expire(sealed);
    world.workos.sessions.delete(sealed);
    expect((await browser.session()).status).toBe(401);
  });

  it("prefers, when WorkOS asks for an organization at sign-in, one the user is still a Person in", async () => {
    const { world, browser, newBrowser } = setup();
    const acme = world.addOrganization("Acme");
    const globex = world.addOrganization("Globex");
    const acmePerson = world.addPerson(acme.id, "ada@example.com");
    const globexPerson = world.addPerson(globex.id, "ada@example.com");
    const code = world.workos.addUser("ada@example.com");
    const userId = world.workos.codes.get(code);
    await browser.signIn(code);
    for (const organization of [acme, globex]) {
      await browser.post("/auth/organization/choose", { organizationId: organization.id });
    }
    expect(world.workos.memberships.has(`${userId}/${acme.workos}`)).toBe(true);
    world.durable.remove(acme.id, acmePerson);

    world.workos.requireOrganizationSelection = true;
    const next = newBrowser();
    await next.signIn(world.workos.newCode(userId));
    expect((await next.session()).body).toMatchObject({
      _tag: "SignedIn",
      organization: { id: globex.id },
      personId: globexPerson,
    });
  });

  it("signs out with 403 and keeps the cookie when the request comes from another origin", async () => {
    const { world, browser } = await signedIn();
    const logout = await browser.fetch("/auth/logout", {
      method: "POST",
      headers: { origin: "https://pr-1.submit.surveybeat.app" },
    });
    expect(logout.status).toBe(403);
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(true);
    expect(world.index.revoked.size).toBe(0);
    expect(world.workos.revokedSessions.size).toBe(0);
  });

  it("revokes the session at WorkOS too on sign-out", async () => {
    const { world, browser } = await signedIn();
    await browser.fetch("/auth/logout", { method: "POST", headers: { origin: ORIGIN } });
    expect([...world.index.revoked]).toEqual([...world.workos.revokedSessions]);
    expect(world.workos.revokedSessions.size).toBe(1);
  });

  it("signs out a session whose access token expired", async () => {
    const { world, browser } = await signedIn();
    world.workos.expire(browser.cookies.get(SESSION_COOKIE) ?? "");
    const logout = await browser.fetch("/auth/logout", { method: "POST", headers: { origin: ORIGIN } });
    expect(logout.status).toBe(303);
    expect(logout.headers.get("location")).toMatch(
      /^https:\/\/auth\.example\.test\/logout\?session_id=session_/,
    );
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);
    expect(world.index.revoked.size).toBe(1);
    expect(world.workos.revokedSessions.size).toBe(1);
  });

  it("answers 503 when WorkOS cannot revoke, after denying the session and dropping the cookie", async () => {
    const { world, browser, newBrowser } = await signedIn();
    const stolen = browser.cookies.get(SESSION_COOKIE) ?? "";
    world.workos.failRevokeSession = true;
    const logout = await browser.fetch("/auth/logout", { method: "POST", headers: { origin: ORIGIN } });
    expect(logout.status).toBe(503);
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);
    const replay = newBrowser();
    replay.cookies.set(SESSION_COOKIE, stolen);
    expect((await replay.session()).status).toBe(401);
  });

  it("refuses state-changing requests from another origin", async () => {
    const { world, browser } = setup("ops@example.com");
    await browser.signIn(world.workos.addUser("ops@example.com"));
    const response = await browser.post(
      "/auth/organization",
      { name: "Acme" },
      "https://pr-1.submit.surveybeat.app",
    );
    expect(response.status).toBe(403);
    expect(world.workos.createOrganizationCalls).toBe(0);
  });
});
