import { normaliseEmail, OrganizationPeople, PersonId } from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { Organizations } from "../EmailDelivery.ts";

/** `OrganizationPeople` on the Organization Durable Objects: one object per Organization (ADR 0006). */
export const durableObjectPeople = (organizations: Organizations) =>
  OrganizationPeople.of({
    createWithAdmin: (organization, admin) =>
      organizations
        .getByName(organization.id)
        .createWithAdmin(
          organization.id,
          organization.name,
          admin.personId,
          normaliseEmail(admin.email),
          admin.userId,
        ),
    linkPerson: (organizationId, personId, userId, email) =>
      organizations.getByName(organizationId).linkPerson(personId, userId, normaliseEmail(email)),
    activePerson: (organizationId, userId) =>
      organizations
        .getByName(organizationId)
        .activePerson(userId)
        .pipe(
          Effect.map((id) => Option.map(Option.fromNullishOr(id), (personId) => PersonId.make(personId))),
        ),
  });
