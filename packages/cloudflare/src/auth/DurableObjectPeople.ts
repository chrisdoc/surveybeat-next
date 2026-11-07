import {
  normaliseEmail,
  OrganizationDirectory,
  OrganizationPeople,
  OrganizationPulses,
  PersonId,
} from "@surveybeat/domain";
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
          Effect.map((row) =>
            Option.map(Option.fromNullishOr(row), ({ id, organizationAdmin }) => ({
              personId: PersonId.make(id),
              organizationAdmin,
            })),
          ),
        ),
  });

/** `OrganizationDirectory` on the same objects: each decides and commits its own changes. */
export const durableObjectDirectory = (organizations: Organizations) =>
  OrganizationDirectory.of({
    run: (organizationId, actorId, command, now) =>
      organizations.getByName(organizationId).runDirectoryCommand(actorId, command, now),
    teams: (organizationId, actorId) => organizations.getByName(organizationId).viewTeams(actorId),
    team: (organizationId, actorId, teamId) =>
      organizations.getByName(organizationId).viewTeam(actorId, teamId),
    settings: (organizationId, actorId) => organizations.getByName(organizationId).viewSettings(actorId),
  });

/** `OrganizationPulses` on the same objects: the question library and Pulses live with the directory. */
export const durableObjectPulses = (organizations: Organizations) =>
  OrganizationPulses.of({
    run: (organizationId, actorId, command, now) =>
      organizations.getByName(organizationId).runPulseCommand(actorId, command, now),
    pulses: (organizationId, actorId, teamId) =>
      organizations.getByName(organizationId).viewPulses(actorId, teamId),
    pulse: (organizationId, actorId, teamId, pulseId) =>
      organizations.getByName(organizationId).viewPulse(actorId, teamId, pulseId),
  });
