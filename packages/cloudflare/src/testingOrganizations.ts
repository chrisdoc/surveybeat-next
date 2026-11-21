// @effect-diagnostics cryptoRandomUUIDInEffect:off -- the fake session id is a fixture value, not a token.

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
  pulsesView,
  pulseView,
  decide,
  DEFAULT_MINIMUM_GROUP_SIZE,
  EmailAddress,
  offboardingAccess,
  offboardingConfirmation,
  offboardingExportOf,
  SendId,
  settingsView,
  teamsView,
  teamView,
  normaliseEmail,
  OrganizationDirectory,
  OrganizationPeople,
  ActionId,
  OrganizationActions,
  authorizeRoundAction,
  OrganizationNotes,
  noteChange,
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
  CommandResult,
  DirectoryState,
  PersonRecord,
  TransactionalEmail,
  ActionItem,
  ActionList,
  ActionRecord,
  ActionViewed,
  RoundViewed,
  TeamOverview,
  NoteViewed,
  RoundNote,
  RoundNoteView,
  OrganizationId,
  PersonId,
  PulseId,
  RoundId,
  TeamId,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

const ownerEmailOf = (owner: PersonRecord | undefined): EmailAddress | null => {
  if (owner === undefined) {
    return EmailAddress.make("unknown@example.com");
  }

  return owner.erasedAt === null ? owner.email : null;
};

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

export interface MemoryOrganization {
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
                erasedAt: null,
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
      Effect.suspend(() => {
        if (!this.organizations.has(organizationId)) {
          return Effect.die(new Error("no such table: person"));
        }

        const found = this.organization(organizationId).state.people.find(
          (person) => person.authUserId === userId && person.removedAt === null,
        );

        const organizationLocale = this.organization(organizationId).state.defaultLocale;

        return Effect.succeed(
          Option.map(Option.fromNullishOr(found), (person) => ({
            personId: person.id,
            organizationAdmin: person.organizationAdmin,
            locale: person.locale,
            detectedLocale: person.detectedLocale,
            organizationLocale,
          })),
        );
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

        for (const followUp of decision.followUps) {
          if (followUp._tag !== "ErasePersonIndex") {
            continue;
          }

          for (const [sendId, send] of organization.sends) {
            if (send.recipient === followUp.person.email) {
              organization.sends.delete(sendId);
            }
          }

          for (const [sendId, testSend] of organization.testSends) {
            if (testSend.personId === followUp.person.id) {
              organization.testSends.delete(sendId);
            }
          }
        }

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
    rectifyEmail: (organizationId, userId, email) =>
      Effect.sync(() => {
        const organization = this.organizations.get(organizationId);

        if (organization !== undefined) {
          organization.state = {
            ...organization.state,
            people: organization.state.people.map((person) =>
              person.authUserId === userId && person.erasedAt === null ? { ...person, email } : person,
            ),
          };
        }
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
    offboardingExport: (organizationId, actorId, now) =>
      Effect.sync(() => {
        const organization = this.organization(organizationId);
        const access = offboardingAccess(organization.state, actorId);

        return access._tag === "Rejected"
          ? access
          : {
              _tag: "Viewed" as const,
              value: offboardingExportOf({
                organizationId,
                state: organization.state,
                timeZones: new Map(),
                pulses: organization.pulses,
                now,
              }),
            };
      }),
    confirmOffboarding: (organizationId, actorId, confirmation) =>
      Effect.sync(() =>
        offboardingConfirmation(this.organization(organizationId).state, actorId, confirmation),
      ),
    clearPersonErasure: () => Effect.void,
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
              ownerEmail: ownerEmailOf(owner),
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
            ownerEmail: ownerEmailOf(owner),
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
            ownerEmail: ownerEmailOf(owner),
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
