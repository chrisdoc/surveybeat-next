import { EmailAddress, OrganizationId, PersonId, WorkosUserId } from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { Organizations } from "../EmailDelivery.ts";
import { durableObjectPeople } from "./DurableObjectPeople.ts";

export const PEOPLE_TEST_ROUTE = "/__test/people";

/**
 * Test stages only (`isTestStage`): runs the Person rules against a real Organization Durable
 * Object and reports each answer, for `Organization.test.ts` on local workerd. Linking an unlinked
 * Person is covered once slice 04 can add one; here the creator is the only Person.
 */
export const peopleTestRoutes = (organizations: Organizations) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const run = new URL(request.url, "http://localhost").searchParams.get("run") ?? "";
    const people = durableObjectPeople(organizations);
    const organization = { id: OrganizationId.make(`people-${run}`), name: "Acme" };
    const admin = PersonId.make(`admin-${run}`);
    const ada = WorkosUserId.make(`user_ada_${run}`);
    const eve = WorkosUserId.make(`user_eve_${run}`);
    const email = EmailAddress.make("Ada@Example.com");

    yield* people.createWithAdmin(organization, { personId: admin, email, userId: ada });
    yield* people.createWithAdmin(organization, { personId: admin, email, userId: ada });
    return yield* HttpServerResponse.json({
      adaActive: yield* people.activePerson(organization.id, ada),
      eveActive: yield* people.activePerson(organization.id, eve),
      relinkSameUser: yield* people.linkPerson(organization.id, admin, ada, email),
      takeOverByOtherUser: yield* people.linkPerson(organization.id, admin, eve, email),
      linkMissingPerson: yield* people.linkPerson(organization.id, PersonId.make("nobody"), eve, email),
    });
  }).pipe(Effect.orDie);
