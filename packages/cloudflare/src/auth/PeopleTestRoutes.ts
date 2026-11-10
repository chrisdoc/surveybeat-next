import type * as Cloudflare from "@alchemy.run/cloudflare";
import {
  type CheckedSession,
  EmailAddress,
  EmailOutbox,
  identityOf,
  IdentityProvider,
  MembershipId,
  OrganizationCreationAllowlist,
  OrganizationDirectory,
  OrganizationId,
  OrganizationPeople,
  PeopleIndex,
  PersonId,
  type ProviderSession,
  runDirectoryCommand,
  SessionId,
  sessionState,
  TeamId,
  TimeZone,
  WorkosOrganizationId,
  WorkosUserId,
  type Member,
} from "@surveybeat/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { Organizations } from "../EmailDelivery.ts";
import { d1PeopleIndex } from "./D1PeopleIndex.ts";
import { durableObjectDirectory, durableObjectPeople } from "./DurableObjectPeople.ts";

export const PEOPLE_TEST_ROUTE = "/__test/people";

/**
 * Test stages only (`isTestStage`): runs the Person rules against a real Organization Durable
 * Object and the stage's D1 index, for `Organization.test.ts` on local workerd. Only WorkOS is a
 * stand-in, which records the membership calls it gets: an admin adds Eve and Ada by email, both
 * sign in with that verified email and are linked, then Ada is removed.
 */
export const peopleTestRoutes = (organizations: Organizations, database: Cloudflare.D1.QueryDatabaseClient) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const run = new URL(request.url, "http://localhost").searchParams.get("run") ?? "";
    const people = durableObjectPeople(organizations);
    const index = yield* d1PeopleIndex(database);
    const organization = { id: OrganizationId.make(`people-${run}`), name: "Acme" };
    const workosOrganization = WorkosOrganizationId.make(`org_${run}`);
    const admin = PersonId.make(`admin-${run}`);
    const adminUser = WorkosUserId.make(`user_admin_${run}`);
    const eve = WorkosUserId.make(`user_eve_${run}`);
    const ada = WorkosUserId.make(`user_ada_${run}`);
    const email = EmailAddress.make("Admin@Example.com");

    // Slice 03's checks: the creator is active, idempotently, and cannot be taken over.
    yield* people.createWithAdmin(organization, { personId: admin, email, userId: adminUser });
    yield* people.createWithAdmin(organization, { personId: admin, email, userId: adminUser });
    yield* index.putOrganization(organization, Option.some(workosOrganization));
    const creator = {
      adminActive: yield* people.activePerson(organization.id, adminUser),
      eveActiveBeforeAdded: yield* people.activePerson(organization.id, eve),
      relinkSameUser: yield* people.linkPerson(organization.id, admin, adminUser, email),
      takeOverByOtherUser: yield* people.linkPerson(organization.id, admin, eve, email),
      linkMissingPerson: yield* people.linkPerson(organization.id, PersonId.make("nobody"), eve, email),
    };

    const workosCalls: Array<string> = [];
    const sessionOf = (userId: WorkosUserId, address: string, workos: Option.Option<WorkosOrganizationId>) =>
      ({
        sealed: Redacted.make(`sealed-${userId}`),
        sessionId: SessionId.make(`session-${userId}`),
        identity: identityOf(userId, address, true),
        workosOrganizationId: workos,
        role: Option.none(),
      }) satisfies ProviderSession;
    const identityProvider = IdentityProvider.of({
      authorizationUrl: () => "",
      authenticateWithCode: () => Effect.die("not used"),
      authenticateWithOrganizationSelection: () => Effect.die("not used"),
      authenticate: () => Effect.die("not used"),
      refresh: (sealed, workos) =>
        Effect.sync(() => {
          const userId = WorkosUserId.make(Redacted.value(sealed).replace(/^sealed-/, ""));
          return sessionOf(userId, userId === eve ? "eve@example.com" : "ada@example.com", workos);
        }),
      logoutUrl: () => "",
      revokeSession: () => Effect.void,
      createOrganization: () => Effect.die("not used"),
      ensureMembership: (userId, _organization, role) =>
        Effect.sync(() => void workosCalls.push(`ensure ${userId} ${role}`)),
      setMembershipRole: (userId, _organization, role) =>
        Effect.sync(() => void workosCalls.push(`role ${userId} ${role}`)),
      deactivateMembership: (userId) => Effect.sync(() => void workosCalls.push(`deactivate ${userId}`)),
    });
    const queued: Array<string> = [];
    const services = Context.make(IdentityProvider, identityProvider).pipe(
      Context.add(PeopleIndex, index),
      Context.add(OrganizationPeople, people),
      Context.add(OrganizationDirectory, durableObjectDirectory(organizations)),
      Context.add(
        EmailOutbox,
        EmailOutbox.of({ queue: (_id, sendId) => Effect.sync(() => void queued.push(sendId)) }),
      ),
    );
    const member: Member = {
      organization,
      personId: admin,
      organizationAdmin: true,
      locale: null,
      detectedLocale: null,
      organizationLocale: "en",
    };
    const newMember = (address: string, n: number) => ({
      email: EmailAddress.make(address),
      personId: PersonId.make(`added-${n}-${run}`),
      membershipId: MembershipId.make(`membership-${n}-${run}`),
      signInUrl: "https://app.surveybeat.app/",
    });
    const teamId = TeamId.make(`team-${run}`);

    /** First sign-in with no Organization in the session, as `GET /auth/session` runs it. */
    const signIn = (userId: WorkosUserId, address: string) =>
      sessionState(
        {
          session: sessionOf(userId, address, Option.none()),
          member: Option.none(),
        } satisfies CheckedSession,
        new OrganizationCreationAllowlist(""),
      ).pipe(Effect.map((outcome) => outcome.state));

    const flow = Effect.gen(function* () {
      yield* runDirectoryCommand(member, {
        _tag: "CreateTeam",
        teamId,
        name: "Platform",
        timeZone: TimeZone.make("Europe/Berlin"),
        lead: newMember("Eve@Example.com", 1),
      });
      yield* runDirectoryCommand(member, {
        _tag: "AddMember",
        teamId,
        role: "member",
        member: newMember("ada@example.com", 2),
      });
      const unlinked = yield* index.unlinkedPersons(EmailAddress.make("eve@example.com"));
      const eveSignIn = yield* signIn(eve, "eve@example.com");
      const adaSignIn = yield* signIn(ada, "ada@example.com");
      const linked = {
        eveActive: yield* people.activePerson(organization.id, eve),
        eveIndexed: yield* index.linkedPersons(eve),
        eveUnlinkedAfter: yield* index.unlinkedPersons(EmailAddress.make("eve@example.com")),
      };

      yield* runDirectoryCommand(member, { _tag: "RemovePerson", personId: PersonId.make(`added-2-${run}`) });
      const removed = {
        adaActive: yield* people.activePerson(organization.id, ada),
        adaIndexed: yield* index.linkedPersons(ada),
        adaSignInAgain: yield* signIn(ada, "ada@example.com"),
      };
      const view = yield* (yield* OrganizationDirectory).team(organization.id, admin, teamId);
      // Start times vary by run; who is in the Team in which role does not.
      const roster =
        view._tag === "Viewed"
          ? view.value.roster.map(({ personId, email, role }) => ({ personId, email, role }))
          : view;
      return { unlinked, eveSignIn, adaSignIn, linked, removed, roster };
    }).pipe(Effect.provideContext(services));

    const result = yield* flow;
    return yield* HttpServerResponse.json({ ...creator, ...result, workosCalls, queued });
  }).pipe(Effect.orDie);
