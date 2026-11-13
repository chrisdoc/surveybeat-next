import { SurveyBeatApi } from "@surveybeat/api";
import {
  applyChanges,
  applyPulseChanges,
  emailStatusView,
  failedEmailsView,
  type FailedEmail,
  type FailureReason,
  isEmailAdmin,
  isResendable,
  pending,
  progressOf,
  type ResendFacts,
  type ResendResult,
  type SendState,
  testSendView,
  type TestSendFound,
  decidePulse,
  decideTestSend,
  EMPTY_PULSE_STATE,
  emailLocaleOf,
  testSendsPerHour,
  type TestSendResult,
  OrganizationPulses,
  OrganizationRounds,
  PulseId,
  type PulseCommandResult,
  type PulseState,
  pulsesView,
  pulseView,
  QuestionId,
  AuthUnavailable,
  type ClaimStatus,
  type CommandResult,
  decide,
  DEFAULT_MINIMUM_GROUP_SIZE,
  type DirectoryState,
  EmailAddress,
  EmailOutbox,
  MembershipId,
  OrganizationDirectory,
  type PersonRecord,
  SendId,
  settingsView,
  TeamId,
  teamsView,
  teamView,
  type TransactionalEmail,
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
  ActionId,
  type ActionItem,
  type ActionList,
  type ActionRecord,
  type ActionViewed,
  OrganizationActions,
  authorizeRoundAction,
  type RoundViewed,
  type TeamOverview,
  type NoteViewed,
  type RoundNote,
  type RoundNoteView,
  OrganizationNotes,
  noteChange,
  RoundId,
} from "@surveybeat/domain";
import { expect } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { actionHandlers } from "../ActionHandlers.ts";
import { directoryHandlers } from "../DirectoryHandlers.ts";
import { noteHandlers } from "../NoteHandlers.ts";
import { pulseHandlers } from "../PulseHandlers.ts";
import { roundHandlers } from "../RoundHandlers.ts";
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

export class FakeWorkos {
  readonly users = new Map<WorkosUserId, FakeUser>();
  readonly codes = new Map<string, WorkosUserId>();
  readonly sessions = new Map<string, FakeSession>();
  readonly organizations = new Map<OrganizationId, { id: WorkosOrganizationId; name: string }>();
  readonly memberships = new Map<string, OrganizationRole>();
  /** Memberships deactivated by a removal (`user/org` keys): AuthKit no longer signs the user in there. */
  readonly inactiveMemberships = new Set<string>();
  /** WorkOS sessions ended by `revokeSession`: their refresh token no longer works. */
  readonly revokedSessions = new Set<SessionId>();
  private readonly pending = new Map<string, WorkosUserId>();
  createOrganizationCalls = 0;
  ensureMembershipCalls = 0;
  /** Fail the next N `createOrganization` calls as if WorkOS were down. */
  failCreateOrganization = 0;
  /** Fail `revokeSession` as if WorkOS were down. */
  failRevokeSession = false;
  /** Fail role changes and deactivations as if WorkOS were down. */
  failMembershipChanges = false;
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
          .filter((key) => key.startsWith(`${userId}/`) && !this.inactiveMemberships.has(key))
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
        const key = `${session.userId}/${Option.getOrElse(target, () => "")}`;
        if (Option.isSome(target) && (!this.memberships.has(key) || this.inactiveMemberships.has(key))) {
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
        this.memberships.set(key, role);
        this.inactiveMemberships.delete(key);
      }),
    setMembershipRole: (userId, organization, role) =>
      Effect.suspend(() => {
        if (this.failMembershipChanges) return Effect.fail(new AuthUnavailable());
        const key = `${userId}/${organization}`;
        if (this.memberships.has(key)) this.memberships.set(key, role);
        return Effect.void;
      }),
    deactivateMembership: (userId, organization) =>
      Effect.suspend(() => {
        if (this.failMembershipChanges) return Effect.fail(new AuthUnavailable());
        const key = `${userId}/${organization}`;
        if (this.memberships.has(key)) this.inactiveMemberships.add(key);
        return Effect.void;
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
    removePerson: (organizationId, personId) =>
      Effect.sync(() => void this.persons.delete(`${organizationId}/${personId}`)),
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

/**
 * What the fake knows of a send's resend. The fake keeps no Invitations, so an Invitation's, a reminder's, and a
 * legacy email's send is never resendable here; the other kinds follow the same rule as the Durable Object.
 */
const fakeResendFacts = (
  organization: MemoryOrganization,
  sendId: SendId,
  email: TransactionalEmail,
  reason: FailureReason,
): ResendFacts => ({
  kind: email._tag,
  reason,
  generation: null,
  invitation: null,
  testSend: organization.testSends.has(sendId),
});

/** One Organization's object: its directory state, its question library and Pulses, and its sends. */
interface MemoryOrganization {
  state: DirectoryState;
  pulses: PulseState;
  actions: Map<ActionId, ActionRecord>;
  /** Rounds seeded by tests (`SignInWorld.addRound`), each with the Team it belongs to. */
  rounds: Map<RoundId, TeamId>;
  /** The Lead's Note per Round. */
  notes: Map<RoundId, RoundNote>;
  /** Each send, with its state: the fake never delivers, so a test sets a state by hand. */
  readonly sends: Map<
    SendId,
    { readonly recipient: EmailAddress; readonly email: TransactionalEmail; readonly state: SendState }
  >;
  /** Who sent each test of a Pulse, which Pulse, and when (ADR 0021). */
  readonly testSends: Map<
    SendId,
    { readonly personId: PersonId; readonly pulseId: PulseId; readonly sentAt: number }
  >;
  /** When each Person sent a test of a Pulse, for the hourly limit (ADR 0021). */
  readonly testSendTimes: Map<PersonId, ReadonlyArray<number>>;
}

/**
 * The Organization Durable Objects in memory. The directory runs the domain's `decide` and
 * `applyChanges`, as the real object runs `decide` and applies the changes in SQL.
 */
export class MemoryOrganizations {
  readonly organizations = new Map<OrganizationId, MemoryOrganization>();

  private organization(organizationId: OrganizationId): MemoryOrganization {
    const found = this.organizations.get(organizationId);
    if (found !== undefined) return found;
    // The real object answers an empty directory for an id nothing created.
    return {
      state: {
        organizationName: "",
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
    };
  }

  readonly service = OrganizationPeople.of({
    createWithAdmin: (organization, admin) =>
      Effect.sync(() => {
        if (this.organizations.has(organization.id)) return;
        this.organizations.set(organization.id, {
          state: {
            organizationName: organization.name,
            minimumGroupSize: DEFAULT_MINIMUM_GROUP_SIZE,
            aiProcessing: false,
            defaultLocale: "en",
            people: [
              {
                id: admin.personId,
                email: EmailAddress.make(normaliseEmail(admin.email)),
                workosUserId: admin.userId,
                organizationAdmin: true,
                removedAt: null,
                locale: null,
                detectedLocale: null,
              },
            ],
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
      }),
    linkPerson: (organizationId, personId, userId, email) =>
      Effect.sync(() => {
        const organization = this.organizations.get(organizationId);
        if (organization === undefined) return false;
        const { people } = organization.state;
        const person = people.find((each) => each.id === personId);
        if (person === undefined || person.removedAt !== null) return false;
        if (person.email !== normaliseEmail(email)) return false;
        if (people.some((other) => other.id !== personId && other.workosUserId === userId)) return false;
        if (person.workosUserId === null) this.update(organizationId, personId, { workosUserId: userId });
        return this.person(organizationId, personId)?.workosUserId === userId;
      }),
    activePerson: (organizationId, userId) =>
      Effect.sync(() => {
        const found = this.organization(organizationId).state.people.find(
          (person) => person.workosUserId === userId && person.removedAt === null,
        );
        const organizationLocale = this.organization(organizationId).state.defaultLocale;
        return Option.map(Option.fromNullishOr(found), (person) => ({
          personId: person.id,
          organizationAdmin: person.organizationAdmin,
          locale: person.locale,
          detectedLocale: person.detectedLocale,
          organizationLocale,
        }));
      }),
  });

  readonly directory = OrganizationDirectory.of({
    run: (organizationId, actorId, command, now) =>
      Effect.sync((): CommandResult => {
        const organization = this.organizations.get(organizationId);
        if (organization === undefined) return { _tag: "Rejected", rejection: { _tag: "Forbidden" } };
        const decision = decide(organization.state, actorId, command, now);
        if (decision._tag === "Rejected") return decision;
        organization.state = applyChanges(organization.state, decision.changes);
        for (const change of decision.changes) {
          if (change._tag === "EmailRequested" && !organization.sends.has(change.sendId)) {
            organization.sends.set(change.sendId, {
              recipient: change.recipient,
              email: change.email,
              state: pending,
            });
          }
        }
        return {
          _tag: "Accepted",
          // The fake never delivers, so every send it holds is still pending.
          followUps: decision.followUps.filter(
            (step) => step._tag !== "QueueEmail" || organization.sends.has(step.sendId),
          ),
        };
      }),
    // The fake has no Round dates, so every Team reads as having none scheduled.
    teams: (organizationId, actorId) =>
      Effect.sync(() => {
        const view = teamsView(this.organization(organizationId).state, actorId);
        return view._tag === "Viewed"
          ? {
              _tag: "Viewed" as const,
              value: view.value.map((team) => ({ ...team, nextRoundDate: null })),
            }
          : view;
      }),
    team: (organizationId, actorId, teamId) =>
      Effect.sync(() => teamView(this.organization(organizationId).state, actorId, teamId)),
    settings: (organizationId, actorId) =>
      Effect.sync(() => settingsView(this.organization(organizationId).state, actorId)),
    failedEmails: (organizationId, actorId) =>
      Effect.sync(() => {
        const organization = this.organization(organizationId);
        // Newest first, the last 50, as the Durable Object's query reads them.
        const failed = [...organization.sends]
          .flatMap(([sendId, send]): ReadonlyArray<FailedEmail> => {
            if (send.state._tag !== "Failed") return [];
            return [
              {
                sendId,
                kind: send.email._tag,
                recipient: send.recipient,
                reason: send.state.reason,
                code: send.state.code,
                failedAt: send.state.failedAt,
                resendable: isResendable(
                  sendId,
                  fakeResendFacts(organization, sendId, send.email, send.state.reason),
                ),
              },
            ];
          })
          .sort((a, b) => b.failedAt - a.failedAt)
          .slice(0, 50);
        return failedEmailsView(organization.state, actorId, failed);
      }),
    resendFailedEmail: (organizationId, actorId, sendId, _now) =>
      Effect.sync((): ResendResult => {
        const organization = this.organization(organizationId);
        if (!isEmailAdmin(organization.state, actorId))
          return { _tag: "Rejected", rejection: { _tag: "Forbidden" } };
        const send = organization.sends.get(sendId);
        if (send === undefined) return { _tag: "Rejected", rejection: { _tag: "FailedEmailNotFound" } };
        if (send.state._tag !== "Failed")
          return {
            _tag: "Accepted",
            status: { sendId, state: progressOf(send.state) },
            queue: send.state._tag === "Pending" && send.state.attempts === 0,
          };
        const facts = fakeResendFacts(organization, sendId, send.email, send.state.reason);
        if (!isResendable(sendId, facts))
          return { _tag: "Rejected", rejection: { _tag: "EmailNotResendable" } };
        organization.sends.set(sendId, { ...send, state: pending });
        return { _tag: "Accepted", status: { sendId, state: progressOf(pending) }, queue: true };
      }),
    emailStatus: (organizationId, actorId, sendId) =>
      Effect.sync(() => {
        const organization = this.organization(organizationId);
        const send = organization.sends.get(sendId);
        return emailStatusView(
          organization.state,
          actorId,
          send === undefined ? null : { sendId, state: progressOf(send.state) },
        );
      }),
  });

  /** The question library and Pulses, decided and applied as the real object does in SQL. */
  readonly pulses = OrganizationPulses.of({
    run: (organizationId, actorId, command, now) =>
      Effect.sync((): PulseCommandResult => {
        const organization = this.organizations.get(organizationId);
        if (organization === undefined) return { _tag: "Rejected", rejection: { _tag: "Forbidden" } };
        const decision = decidePulse(organization.state, organization.pulses, actorId, command, now);
        if (decision._tag === "Rejected") return decision;
        organization.pulses = applyPulseChanges(organization.pulses, decision.changes);
        return { _tag: "Accepted" };
      }),
    pulses: (organizationId, actorId, teamId) =>
      Effect.sync(() => {
        const organization = this.organization(organizationId);
        const view = pulsesView(organization.state, organization.pulses, actorId, teamId);
        return view._tag === "Viewed"
          ? {
              _tag: "Viewed" as const,
              value: {
                ...view.value,
                pulses: view.value.pulses.map((pulse) => ({
                  ...pulse,
                  paused: false,
                  nextRoundDate: null,
                })),
              },
            }
          : view;
      }),
    pulse: (organizationId, actorId, teamId, pulseId) =>
      Effect.sync(() => {
        const organization = this.organization(organizationId);
        return pulseView(organization.state, organization.pulses, actorId, teamId, pulseId);
      }),
    testSend: (organizationId, actorId, teamId, pulseId, sendId, now) =>
      Effect.sync(() => {
        const organization = this.organization(organizationId);
        const test = organization.testSends.get(sendId);
        const send = organization.sends.get(sendId);
        // The fake's send with no email row is queued, as the Durable Object reads it.
        const found: TestSendFound | null =
          test === undefined ? null : { ...test, state: send?.state ?? pending };
        return testSendView(organization.state, actorId, teamId, pulseId, found, now);
      }),
    sendTest: (organizationId, actorId, teamId, pulseId, now) =>
      Effect.sync((): TestSendResult => {
        const organization = this.organization(organizationId);
        const decision = decideTestSend(organization.state, organization.pulses, actorId, teamId, pulseId);
        if (decision._tag === "Rejected") return decision;
        const { person, pulse } = decision;
        const recent = (organization.testSendTimes.get(actorId) ?? []).filter((at) => at > now - 3_600_000);
        if (recent.length >= testSendsPerHour) {
          return { _tag: "Rejected", rejection: { _tag: "TestSendLimitReached", perHour: testSendsPerHour } };
        }
        organization.testSendTimes.set(actorId, [...recent, now]);
        // The fake keeps the email as the real object stores it: no token, marked as a test.
        const first = organization.pulses.versions.find((version) => version.id === pulse.questions[0]);
        const testEmail: TransactionalEmail = {
          _tag: "TestInvitationEmail",
          locale: emailLocaleOf(organization.state, actorId),
          pulseName: pulse.settings.name,
          minimumGroupSize: organization.state.minimumGroupSize,
          test: { pulseId, personId: actorId, testId: crypto.randomUUID() },
          baseUrl: "https://app.surveybeat.app",
          ratingQuestion:
            first !== undefined && first.content.type._tag === "Rating"
              ? {
                  text: first.content.text,
                  lowLabel: first.content.type.lowLabel,
                  highLabel: first.content.type.highLabel,
                }
              : null,
          // The fake has no Round, so no Actions to offer; the real object lists the Team's open ones.
          actions: [],
          aiProcessing: organization.state.aiProcessing,
        };
        const sendId = SendId.make(crypto.randomUUID());
        organization.sends.set(sendId, { recipient: person.email, email: testEmail, state: pending });
        organization.testSends.set(sendId, { personId: actorId, pulseId, sentAt: now });
        return { _tag: "Accepted", sendId, email: person.email };
      }),
  });

  readonly rounds = OrganizationRounds.of({
    run: (_organizationId, _actorId, _command, _now) => Effect.succeed({ _tag: "Accepted" }),
    rounds: (_organizationId, _actorId, _teamId, pulseId) =>
      Effect.succeed({ _tag: "Viewed", value: { pulseId, paused: false, rounds: [] } }),
    round: (_organizationId, _actorId, _teamId, _roundId) =>
      Effect.succeed({ _tag: "Rejected", rejection: { _tag: "RoundNotFound" } }),
    results: (_organizationId, _actorId, _teamId, _roundId) =>
      Effect.succeed({ _tag: "Rejected", rejection: { _tag: "RoundNotFound" } }),
    overview: (organizationId, actorId, teamId) =>
      Effect.sync((): RoundViewed<TeamOverview> => {
        const organization = this.organization(organizationId);
        const auth = authorizeRoundAction(organization.state, actorId, "team.viewResults", teamId);
        if (auth._tag === "Rejected") return auth;
        return { _tag: "Viewed", value: { teamId, rounds: [], dimensions: [], markers: [] } };
      }),
    history: () => Effect.succeed({ rounds: [] }),
  });

  readonly notes = OrganizationNotes.of({
    get: (organizationId, actorId, teamId, roundId) =>
      Effect.sync((): NoteViewed<RoundNoteView> => {
        const organization = this.organization(organizationId);
        const auth = authorizeRoundAction(organization.state, actorId, "team.viewNote", teamId);
        if (auth._tag === "Rejected") {
          return {
            _tag: "Rejected",
            rejection: { _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden" },
          };
        }
        if (organization.rounds.get(roundId) !== teamId) {
          return { _tag: "Rejected", rejection: { _tag: "RoundNotFound" } };
        }
        return { _tag: "Viewed", value: { roundId, note: organization.notes.get(roundId) ?? null } };
      }),
    save: (organizationId, actorId, teamId, roundId, text, now) =>
      Effect.sync((): NoteViewed<RoundNoteView> => {
        const organization = this.organization(organizationId);
        const auth = authorizeRoundAction(organization.state, actorId, "team.writeNote", teamId);
        if (auth._tag === "Rejected") {
          return {
            _tag: "Rejected",
            rejection: { _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden" },
          };
        }
        if (organization.rounds.get(roundId) !== teamId) {
          return { _tag: "Rejected", rejection: { _tag: "RoundNotFound" } };
        }
        const change = noteChange(text);
        if (change._tag === "Delete") {
          organization.notes.delete(roundId);
        } else {
          organization.notes.set(roundId, { roundId, text: change.text, updatedAt: now });
        }
        return { _tag: "Viewed", value: { roundId, note: organization.notes.get(roundId) ?? null } };
      }),
  });

  readonly actions = OrganizationActions.of({
    list: (organizationId, actorId, teamId) =>
      Effect.sync((): ActionViewed<ActionList> => {
        const organization = this.organization(organizationId);
        const auth = authorizeRoundAction(organization.state, actorId, "team.viewActions", teamId);
        if (auth._tag === "Rejected") {
          return {
            _tag: "Rejected",
            rejection: { _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden" },
          };
        }
        const team = organization.state.teams.find((t) => t.id === teamId);
        if (team === undefined) return { _tag: "Rejected", rejection: { _tag: "TeamNotFound" } };
        const all: Array<ActionItem> = [];
        for (const act of organization.actions.values()) {
          if (act.teamId === teamId) {
            const owner = organization.state.people.find((p) => p.id === act.ownerId);
            all.push({
              id: act.id,
              teamId: act.teamId,
              roundId: act.roundId,
              title: act.title,
              ownerId: act.ownerId,
              ownerEmail: owner?.email ?? EmailAddress.make("unknown@example.com"),
              dueDate: act.dueDate,
              dimension: act.dimension,
              status: act.status,
              createdAt: act.createdAt,
              updatedAt: act.updatedAt,
              doneAt: act.doneAt,
            });
          }
        }
        all.sort((a, b) => a.createdAt - b.createdAt);
        return { _tag: "Viewed", value: { teamId, actions: all } };
      }),
    create: (organizationId, actorId, teamId, payload, now) =>
      Effect.sync((): ActionViewed<ActionItem> => {
        const organization = this.organization(organizationId);
        const auth = authorizeRoundAction(organization.state, actorId, "team.createAction", teamId);
        if (auth._tag === "Rejected") {
          return {
            _tag: "Rejected",
            rejection: { _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden" },
          };
        }
        const team = organization.state.teams.find((t) => t.id === teamId);
        if (team === undefined) return { _tag: "Rejected", rejection: { _tag: "TeamNotFound" } };
        const isMember = organization.state.memberships.some(
          (m) => m.teamId === teamId && m.personId === payload.ownerId && m.endedAt === null,
        );
        if (!isMember) return { _tag: "Rejected", rejection: { _tag: "OwnerNotInTeam" } };
        const owner = organization.state.people.find((p) => p.id === payload.ownerId);
        const actionId = ActionId.make(`action-${organization.actions.size + 1}`);
        const record: ActionRecord = {
          id: actionId,
          teamId,
          roundId: payload.roundId,
          title: payload.title,
          ownerId: payload.ownerId,
          dueDate: payload.dueDate ?? null,
          dimension: payload.dimension ?? null,
          status: "committed",
          createdAt: now,
          updatedAt: now,
          doneAt: null,
        };
        organization.actions.set(actionId, record);
        return {
          _tag: "Viewed",
          value: {
            id: record.id,
            teamId: record.teamId,
            roundId: record.roundId,
            title: record.title,
            ownerId: record.ownerId,
            ownerEmail: owner?.email ?? EmailAddress.make("unknown@example.com"),
            dueDate: record.dueDate,
            dimension: record.dimension,
            status: record.status,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            doneAt: record.doneAt,
          },
        };
      }),
    update: (organizationId, actorId, teamId, actionId, payload, now) =>
      Effect.sync((): ActionViewed<ActionItem> => {
        const organization = this.organization(organizationId);
        const auth = authorizeRoundAction(organization.state, actorId, "team.updateAction", teamId);
        if (auth._tag === "Rejected") {
          return {
            _tag: "Rejected",
            rejection: { _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden" },
          };
        }
        const team = organization.state.teams.find((t) => t.id === teamId);
        if (team === undefined) return { _tag: "Rejected", rejection: { _tag: "TeamNotFound" } };
        const existing = organization.actions.get(actionId);
        if (existing === undefined || existing.teamId !== teamId) {
          return { _tag: "Rejected", rejection: { _tag: "ActionNotFound" } };
        }
        if (payload.ownerId !== undefined) {
          const isMember = organization.state.memberships.some(
            (m) => m.teamId === teamId && m.personId === payload.ownerId && m.endedAt === null,
          );
          if (!isMember) return { _tag: "Rejected", rejection: { _tag: "OwnerNotInTeam" } };
        }
        let newDoneAt: number | null = existing.doneAt;
        if (payload.status === "done" && existing.status !== "done") {
          newDoneAt = now;
        } else if (payload.status !== undefined && payload.status !== "done") {
          newDoneAt = null;
        }
        const updated: ActionRecord = {
          ...existing,
          title: payload.title ?? existing.title,
          ownerId: payload.ownerId ?? existing.ownerId,
          dueDate: payload.dueDate !== undefined ? payload.dueDate : existing.dueDate,
          dimension: payload.dimension !== undefined ? payload.dimension : existing.dimension,
          status: payload.status ?? existing.status,
          updatedAt: now,
          doneAt: newDoneAt,
        };
        organization.actions.set(actionId, updated);
        const owner = organization.state.people.find((p) => p.id === updated.ownerId);
        return {
          _tag: "Viewed",
          value: {
            id: updated.id,
            teamId: updated.teamId,
            roundId: updated.roundId,
            title: updated.title,
            ownerId: updated.ownerId,
            ownerEmail: owner?.email ?? EmailAddress.make("unknown@example.com"),
            dueDate: updated.dueDate,
            dimension: updated.dimension,
            status: updated.status,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
            doneAt: updated.doneAt,
          },
        };
      }),
  });

  person(organizationId: OrganizationId, personId: PersonId): PersonRecord | undefined {
    return this.organizations.get(organizationId)?.state.people.find((person) => person.id === personId);
  }

  /** Changes a Person directly, as a test arranging the object's state would. */
  update(organizationId: OrganizationId, personId: PersonId, patch: Partial<PersonRecord>) {
    const organization = this.organizations.get(organizationId);
    if (organization === undefined) throw new Error(`no Organization ${organizationId}`);
    organization.state = {
      ...organization.state,
      people: organization.state.people.map((person) =>
        person.id === personId ? { ...person, ...patch } : person,
      ),
    };
  }

  /** Marks a Person removed, without the follow-ups a real removal runs. */
  remove(organizationId: OrganizationId, personId: PersonId) {
    this.update(organizationId, personId, { removedAt: 1 });
  }
}

/** Sends handed to the email queue, in order. */
export class MemoryOutbox {
  readonly queued: Array<{ readonly organizationId: OrganizationId; readonly sendId: SendId }> = [];
  readonly service = EmailOutbox.of({
    queue: (organizationId, sendId) => Effect.sync(() => void this.queued.push({ organizationId, sendId })),
  });
}

/** Everything a sign-in or directory test talks to, plus helpers to set up Organizations a Lead already filled. */
export class SignInWorld {
  readonly workos = new FakeWorkos();
  readonly index = new MemoryIndex();
  readonly durable = new MemoryOrganizations();
  readonly outbox = new MemoryOutbox();
  private ids = 0;

  constructor(readonly allowlist = "") {}

  /** An Organization with its WorkOS organization, as creating it leaves it, with no People yet. */
  addOrganization(name: string): OrganizationSummary & { readonly workos: WorkosOrganizationId } {
    const id = OrganizationId.make(`organization-${++this.ids}`);
    const workos = WorkosOrganizationId.make(`org_existing_${this.ids}`);
    this.workos.organizations.set(id, { id: workos, name });
    this.index.organizations.set(id, { name, workos });
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
    return { id, name, workos };
  }

  /** A Round of a Team, as the Round lifecycle schedules it. The fake keeps no Pulses for Rounds, so tests seed them. */
  addRound(organizationId: OrganizationId, teamId: TeamId): RoundId {
    const roundId = RoundId.make(`round-${++this.ids}`);
    const organization = this.durable.organizations.get(organizationId);
    if (organization === undefined) throw new Error(`no Organization ${organizationId}`);
    organization.rounds.set(roundId, teamId);
    return roundId;
  }

  /** A Person a Lead added by email, not signed in yet. */
  addPerson(organizationId: OrganizationId, email: string, organizationAdmin = false): PersonId {
    const personId = PersonId.make(`person-${++this.ids}`);
    const organization = this.durable.organizations.get(organizationId);
    if (organization === undefined) throw new Error(`no Organization ${organizationId}`);
    const normalised = EmailAddress.make(normaliseEmail(email));
    organization.state = {
      ...organization.state,
      people: [
        ...organization.state.people,
        {
          id: personId,
          email: normalised,
          workosUserId: null,
          organizationAdmin,
          removedAt: null,
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
    });
    return personId;
  }

  readonly handler = (): ((request: Request) => Promise<Response>) => {
    const services = Context.make(IdentityProvider, this.workos.service).pipe(
      Context.add(PeopleIndex, this.index.service),
      Context.add(OrganizationPeople, this.durable.service),
      Context.add(OrganizationDirectory, this.durable.directory),
      Context.add(OrganizationPulses, this.durable.pulses),
      Context.add(OrganizationRounds, this.durable.rounds),
      Context.add(OrganizationActions, this.durable.actions),
      Context.add(OrganizationNotes, this.durable.notes),
      Context.add(EmailOutbox, this.outbox.service),
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
        ]),
        Layer.provide(HttpServer.layerServices),
      ),
    );
    return (request) => handler(request);
  };
}

export const ORIGIN = "https://pr-1.app.surveybeat.app";

/** A browser of one: keeps cookies between requests, never follows redirects. */
export class Browser {
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

  /** A same-origin JSON call, as the app makes it. */
  send = (method: string, path: string, body?: unknown, origin = ORIGIN) =>
    this.fetch(path, {
      method,
      headers: { origin, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  /** Status and parsed body (null for an empty one). */
  async call(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const response = await this.send(method, path, body);
    const text = await response.text();
    return { status: response.status, body: text === "" ? null : JSON.parse(text) };
  }

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
