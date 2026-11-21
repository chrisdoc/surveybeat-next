// @effect-diagnostics asyncFunction:off -- the vitest runner awaits a plain Promise here; the test never enters an Effect.

import { SurveyBeatApi } from "@surveybeat/api";
import {
  assemblePersonalDataExport,
  PersonalDataSource,
  EMPTY_PULSE_STATE,
  OrganizationPulses,
  OrganizationRounds,
  PulseId,
  QuestionId,
  AuthUnavailable,
  EmailAddress,
  EmailRectification,
  MembershipId,
  OrganizationDirectory,
  OrganizationOffboarding,
  TeamId,
  identityOf,
  NewIds,
  normaliseEmail,
  OrganizationCreationAllowlist,
  OrganizationId,
  OrganizationPeople,
  PeopleIndex,
  PersonId,
  SessionId,
  SessionIdentityProvider,
  SignInAgainRequired,
  Unauthenticated,
  WrongEmailCode,
  AuthUserId,
  OrganizationActions,
  OrganizationNotes,
  RoundId,
} from "@surveybeat/domain";
import type {
  ClaimStatus,
  PendingEmailChange,
  OrganizationSummary,
  PersonCandidate,
  SignedInSession,
} from "@surveybeat/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { actionHandlers } from "./ActionHandlers.ts";
import { directoryHandlers } from "./DirectoryHandlers.ts";
import { meHandlers } from "./MeHandlers.ts";
import { noteHandlers } from "./NoteHandlers.ts";
import { pulseHandlers } from "./PulseHandlers.ts";
import { roundHandlers } from "./RoundHandlers.ts";
import { MemoryOrganizations } from "./testingOrganizations.ts";
import { authHandlers, SESSION_COOKIE } from "./auth/AuthHandlers.ts";

export { MemoryOrganizations };

interface FakeUser {
  readonly id: AuthUserId;
  readonly email: string;
  readonly emailVerified: boolean;
}

interface FakeSession {
  readonly sessionId: SessionId;
  readonly userId: AuthUserId;
}

export class FakeSessions {
  readonly users = new Map<AuthUserId, FakeUser>();
  readonly sessions = new Map<string, FakeSession>();
  readonly chosen = new Map<SessionId, OrganizationId>();
  readonly codes = new Map<string, string>();
  readonly changeCodes = new Map<string, EmailAddress>();
  staleSession = false;
  readonly revocations: SessionId[] = [];
  readonly revoked = new Set<string>();
  failRevoke = false;
  private counter = 0;

  login(email: string, emailVerified = true): string {
    const existing = [...this.users.values()].find(
      (user) => normaliseEmail(user.email) === normaliseEmail(email),
    );

    if (existing !== undefined) {
      return this.issue(existing.id);
    }

    const user = AuthUserId.make(`user_${++this.counter}`);
    this.users.set(user, { id: user, email, emailVerified });

    return this.issue(user);
  }

  private issue(user: AuthUserId): string {
    const token = `token_${++this.counter}`;
    this.sessions.set(token, { sessionId: SessionId.make(`session_${this.counter}`), userId: user });

    return token;
  }

  userIdOf(email: string): AuthUserId {
    const found = [...this.users.values()].find(
      (user) => normaliseEmail(user.email) === normaliseEmail(email),
    );

    if (found === undefined) {
      throw new Error(`no user ${email}`);
    }

    return found.id;
  }

  readonly service = SessionIdentityProvider.of({
    authenticate: (cookie) =>
      Effect.suspend(() => {
        const token = Redacted.value(cookie);
        const session = this.sessions.get(token);
        const user = session === undefined ? undefined : this.users.get(session.userId);

        if (session === undefined || user === undefined || this.revoked.has(token)) {
          return Effect.fail(new Unauthenticated());
        }

        return Effect.succeed<SignedInSession>({
          identity: identityOf(user.id, user.email, user.emailVerified),
          sessionId: session.sessionId,
        });
      }),
    chosenOrganization: (sessionId) => Effect.sync(() => Option.fromNullishOr(this.chosen.get(sessionId))),
    chooseOrganization: (sessionId, organizationId) =>
      Effect.sync(() => {
        this.chosen.set(sessionId, organizationId);
      }),
    sendSignInCode: (email) =>
      Effect.sync(() => {
        this.codes.set(`code_${++this.counter}`, normaliseEmail(email));
      }),
    verifySignInCode: (email, code) =>
      Effect.sync(() => {
        const expected = this.codes.get(code);

        const user = [...this.users.values()].find(
          (each) => normaliseEmail(each.email) === normaliseEmail(email),
        );

        if (expected !== normaliseEmail(email) || user === undefined) {
          return Option.none<string>();
        }

        this.codes.delete(code);

        return Option.some(this.issue(user.id));
      }),
    requestEmailChange: (_cookie, email) =>
      Effect.suspend(() => {
        if (this.staleSession) {
          return Effect.fail(new SignInAgainRequired());
        }

        this.changeCodes.set(`change_${++this.counter}`, email);

        return Effect.void;
      }),
    confirmEmailChange: (cookie, email, code) =>
      Effect.suspend(
        (): Effect.Effect<Option.Option<string>, SignInAgainRequired | WrongEmailCode | AuthUnavailable> => {
          const token = Redacted.value(cookie);
          const session = this.sessions.get(token);
          const user = session === undefined ? undefined : this.users.get(session.userId);

          if (session === undefined || user === undefined) {
            return Effect.fail(new AuthUnavailable());
          }

          if (this.staleSession) {
            return Effect.fail(new SignInAgainRequired());
          }

          if (this.changeCodes.get(code) !== email) {
            return Effect.fail(new WrongEmailCode());
          }

          this.changeCodes.delete(code);
          this.users.set(user.id, { ...user, email, emailVerified: true });

          return Effect.succeedSome(token);
        },
      ),
    revokeSession: (sessionId) =>
      Effect.suspend(() => {
        if (this.failRevoke) {
          return Effect.fail(new AuthUnavailable());
        }

        this.revocations.push(sessionId);

        for (const [token, session] of this.sessions) {
          if (session.sessionId === sessionId) {
            this.revoked.add(token);
          }
        }

        return Effect.void;
      }),
  });
}

export class MemoryIndex {
  private removedAtTick = 0;

  readonly organizations = new Map<OrganizationId, { name: string }>();
  readonly persons = new Map<
    string,
    {
      organizationId: OrganizationId;
      personId: PersonId;
      email: string;
      userId: AuthUserId | null;
      removedAt: number | null;
    }
  >();
  readonly claims = new Map<AuthUserId, ClaimStatus>();
  readonly erasedAccounts = new Set<AuthUserId>();

  private candidate(organizationId: OrganizationId, personId: PersonId, linked: boolean): PersonCandidate {
    const organization = this.organizations.get(organizationId);

    return { organization: { id: organizationId, name: organization?.name ?? "" }, personId, linked };
  }

  readonly service = PeopleIndex.of({
    linkedPersons: (userId) =>
      Effect.sync(() =>
        [...this.persons.values()].flatMap((person) =>
          person.userId === userId && person.removedAt === null
            ? [this.candidate(person.organizationId, person.personId, true)]
            : [],
        ),
      ),
    unlinkedPersons: (email) =>
      Effect.sync(() =>
        [...this.persons.values()].flatMap((person) =>
          person.userId === null && person.removedAt === null && person.email === normaliseEmail(email)
            ? [this.candidate(person.organizationId, person.personId, false)]
            : [],
        ),
      ),
    putOrganization: (organization) =>
      Effect.sync(() => {
        this.organizations.set(organization.id, { name: organization.name });
      }),
    putPerson: (person) =>
      Effect.sync(() => {
        const key = `${person.organizationId}/${person.personId}`;
        const existing = this.persons.get(key);
        this.persons.set(key, {
          organizationId: person.organizationId,
          personId: person.personId,
          email: normaliseEmail(person.email),
          userId: existing?.userId ?? Option.getOrNull(person.userId),
          removedAt: null,
        });
      }),
    removePerson: (organizationId, personId) =>
      Effect.sync(() => {
        const person = this.persons.get(`${organizationId}/${personId}`);

        if (person !== undefined && person.removedAt === null) {
          this.removedAtTick += 1;
          person.removedAt = this.removedAtTick;
        }
      }),
    linkPerson: (organizationId, personId, userId) =>
      Effect.sync(() => {
        const person = this.persons.get(`${organizationId}/${personId}`);

        if (person !== undefined && person.userId === null && person.removedAt === null) {
          person.userId = userId;
        }
      }),
    correctEmail: (organizationId, personId, email) =>
      Effect.sync(() => {
        const person = this.persons.get(`${organizationId}/${personId}`);

        if (person !== undefined && person.userId === null) {
          person.email = normaliseEmail(email);
        }
      }),
    erasePerson: (erased) =>
      Effect.sync(() => {
        const key = `${erased.organizationId}/${erased.personId}`;
        const userId = Option.getOrNull(erased.userId) ?? this.persons.get(key)?.userId ?? null;
        this.persons.delete(key);

        if (userId === null) {
          return;
        }

        const claim = this.claims.get(userId);

        if (claim?.organization.id === erased.organizationId) {
          this.claims.delete(userId);
        }

        if (![...this.persons.values()].some((person) => person.userId === userId)) {
          this.claims.delete(userId);
          this.erasedAccounts.add(userId);
        }
      }),
    eraseAccount: (userId) =>
      Effect.sync(() => {
        if ([...this.persons.values()].some((person) => person.userId === userId)) {
          return false;
        }

        this.claims.delete(userId);
        this.erasedAccounts.add(userId);

        return true;
      }),
    claimOrganization: (userId, proposed) =>
      Effect.sync(() => {
        const existing = this.claims.get(userId);

        if (existing !== undefined) {
          return existing;
        }

        const claim = { ...proposed, completed: false };
        this.claims.set(userId, claim);

        return claim;
      }),
    claimOf: (userId) => Effect.sync(() => Option.fromNullishOr(this.claims.get(userId))),
    completeClaim: (userId) =>
      Effect.sync(() => {
        const claim = this.claims.get(userId);

        if (claim !== undefined) {
          this.claims.set(userId, { ...claim, completed: true });
        }
      }),
  });
}

export class SignInWorld {
  readonly sessions = new FakeSessions();
  readonly index = new MemoryIndex();
  readonly durable = new MemoryOrganizations();
  private ids = 0;
  readonly allowlist: string;

  constructor(allowlist = "") {
    this.allowlist = allowlist;
  }

  addOrganization(name: string): OrganizationSummary {
    const id = OrganizationId.make(`organization-${++this.ids}`);
    this.index.organizations.set(id, { name });
    this.durable.organizations.set(id, {
      state: {
        organizationName: name,
        minimumGroupSize: 4,
        aiProcessing: false,
        defaultLocale: "en",
        people: [],
        teams: [],
        memberships: [],
      },
      pulses: EMPTY_PULSE_STATE,
      actions: new Map(),
      rounds: new Map(),
      notes: new Map(),
      sends: new Map(),
      testSends: new Map(),
      testSendTimes: new Map(),
    });

    return { id, name };
  }

  addRound(organizationId: OrganizationId, teamId: TeamId): RoundId {
    const roundId = RoundId.make(`round-${++this.ids}`);
    const organization = this.durable.organizations.get(organizationId);

    if (organization === undefined) {
      throw new Error(`no Organization ${organizationId}`);
    }

    organization.rounds.set(roundId, teamId);

    return roundId;
  }

  addPerson(organizationId: OrganizationId, email: string, organizationAdmin = false): PersonId {
    const personId = PersonId.make(`person-${++this.ids}`);
    const organization = this.durable.organizations.get(organizationId);

    if (organization === undefined) {
      throw new Error(`no Organization ${organizationId}`);
    }

    const normalised = EmailAddress.make(normaliseEmail(email));
    organization.state = {
      ...organization.state,
      people: [
        ...organization.state.people,
        {
          id: personId,
          email: normalised,
          authUserId: null,
          organizationAdmin,
          removedAt: null,
          erasedAt: null,
          locale: null,
          detectedLocale: null,
        },
      ],
    };
    this.index.persons.set(`${organizationId}/${personId}`, {
      organizationId,
      personId,
      email: normalised,
      userId: null,
      removedAt: null,
    });

    return personId;
  }

  readonly personalData = PersonalDataSource.of({
    gather: (userId, now) =>
      Effect.sync(() => {
        const user = this.sessions.users.get(userId);

        const organizations = [...this.durable.organizations].flatMap(([id, organization]) =>
          organization.state.people
            .filter((person) => person.authUserId === userId)
            .map((person) => ({
              organization: { id, name: organization.state.organizationName },
              person: {
                id: person.id,
                email: person.email,
                timeZone: null,
                locale: person.locale,
                detectedLocale: person.detectedLocale,
                organizationAdmin: person.organizationAdmin,
                removedAt: person.removedAt === null ? null : String(person.removedAt),
              },
              memberships: [],
              participation: [],
              roundMembers: [],
              invitations: [],
              reminderOptOuts: [],
              actions: [],
              emailSends: [],
              testSends: [],
            })),
        );

        return assemblePersonalDataExport({
          now,
          account: {
            user:
              user === undefined
                ? null
                : {
                    id: user.id,
                    name: user.email,
                    email: user.email,
                    emailVerified: user.emailVerified,
                    createdAt: null,
                    updatedAt: null,
                  },
            activeSessions: [],
            providerLinks: [],
            passkeys: [],
            personIndex: [],
            organizationClaims: [],
          },
          organizations,
        });
      }),
  });

  readonly pendingEmailChanges = new Map<AuthUserId, PendingEmailChange>();

  private takenBy(email: EmailAddress, owner: (userId: AuthUserId | null) => boolean): boolean {
    const account = [...this.sessions.users.values()].some(
      (user) => normaliseEmail(user.email) === email && owner(user.id),
    );

    return (
      account ||
      [...this.index.persons.values()].some((person) => person.email === email && owner(person.userId))
    );
  }

  readonly emailRectification = EmailRectification.of({
    takenByAnotherAccount: (userId, email) =>
      Effect.sync(() => this.takenBy(email, (owner) => owner !== userId)),
    takenByAnyAccount: (email) =>
      Effect.sync(
        () =>
          [...this.sessions.users.values()].some((user) => normaliseEmail(user.email) === email) ||
          [...this.index.persons.values()].some((person) => person.email === email && person.userId !== null),
      ),
    pending: (userId) => Effect.sync(() => Option.fromNullishOr(this.pendingEmailChanges.get(userId))),
    begin: (userId, change) =>
      Effect.sync(() => {
        this.pendingEmailChanges.set(userId, change);
      }),
    abandon: (userId, newEmail) =>
      Effect.sync(() => {
        if (this.pendingEmailChanges.get(userId)?.newEmail === newEmail) {
          this.pendingEmailChanges.delete(userId);
        }
      }),
    moveIndex: (userId, email) =>
      Effect.sync(() => {
        const organizations = new Set<OrganizationId>();

        for (const person of this.index.persons.values()) {
          if (person.userId === userId) {
            person.email = email;
            organizations.add(person.organizationId);
          }
        }

        return [...organizations].toSorted();
      }),
    finish: (userId) =>
      Effect.sync(() => {
        this.pendingEmailChanges.delete(userId);
      }),
  });

  readonly offboardings = new Map<OrganizationId, AuthUserId>();

  readonly offboarding = OrganizationOffboarding.of({
    begin: (organizationId, userId) =>
      Effect.sync(() => {
        if (!this.offboardings.has(organizationId)) {
          this.offboardings.set(organizationId, userId);
        }

        return this.offboardings.get(organizationId) === userId;
      }),
    pending: (userId) =>
      Effect.sync(() =>
        Option.fromNullishOr([...this.offboardings].find(([, actor]) => actor === userId)?.[0]),
      ),
    revokeAccess: () => Effect.void,
    wipe: (organizationId) =>
      Effect.sync(() => {
        this.durable.organizations.delete(organizationId);
      }),
    removeIndex: (organizationId) =>
      Effect.sync(() => {
        const accounts = new Set<AuthUserId>();

        for (const [key, person] of this.index.persons) {
          if (person.organizationId === organizationId) {
            if (person.userId !== null) {
              accounts.add(person.userId);
            }

            this.index.persons.delete(key);
          }
        }

        this.index.organizations.delete(organizationId);
        this.offboardings.delete(organizationId);

        return [...accounts];
      }),
  });

  readonly handler = (): ((request: Request) => Promise<Response>) => {
    const services = Context.make(SessionIdentityProvider, this.sessions.service).pipe(
      Context.add(PeopleIndex, this.index.service),
      Context.add(OrganizationPeople, this.durable.service),
      Context.add(OrganizationDirectory, this.durable.directory),
      Context.add(OrganizationOffboarding, this.offboarding),
      Context.add(EmailRectification, this.emailRectification),
      Context.add(OrganizationPulses, this.durable.pulses),
      Context.add(OrganizationRounds, this.durable.rounds),
      Context.add(OrganizationActions, this.durable.actions),
      Context.add(OrganizationNotes, this.durable.notes),
      Context.add(PersonalDataSource, this.personalData),
      Context.add(
        NewIds,
        NewIds.of({
          organizationId: Effect.sync(() => OrganizationId.make(`created-${++this.ids}`)),
          personId: Effect.sync(() => PersonId.make(`added-${++this.ids}`)),
          teamId: Effect.sync(() => TeamId.make(`team-${++this.ids}`)),
          membershipId: Effect.sync(() => MembershipId.make(`membership-${++this.ids}`)),
          pulseId: Effect.sync(() => PulseId.make(`pulse-${++this.ids}`)),
          questionId: Effect.sync(() => QuestionId.make(`question-${++this.ids}`)),
        }),
      ),
    );

    const auth = authHandlers({
      services: Effect.succeed(services),
      allowlist: Effect.sync(() => new OrganizationCreationAllowlist(this.allowlist)),
    });

    const { handler } = HttpRouter.toWebHandler(
      HttpApiBuilder.layer(SurveyBeatApi).pipe(
        Layer.provide([
          auth,
          directoryHandlers(Effect.succeed(services)),
          pulseHandlers(Effect.succeed(services)),
          roundHandlers(Effect.succeed(services)),
          actionHandlers(Effect.succeed(services)),
          noteHandlers(Effect.succeed(services)),
          meHandlers(Effect.succeed(services)),
        ]),
        Layer.provide(HttpServer.layerServices),
      ),
    );

    return (request) => handler(request);
  };
}

export const ORIGIN = "https://pr-1.app.surveybeat.app";

export class Browser {
  readonly cookies = new Map<string, string>();
  private readonly handle: (request: Request) => Promise<Response>;

  constructor(handle: (request: Request) => Promise<Response>) {
    this.handle = handle;
  }

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

      if (expired || value === "") {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
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

  send = (method: string, path: string, body?: unknown, origin = ORIGIN) =>
    this.fetch(path, {
      method,
      headers: { origin, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  async call(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const response = await this.send(method, path, body);
    const text = await response.text();

    return { status: response.status, body: text === "" ? null : JSON.parse(text) };
  }

  signIn(token: string): void {
    this.cookies.set(SESSION_COOKIE, token);
  }

  async session(): Promise<{ status: number; body: unknown }> {
    const response = await this.get("/auth/session");

    return { status: response.status, body: await response.json() };
  }
}
