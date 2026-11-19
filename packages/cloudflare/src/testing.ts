// @effect-diagnostics asyncFunction:off -- the vitest runner awaits a plain Promise here; the test never enters an Effect.
// @effect-diagnostics cryptoRandomUUIDInEffect:off -- the fake session id is a fixture value, not a token.

import { SurveyBeatApi } from "@surveybeat/api";
import {
  applyChanges,
  applyPulseChanges,
  emailStatusView,
  failedEmailsView,
  isEmailAdmin,
  isResendable,
  pending,
  progressOf,
  testSendView,
  decidePulse,
  decideTestSend,
  EMPTY_PULSE_STATE,
  emailLocaleOf,
  testSendsPerHour,
  OrganizationPulses,
  OrganizationRounds,
  PulseId,
  pulsesView,
  pulseView,
  QuestionId,
  AuthUnavailable,
  decide,
  DEFAULT_MINIMUM_GROUP_SIZE,
  EmailAddress,
  MembershipId,
  OrganizationDirectory,
  SendId,
  settingsView,
  TeamId,
  teamsView,
  teamView,
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
  Unauthenticated,
  AuthUserId,
  ActionId,
  OrganizationActions,
  authorizeRoundAction,
  OrganizationNotes,
  noteChange,
  RoundId,
} from "@surveybeat/domain";
import type {
  FailedEmail,
  FailureReason,
  ResendFacts,
  ResendResult,
  SendState,
  TestSendFound,
  TestSendResult,
  PulseCommandResult,
  PulseState,
  ClaimStatus,
  CommandResult,
  DirectoryState,
  PersonRecord,
  TransactionalEmail,
  OrganizationSummary,
  PersonCandidate,
  SignedInSession,
  ActionItem,
  ActionList,
  ActionRecord,
  ActionViewed,
  RoundViewed,
  TeamOverview,
  NoteViewed,
  RoundNote,
  RoundNoteView,
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
import { noteHandlers } from "./NoteHandlers.ts";
import { pulseHandlers } from "./PulseHandlers.ts";
import { roundHandlers } from "./RoundHandlers.ts";
import { authHandlers, SESSION_COOKIE } from "./auth/AuthHandlers.ts";

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
  readonly organizations = new Map<OrganizationId, { name: string }>();
  readonly persons = new Map<
    string,
    { organizationId: OrganizationId; personId: PersonId; email: string; userId: AuthUserId | null }
  >();
  readonly claims = new Map<AuthUserId, ClaimStatus>();

  private candidate(organizationId: OrganizationId, personId: PersonId, linked: boolean): PersonCandidate {
    const organization = this.organizations.get(organizationId);

    return { organization: { id: organizationId, name: organization?.name ?? "" }, personId, linked };
  }

  readonly service = PeopleIndex.of({
    linkedPersons: (userId) =>
      Effect.sync(() =>
        [...this.persons.values()].flatMap((person) =>
          person.userId === userId ? [this.candidate(person.organizationId, person.personId, true)] : [],
        ),
      ),
    unlinkedPersons: (email) =>
      Effect.sync(() =>
        [...this.persons.values()].flatMap((person) =>
          person.userId === null && person.email === normaliseEmail(email)
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
        });
      }),
    removePerson: (organizationId, personId) =>
      Effect.sync(() => {
        this.persons.delete(`${organizationId}/${personId}`);
      }),
    linkPerson: (organizationId, personId, userId) =>
      Effect.sync(() => {
        const person = this.persons.get(`${organizationId}/${personId}`);

        if (person !== undefined && person.userId === null) {
          person.userId = userId;
        }
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

interface MemoryOrganization {
  state: DirectoryState;
  pulses: PulseState;
  actions: Map<ActionId, ActionRecord>;
  rounds: Map<RoundId, TeamId>;
  notes: Map<RoundId, RoundNote>;
  readonly sends: Map<
    SendId,
    { readonly recipient: EmailAddress; readonly email: TransactionalEmail; readonly state: SendState }
  >;
  readonly testSends: Map<
    SendId,
    { readonly personId: PersonId; readonly pulseId: PulseId; readonly sentAt: number }
  >;
  readonly testSendTimes: Map<PersonId, readonly number[]>;
}

export class MemoryOrganizations {
  readonly organizations = new Map<OrganizationId, MemoryOrganization>();

  private organization(organizationId: OrganizationId): MemoryOrganization {
    const found = this.organizations.get(organizationId);

    if (found !== undefined) {
      return found;
    }

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
        if (this.organizations.has(organization.id)) {
          return;
        }

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
                authUserId: admin.userId,
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

        if (organization === undefined) {
          return false;
        }

        const { people } = organization.state;
        const person = people.find((each) => each.id === personId);

        if (person === undefined || person.removedAt !== null) {
          return false;
        }

        if (person.email !== normaliseEmail(email)) {
          return false;
        }

        if (people.some((other) => other.id !== personId && other.authUserId === userId)) {
          return false;
        }

        if (person.authUserId === null) {
          this.update(organizationId, personId, { authUserId: userId });
        }

        return this.person(organizationId, personId)?.authUserId === userId;
      }),
    activePerson: (organizationId, userId) =>
      Effect.sync(() => {
        const found = this.organization(organizationId).state.people.find(
          (person) => person.authUserId === userId && person.removedAt === null,
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

        if (organization === undefined) {
          return { _tag: "Rejected", rejection: { _tag: "Forbidden" } };
        }

        const decision = decide(organization.state, actorId, command, now);

        if (decision._tag === "Rejected") {
          return decision;
        }

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

        return { _tag: "Accepted", followUps: decision.followUps };
      }),
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

        const failed = [...organization.sends]
          .flatMap(([sendId, send]): readonly FailedEmail[] => {
            if (send.state._tag !== "Failed") {
              return [];
            }

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

        if (!isEmailAdmin(organization.state, actorId)) {
          return { _tag: "Rejected", rejection: { _tag: "Forbidden" } };
        }

        const send = organization.sends.get(sendId);

        if (send === undefined) {
          return { _tag: "Rejected", rejection: { _tag: "FailedEmailNotFound" } };
        }

        if (send.state._tag !== "Failed") {
          return {
            _tag: "Accepted",
            status: { sendId, state: progressOf(send.state) },
          };
        }

        const facts = fakeResendFacts(organization, sendId, send.email, send.state.reason);

        if (!isResendable(sendId, facts)) {
          return { _tag: "Rejected", rejection: { _tag: "EmailNotResendable" } };
        }

        organization.sends.set(sendId, { ...send, state: pending });

        return { _tag: "Accepted", status: { sendId, state: progressOf(pending) } };
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

  readonly pulses = OrganizationPulses.of({
    run: (organizationId, actorId, command, now) =>
      Effect.sync((): PulseCommandResult => {
        const organization = this.organizations.get(organizationId);

        if (organization === undefined) {
          return { _tag: "Rejected", rejection: { _tag: "Forbidden" } };
        }

        const decision = decidePulse(organization.state, organization.pulses, actorId, command, now);

        if (decision._tag === "Rejected") {
          return decision;
        }

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

        const found: TestSendFound | null =
          test === undefined ? null : { ...test, state: send?.state ?? pending };

        return testSendView(organization.state, actorId, teamId, pulseId, found, now);
      }),
    sendTest: (organizationId, actorId, teamId, pulseId, now) =>
      Effect.sync((): TestSendResult => {
        const organization = this.organization(organizationId);
        const decision = decideTestSend(organization.state, organization.pulses, actorId, teamId, pulseId);

        if (decision._tag === "Rejected") {
          return decision;
        }

        const { person, pulse } = decision;
        const recent = (organization.testSendTimes.get(actorId) ?? []).filter((at) => at > now - 3_600_000);

        if (recent.length >= testSendsPerHour) {
          return { _tag: "Rejected", rejection: { _tag: "TestSendLimitReached", perHour: testSendsPerHour } };
        }

        organization.testSendTimes.set(actorId, [...recent, now]);
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

        if (auth._tag === "Rejected") {
          return auth;
        }

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

        if (team === undefined) {
          return { _tag: "Rejected", rejection: { _tag: "TeamNotFound" } };
        }

        const all: ActionItem[] = [];

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

        if (team === undefined) {
          return { _tag: "Rejected", rejection: { _tag: "TeamNotFound" } };
        }

        const isMember = organization.state.memberships.some(
          (m) => m.teamId === teamId && m.personId === payload.ownerId && m.endedAt === null,
        );

        if (!isMember) {
          return { _tag: "Rejected", rejection: { _tag: "OwnerNotInTeam" } };
        }

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

        if (team === undefined) {
          return { _tag: "Rejected", rejection: { _tag: "TeamNotFound" } };
        }

        const existing = organization.actions.get(actionId);

        if (existing === undefined || existing.teamId !== teamId) {
          return { _tag: "Rejected", rejection: { _tag: "ActionNotFound" } };
        }

        if (payload.ownerId !== undefined) {
          const isMember = organization.state.memberships.some(
            (m) => m.teamId === teamId && m.personId === payload.ownerId && m.endedAt === null,
          );

          if (!isMember) {
            return { _tag: "Rejected", rejection: { _tag: "OwnerNotInTeam" } };
          }
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

  update(organizationId: OrganizationId, personId: PersonId, patch: Partial<PersonRecord>) {
    const organization = this.organizations.get(organizationId);

    if (organization === undefined) {
      throw new Error(`no Organization ${organizationId}`);
    }

    organization.state = {
      ...organization.state,
      people: organization.state.people.map((person) =>
        person.id === personId ? { ...person, ...patch } : person,
      ),
    };
  }

  remove(organizationId: OrganizationId, personId: PersonId) {
    this.update(organizationId, personId, { removedAt: 1 });
  }
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
    const services = Context.make(SessionIdentityProvider, this.sessions.service).pipe(
      Context.add(PeopleIndex, this.index.service),
      Context.add(OrganizationPeople, this.durable.service),
      Context.add(OrganizationDirectory, this.durable.directory),
      Context.add(OrganizationPulses, this.durable.pulses),
      Context.add(OrganizationRounds, this.durable.rounds),
      Context.add(OrganizationActions, this.durable.actions),
      Context.add(OrganizationNotes, this.durable.notes),
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
