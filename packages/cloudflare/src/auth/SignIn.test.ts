import { describe, expect, it } from "@effect/vitest";
import { SESSION_COOKIE, STATE_COOKIE } from "./AuthHandlers.ts";
import { SignInWorld } from "./testing.ts";

/**
 * The sign-in API end to end over HTTP: real handlers, real domain flow, and in-memory stand-ins
 * for WorkOS, the D1 index, and the Organization Durable Objects.
 */

const ORIGIN = "https://pr-1.app.surveybeat.app";

/** A browser of one: keeps cookies between requests, never follows redirects. */
class Browser {
  readonly cookies = new Map<string, string>();
  constructor(private readonly handle: (request: Request) => Promise<Response>) {}

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) {
      headers.set("cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    }
    const response = await this.handle(
      new Request(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" }),
    );
    for (const header of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = header.split(";").map((part) => part.trim());
      const [name = "", value = ""] = pair.split("=");
      const expired = attributes.some(
        (attribute) => /^max-age=0$/i.test(attribute) || /^expires=.*1970/i.test(attribute),
      );
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  get = (path: string) => this.fetch(path);
  post = (path: string, body: unknown, origin = ORIGIN) =>
    this.fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });

  /** Goes through AuthKit as the user the code belongs to. */
  async signIn(code: string): Promise<void> {
    const login = await this.get("/auth/login");
    const state = new URL(login.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const callback = await this.get(`/auth/callback?${new URLSearchParams({ code, state }).toString()}`);
    expect(callback.headers.get("location")).toBe(`${ORIGIN}/`);
  }

  async session(): Promise<{ status: number; body: unknown }> {
    const response = await this.get("/auth/session");
    return { status: response.status, body: await response.json() };
  }
}

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
    expect(world.durable.organizations.get(organizationId)?.name).toBe("Acme");
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

  it("denies the session on the next request once the Person is removed from the Organization", async () => {
    const { world, browser, acme, personId } = await signedIn();
    const person = world.durable.person(acme.id, personId);
    if (person === undefined) throw new Error("no person");
    person.removed = true;
    const denied = await browser.get("/auth/session");
    expect(denied.status).toBe(401);
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);
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
