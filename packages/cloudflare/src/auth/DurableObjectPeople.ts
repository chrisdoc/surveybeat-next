import {
  normaliseEmail,
  OrganizationActions,
  OrganizationDirectory,
  OrganizationNotes,
  OrganizationPeople,
  OrganizationPulses,
  OrganizationRounds,
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
            Option.map(Option.fromNullishOr(row), (person) => ({
              personId: PersonId.make(person.id),
              organizationAdmin: person.organizationAdmin,
              locale: person.locale,
              detectedLocale: person.detectedLocale,
              organizationLocale: person.organizationLocale,
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

/** `OrganizationRounds` on the same objects: the Round lifecycle engine and schedule table. */
export const durableObjectRounds = (organizations: Organizations) =>
  OrganizationRounds.of({
    run: (organizationId, actorId, command, now) =>
      organizations.getByName(organizationId).runRoundCommand(actorId, command, now),
    rounds: (organizationId, actorId, teamId, pulseId) =>
      organizations.getByName(organizationId).viewRounds(actorId, teamId, pulseId),
    round: (organizationId, actorId, teamId, roundId) =>
      organizations.getByName(organizationId).viewRound(actorId, teamId, roundId),
    results: (organizationId, actorId, teamId, roundId) =>
      organizations.getByName(organizationId).viewResults(actorId, teamId, roundId),
    overview: (organizationId, actorId, teamId) =>
      organizations.getByName(organizationId).viewTeamOverview(actorId, teamId),
    history: (organizationId, actorId) => organizations.getByName(organizationId).viewMemberHistory(actorId),
  });

/** `OrganizationActions` on the same objects: actions committed from Results. */
export const durableObjectActions = (organizations: Organizations) =>
  OrganizationActions.of({
    list: (organizationId, actorId, teamId) =>
      organizations.getByName(organizationId).listActions(actorId, teamId),
    create: (organizationId, actorId, teamId, payload, now) =>
      organizations.getByName(organizationId).createAction(actorId, teamId, payload, now),
    update: (organizationId, actorId, teamId, actionId, payload, now) =>
      organizations.getByName(organizationId).updateAction(actorId, teamId, actionId, payload, now),
  });

/** `OrganizationNotes` on the same objects: the Lead's Note on each Round. */
export const durableObjectNotes = (organizations: Organizations) =>
  OrganizationNotes.of({
    get: (organizationId, actorId, teamId, roundId) =>
      organizations.getByName(organizationId).viewRoundNote(actorId, teamId, roundId),
    save: (organizationId, actorId, teamId, roundId, text, now) =>
      organizations.getByName(organizationId).saveRoundNote(actorId, teamId, roundId, text, now),
  });
