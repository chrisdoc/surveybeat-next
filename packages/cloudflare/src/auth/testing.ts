import { SurveyBeatApi } from "@surveybeat/api";
import {
  AuthUnavailable,
  type ClaimStatus,
  type CodeExchange,
  IdentityProvider,
  identityOf,
  NewIds,
  normaliseEmail,
  OrganizationCreationAllowlist,
  OrganizationId,
  OrganizationPeople,
  type OrganizationRole,
  type OrganizationSummary,
  PeopleIndex,
  type PersonCandidate,
  PersonId,
  type ProviderSession,
  SessionId,
  Unauthenticated,
  WorkosOrganizationId,
  WorkosUserId,
} from "@surveybeat/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { authHandlers } from "./AuthHandlers.ts";

/**
 * In-memory stand-ins for WorkOS, the D1 index, and the Organization Durable Objects, for the
 * sign-in API tests. Plain mutable state: each test builds a fresh `SignInWorld`.
 */

interface FakeUser {
  readonly id: WorkosUserId;
  readonly email: string;
  readonly emailVerified: boolean;
}

interface FakeSession {
  readonly sessionId: SessionId;
  readonly userId: WorkosUserId;
  readonly workosOrganizationId: Option.Option<WorkosOrganizationId>;
  expired: boolean;
}

interface FakePerson {
  readonly email: string;
  workosUserId: WorkosUserId | null;
  removed: boolean;
}

export class FakeWorkos {
  readonly users = new Map<WorkosUserId, FakeUser>();
  readonly codes = new Map<string, WorkosUserId>();
  readonly sessions = new Map<string, FakeSession>();
  readonly organizations = new Map<OrganizationId, { id: WorkosOrganizationId; name: string }>();
  readonly memberships = new Map<string, OrganizationRole>();
  /** WorkOS sessions ended by `revokeSession`: their refresh token no longer works. */
  readonly revokedSessions = new Set<SessionId>();
  private readonly pending = new Map<string, WorkosUserId>();
  createOrganizationCalls = 0;
  ensureMembershipCalls = 0;
  /** Fail the next N `createOrganization` calls as if WorkOS were down. */
  failCreateOrganization = 0;
  /** Fail `revokeSession` as if WorkOS were down. */
  failRevokeSession = false;
  /** Ask a user with several memberships to pick one at the code exchange, as AuthKit may. */
  requireOrganizationSelection = false;
  private counter = 0;

  addUser(email: string, emailVerified = true): string {
    const id = WorkosUserId.make(`user_${++this.counter}`);
    this.users.set(id, { id, email, emailVerified });
    const code = `code_${this.counter}`;
    this.codes.set(code, id);
    return code;
  }

  /** Another sign-in for an existing user. */
  newCode(userId: WorkosUserId | undefined): string {
    if (userId === undefined || !this.users.has(userId)) throw new Error("no such user");
    const code = `code_${++this.counter}`;
    this.codes.set(code, userId);
    return code;
  }

  private issue(
    userId: WorkosUserId,
    sessionId: SessionId,
    organization: Option.Option<WorkosOrganizationId>,
  ) {
    const sealed = `sealed_${++this.counter}`;
    this.sessions.set(sealed, { sessionId, userId, workosOrganizationId: organization, expired: false });
    return this.toSession(sealed);
  }

  private toSession(sealed: string): ProviderSession {
    const session = this.sessions.get(sealed);
    const user = session === undefined ? undefined : this.users.get(session.userId);
    if (session === undefined || user === undefined) throw new Error(`no session ${sealed}`);
    return {
      sealed: Redacted.make(sealed),
      sessionId: session.sessionId,
      identity: identityOf(user.id, user.email, user.emailVerified),
      workosOrganizationId: session.workosOrganizationId,
      role: Option.flatMap(session.workosOrganizationId, (organization) =>
        Option.fromNullishOr(this.memberships.get(`${user.id}/${organization}`)),
      ),
    };
  }

  /** Lets the access token in this cookie run out, as five minutes would. */
  expire(sealed: string) {
    const session = this.sessions.get(sealed);
    if (session !== undefined) session.expired = true;
  }

  readonly service = IdentityProvider.of({
    authorizationUrl: ({ redirectUri, state }) =>
      `https://auth.example.test/authorize?${new URLSearchParams({ redirect_uri: redirectUri, state }).toString()}`,
    authenticateWithCode: (code) =>
      Effect.suspend(() => {
        const userId = this.codes.get(code);
        if (userId === undefined) return Effect.fail(new Unauthenticated());
        this.codes.delete(code);
        const organizations = [...this.memberships.keys()]
          .filter((key) => key.startsWith(`${userId}/`))
          .map((key) => WorkosOrganizationId.make(key.slice(userId.length + 1)));
        if (this.requireOrganizationSelection && organizations.length > 1) {
          const token = `pending_${++this.counter}`;
          this.pending.set(token, userId);
          return Effect.succeed<CodeExchange>({
            _tag: "OrganizationSelectionRequired",
            pendingAuthenticationToken: Redacted.make(token),
            userId: Option.some(userId),
            organizations,
          });
        }
        return Effect.succeed<CodeExchange>({
          _tag: "Authenticated",
          session: this.issue(userId, SessionId.make(`session_${++this.counter}`), Option.none()),
        });
      }),
    authenticateWithOrganizationSelection: (token, organization) =>
      Effect.suspend(() => {
        const userId = this.pending.get(Redacted.value(token));
        if (userId === undefined || !this.memberships.has(`${userId}/${organization}`)) {
          return Effect.fail(new Unauthenticated());
        }
        this.pending.delete(Redacted.value(token));
        return Effect.succeed(
          this.issue(userId, SessionId.make(`session_${++this.counter}`), Option.some(organization)),
        );
      }),
    authenticate: (sealed) =>
      Effect.sync(() => {
        const session = this.sessions.get(Redacted.value(sealed));
        if (session === undefined) return { _tag: "Invalid" } as const;
        if (session.expired) return { _tag: "Expired" } as const;
        return { _tag: "Valid", session: this.toSession(Redacted.value(sealed)) } as const;
      }),
    refresh: (sealed, organization) =>
      Effect.suspend(() => {
        const session = this.sessions.get(Redacted.value(sealed));
        if (session === undefined || this.revokedSessions.has(session.sessionId)) {
          return Effect.fail(new Unauthenticated());
        }
        const target = Option.orElse(organization, () => session.workosOrganizationId);
        if (Option.isSome(target) && !this.memberships.has(`${session.userId}/${target.value}`)) {
          return Effect.fail(new Unauthenticated());
        }
        // Refresh tokens rotate, but WorkOS replays a just-used one for 30 seconds so concurrent
        // refreshes converge. The fake keeps the old cookie usable; `sessions.delete` ends it.
        return Effect.succeed(this.issue(session.userId, session.sessionId, target));
      }),
    logoutUrl: (sessionId, returnTo) =>
      `https://auth.example.test/logout?${new URLSearchParams({ session_id: sessionId, return_to: returnTo }).toString()}`,
    revokeSession: (sessionId) =>
      Effect.suspend(() => {
        if (this.failRevokeSession) return Effect.fail(new AuthUnavailable());
        this.revokedSessions.add(sessionId);
        return Effect.void;
      }),
    createOrganization: (name, externalId) =>
      Effect.suspend(() => {
        this.createOrganizationCalls++;
        if (this.failCreateOrganization > 0) {
          this.failCreateOrganization--;
          return Effect.fail(new AuthUnavailable());
        }
        const existing = this.organizations.get(externalId);
        if (existing !== undefined) return Effect.succeed(existing.id);
        const id = WorkosOrganizationId.make(`org_${++this.counter}`);
        this.organizations.set(externalId, { id, name });
        return Effect.succeed(id);
      }),
    ensureMembership: (userId, organization, role) =>
      Effect.sync(() => {
        this.ensureMembershipCalls++;
        const key = `${userId}/${organization}`;
        if (!this.memberships.has(key)) this.memberships.set(key, role);
      }),
  });
}

export class MemoryIndex {
  readonly organizations = new Map<OrganizationId, { name: string; workos: WorkosOrganizationId | null }>();
  readonly persons = new Map<
    string,
    { organizationId: OrganizationId; personId: PersonId; email: string; userId: WorkosUserId | null }
  >();
  readonly claims = new Map<WorkosUserId, ClaimStatus>();
  readonly revoked = new Set<SessionId>();

  private candidate(organizationId: OrganizationId, personId: PersonId, linked: boolean): PersonCandidate {
    const organization = this.organizations.get(organizationId);
    return { organization: { id: organizationId, name: organization?.name ?? "" }, personId, linked };
  }

  readonly service = PeopleIndex.of({
    linkedPersons: (userId) =>
      Effect.sync(() =>
        [...this.persons.values()]
          .filter((person) => person.userId === userId)
          .map((person) => this.candidate(person.organizationId, person.personId, true)),
      ),
    unlinkedPersons: (email) =>
      Effect.sync(() =>
        [...this.persons.values()]
          .filter((person) => person.userId === null && person.email === normaliseEmail(email))
          .map((person) => this.candidate(person.organizationId, person.personId, false)),
      ),
    putOrganization: (organization, workos) =>
      Effect.sync(() => {
        const existing = this.organizations.get(organization.id);
        this.organizations.set(organization.id, {
          name: organization.name,
          workos: Option.getOrNull(workos) ?? existing?.workos ?? null,
        });
      }),
    organizationByWorkos: (workos) =>
      Effect.sync(() => {
        const found = [...this.organizations].find(([, organization]) => organization.workos === workos);
        return Option.map(Option.fromNullishOr(found), ([id, organization]) => ({
          id,
          name: organization.name,
        }));
      }),
    workosOrganizationOf: (organizationId) =>
      Effect.sync(() => Option.fromNullishOr(this.organizations.get(organizationId)?.workos)),
    putPerson: (person) =>
      Effect.sync(() => {
        const key = `${person.organizationId}/${person.personId}`;
        const existing = this.persons.get(key);
        this.persons.set(key, {
          organizationId: person.organizationId,
          personId: person.personId,
          email: normaliseEmail(person.email),
          userId: existing?.userId ?? Option.getOrNull(person.userId),
        });
      }),
    linkPerson: (organizationId, personId, userId) =>
      Effect.sync(() => {
        const person = this.persons.get(`${organizationId}/${personId}`);
        if (person !== undefined && person.userId === null) person.userId = userId;
      }),
    claimOrganization: (userId, proposed) =>
      Effect.sync(() => {
        const existing = this.claims.get(userId);
        if (existing !== undefined) return existing;
        const claim = { ...proposed, completed: false };
        this.claims.set(userId, claim);
        return claim;
      }),
    claimOf: (userId) => Effect.sync(() => Option.fromNullishOr(this.claims.get(userId))),
    completeClaim: (userId) =>
      Effect.sync(() => {
        const claim = this.claims.get(userId);
        if (claim !== undefined) this.claims.set(userId, { ...claim, completed: true });
      }),
    revokeSession: (sessionId) => Effect.sync(() => void this.revoked.add(sessionId)),
    isSessionRevoked: (sessionId) => Effect.sync(() => this.revoked.has(sessionId)),
  });
}

export class MemoryOrganizations {
  readonly organizations = new Map<OrganizationId, { name: string; people: Map<PersonId, FakePerson> }>();

  readonly service = OrganizationPeople.of({
    createWithAdmin: (organization, admin) =>
      Effect.sync(() => {
        if (this.organizations.has(organization.id)) return;
        this.organizations.set(organization.id, {
          name: organization.name,
          people: new Map([
            [
              admin.personId,
              { email: normaliseEmail(admin.email), workosUserId: admin.userId, removed: false },
            ],
          ]),
        });
      }),
    linkPerson: (organizationId, personId, userId, email) =>
      Effect.sync(() => {
        const people = this.organizations.get(organizationId)?.people;
        const person = people?.get(personId);
        if (people === undefined || person === undefined || person.removed) return false;
        if (person.email !== normaliseEmail(email)) return false;
        if ([...people].some(([id, other]) => id !== personId && other.workosUserId === userId)) return false;
        if (person.workosUserId === null) person.workosUserId = userId;
        return person.workosUserId === userId;
      }),
    activePerson: (organizationId, userId) =>
      Effect.sync(() => {
        const people = this.organizations.get(organizationId)?.people ?? new Map<PersonId, FakePerson>();
        const found = [...people].find(([, person]) => person.workosUserId === userId && !person.removed);
        return Option.map(Option.fromNullishOr(found), ([id]) => id);
      }),
  });

  person(organizationId: OrganizationId, personId: PersonId): FakePerson | undefined {
    return this.organizations.get(organizationId)?.people.get(personId);
  }
}

/** Everything a sign-in test talks to, plus helpers to set up Organizations a Lead already filled. */
export class SignInWorld {
  readonly workos = new FakeWorkos();
  readonly index = new MemoryIndex();
  readonly durable = new MemoryOrganizations();
  private ids = 0;

  constructor(readonly allowlist = "") {}

  /** An Organization with its WorkOS organization, as slice 04 will have created it. */
  addOrganization(name: string): OrganizationSummary & { readonly workos: WorkosOrganizationId } {
    const id = OrganizationId.make(`organization-${++this.ids}`);
    const workos = WorkosOrganizationId.make(`org_existing_${this.ids}`);
    this.workos.organizations.set(id, { id: workos, name });
    this.index.organizations.set(id, { name, workos });
    this.durable.organizations.set(id, { name, people: new Map() });
    return { id, name, workos };
  }

  /** A Person a Lead added by email, not signed in yet. */
  addPerson(organizationId: OrganizationId, email: string): PersonId {
    const personId = PersonId.make(`person-${++this.ids}`);
    this.durable.organizations
      .get(organizationId)
      ?.people.set(personId, { email: normaliseEmail(email), workosUserId: null, removed: false });
    this.index.persons.set(`${organizationId}/${personId}`, {
      organizationId,
      personId,
      email: normaliseEmail(email),
      userId: null,
    });
    return personId;
  }

  readonly handler = (): ((request: Request) => Promise<Response>) => {
    const services = Context.make(IdentityProvider, this.workos.service).pipe(
      Context.add(PeopleIndex, this.index.service),
      Context.add(OrganizationPeople, this.durable.service),
      Context.add(
        NewIds,
        NewIds.of({
          organizationId: Effect.sync(() => OrganizationId.make(`created-${++this.ids}`)),
          personId: Effect.sync(() => PersonId.make(`admin-${++this.ids}`)),
        }),
      ),
    );
    const auth = authHandlers({
      services: Effect.succeed(services),
      allowlist: Effect.sync(() => new OrganizationCreationAllowlist(this.allowlist)),
    });
    const organizations = HttpApiBuilder.group(SurveyBeatApi, "organizations", (handlers) =>
      handlers.handle("create", () => Effect.die("not used")).handle("getById", () => Effect.die("not used")),
    );
    const { handler } = HttpRouter.toWebHandler(
      HttpApiBuilder.layer(SurveyBeatApi).pipe(
        Layer.provide([auth, organizations]),
        Layer.provide(HttpServer.layerServices),
      ),
    );
    return (request) => handler(request);
  };
}
