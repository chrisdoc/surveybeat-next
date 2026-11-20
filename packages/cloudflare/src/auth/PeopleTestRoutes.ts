import type * as Cloudflare from "@alchemy.run/cloudflare";
import {
  EmailAddress,
  identityOf,
  MembershipId,
  OrganizationCreationAllowlist,
  OrganizationDirectory,
  OrganizationId,
  OrganizationPeople,
  PeopleIndex,
  PersonId,
  runDirectoryCommand,
  SendId,
  SessionId,
  SessionIdentityProvider,
  sessionState,
  TeamId,
  TimeZone,
  AuthUserId,
  Unauthenticated,
} from "@surveybeat/domain";
import type { CheckedSession, SignedInSession, Member } from "@surveybeat/domain";
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

export const peopleTestRoutes = (organizations: Organizations, database: Cloudflare.D1.QueryDatabaseClient) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const run = new URL(request.url, "http://localhost").searchParams.get("run") ?? "";
    const people = durableObjectPeople(organizations);
    const index = yield* d1PeopleIndex(database);
    const organization = { id: OrganizationId.make(`people-${run}`), name: "Acme" };
    const admin = PersonId.make(`admin-${run}`);
    const adminUser = AuthUserId.make(`user_admin_${run}`);
    const eve = AuthUserId.make(`user_eve_${run}`);
    const ada = AuthUserId.make(`user_ada_${run}`);
    const email = EmailAddress.make("Admin@Example.com");

    yield* people.createWithAdmin(organization, { personId: admin, email, userId: adminUser });
    yield* people.createWithAdmin(organization, { personId: admin, email, userId: adminUser });
    yield* index.putOrganization(organization);

    const creator = {
      adminActive: yield* people.activePerson(organization.id, adminUser),
      eveActiveBeforeAdded: yield* people.activePerson(organization.id, eve),
      relinkSameUser: yield* people.linkPerson(organization.id, admin, adminUser, email),
      takeOverByOtherUser: yield* people.linkPerson(organization.id, admin, eve, email),
      linkMissingPerson: yield* people.linkPerson(organization.id, PersonId.make("nobody"), eve, email),
    };

    const chosen = new Map<SessionId, OrganizationId>();

    const sessionOf = (userId: AuthUserId, address: string): SignedInSession => ({
      identity: identityOf(userId, address, true),
      sessionId: SessionId.make(`session-${userId}`),
    });

    const sessions = SessionIdentityProvider.of({
      authenticate: (cookie) =>
        Effect.suspend(() => {
          const userId = cookie.pipe(Redacted.value, (value) => value.replace(/^cookie-/, ""));

          return userId.length === 0
            ? Effect.fail(new Unauthenticated())
            : Effect.succeed(
                sessionOf(AuthUserId.make(userId), userId === eve ? "eve@example.com" : "ada@example.com"),
              );
        }),
      sendSignInCode: () => Effect.void,
      verifySignInCode: () => Effect.succeedNone,
      requestEmailChange: () => Effect.void,
      confirmEmailChange: () => Effect.succeedNone,
      chosenOrganization: (sessionId) => Effect.sync(() => Option.fromNullishOr(chosen.get(sessionId))),
      chooseOrganization: (sessionId, organizationId) =>
        Effect.sync(() => {
          chosen.set(sessionId, organizationId);
        }),
      revokeSession: (sessionId) =>
        Effect.sync(() => {
          chosen.delete(sessionId);
        }),
    });

    const services = Context.make(SessionIdentityProvider, sessions).pipe(
      Context.add(PeopleIndex, index),
      Context.add(OrganizationPeople, people),
      Context.add(OrganizationDirectory, durableObjectDirectory(organizations)),
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

    const signIn = (userId: AuthUserId, address: string) =>
      sessionState(
        {
          session: sessionOf(userId, address),
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

      const roster =
        view._tag === "Viewed"
          ? view.value.roster.map(({ personId, email, role }) => ({ personId, email, role }))
          : view;

      return { unlinked, eveSignIn, adaSignIn, linked, removed, roster };
    }).pipe(Effect.provideContext(services));

    const result = yield* flow;

    const sendsCreated = yield* Effect.forEach(
      [`added-membership-1-${run}`, `added-membership-2-${run}`],
      (sendId) =>
        organizations
          .getByName(organization.id)
          .getEmailSend(SendId.make(sendId))
          .pipe(Effect.map((record) => record !== null)),
    );

    return yield* HttpServerResponse.json({ ...creator, ...result, sendsCreated });
  }).pipe(Effect.orDie);
