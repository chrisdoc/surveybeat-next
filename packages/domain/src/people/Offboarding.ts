import { Context, DateTime, Schema } from "effect";
import type { Effect, Option } from "effect";
import { EmailAddress } from "../email/Email.ts";
import type { PulseState } from "../pulses/Editor.ts";
import { PulseId, PulseSettings } from "../pulses/Pulse.ts";
import { Dimension, QuestionId, QuestionText, QuestionType } from "../pulses/Question.ts";
import { PersonId } from "./Identity.ts";
import type { AuthUserId } from "./Identity.ts";
import type { DirectoryState } from "./Directory.ts";
import { Locale } from "./Locale.ts";
import { OrganizationId } from "./Organization.ts";
import { isoTimestamp } from "./PersonalData.ts";
import { MembershipId, MembershipRole, MinimumGroupSize, TeamId, TimeZone } from "./Team.ts";

export const OFFBOARDING_EXPORT_SCHEMA_VERSION = 1;

export const OFFBOARDING_EXPORT_FILENAME = "surveybeat-organization.json";

const Timestamp = Schema.NullOr(Schema.String);

export const OffboardedOrganization = Schema.Struct({
  id: OrganizationId,
  name: Schema.String,
  minimumGroupSize: MinimumGroupSize,
  aiProcessing: Schema.Boolean,
  defaultLocale: Locale,
});

export const OffboardedTeam = Schema.Struct({
  id: TeamId,
  name: Schema.String,
  timeZone: TimeZone,
});

export const OffboardedPerson = Schema.Struct({
  id: PersonId,
  email: EmailAddress,
  organizationAdmin: Schema.Boolean,
  locale: Schema.NullOr(Locale),
  timeZone: Schema.NullOr(Schema.String),
  removedAt: Timestamp,
  erasedAt: Timestamp,
});

export const OffboardedMembership = Schema.Struct({
  id: MembershipId,
  teamId: TeamId,
  personId: PersonId,
  role: MembershipRole,
  startedAt: Timestamp,
  endedAt: Timestamp,
});

export const OffboardedQuestion = Schema.Struct({
  id: QuestionId,
  text: QuestionText,
  type: QuestionType,
  dimension: Schema.NullOr(Dimension),
});

export const OffboardedPulse = Schema.Struct({
  id: PulseId,
  teamId: TeamId,
  ...PulseSettings.fields,
  questions: Schema.Array(OffboardedQuestion),
});

export const OrganizationOffboardingExport = Schema.Struct({
  schemaVersion: Schema.Literal(OFFBOARDING_EXPORT_SCHEMA_VERSION),
  exportedAt: Schema.String,
  organization: OffboardedOrganization,
  teams: Schema.Array(OffboardedTeam),
  people: Schema.Array(OffboardedPerson),
  memberships: Schema.Array(OffboardedMembership),
  pulses: Schema.Array(OffboardedPulse),
});

export type OrganizationOffboardingExport = typeof OrganizationOffboardingExport.Type;

export const offboardingExportOf = (parts: {
  readonly organizationId: OrganizationId;
  readonly state: DirectoryState;
  readonly timeZones: ReadonlyMap<PersonId, string | null>;
  readonly pulses: PulseState;
  readonly now: number;
}): OrganizationOffboardingExport => {
  const { state } = parts;
  const versions = new Map(parts.pulses.versions.map((version) => [version.id, version]));

  return {
    schemaVersion: OFFBOARDING_EXPORT_SCHEMA_VERSION,
    exportedAt: DateTime.formatIso(DateTime.makeUnsafe(parts.now)),
    organization: {
      id: parts.organizationId,
      name: state.organizationName,
      minimumGroupSize: state.minimumGroupSize,
      aiProcessing: state.aiProcessing,
      defaultLocale: state.defaultLocale,
    },
    teams: state.teams.map((team) => ({ id: team.id, name: team.name, timeZone: team.timeZone })),
    people: state.people.map((person) => ({
      id: person.id,
      email: person.email,
      organizationAdmin: person.organizationAdmin,
      locale: person.locale,
      timeZone: parts.timeZones.get(person.id) ?? null,
      removedAt: isoTimestamp(person.removedAt),
      erasedAt: isoTimestamp(person.erasedAt),
    })),
    memberships: state.memberships.map((membership) => ({
      id: membership.id,
      teamId: membership.teamId,
      personId: membership.personId,
      role: membership.role,
      startedAt: isoTimestamp(membership.startedAt),
      endedAt: isoTimestamp(membership.endedAt),
    })),
    pulses: parts.pulses.pulses.map((pulse) => ({
      id: pulse.id,
      teamId: pulse.teamId,
      ...pulse.settings,
      questions: pulse.questions.flatMap((versionId) => {
        const version = versions.get(versionId);

        return version === undefined
          ? []
          : [
              {
                id: version.questionId,
                text: version.content.text,
                type: version.content.type,
                dimension: version.content.dimension,
              },
            ];
      }),
    })),
  };
};

export interface OrganizationOffboardingShape {
  readonly begin: (organizationId: OrganizationId, userId: AuthUserId, now: number) => Effect.Effect<boolean>;

  readonly pending: (userId: AuthUserId) => Effect.Effect<Option.Option<OrganizationId>>;

  readonly revokeAccess: (organizationId: OrganizationId) => Effect.Effect<void>;

  readonly wipe: (organizationId: OrganizationId) => Effect.Effect<void>;

  readonly removeIndex: (organizationId: OrganizationId) => Effect.Effect<readonly AuthUserId[]>;
}

export class OrganizationOffboarding extends Context.Service<
  OrganizationOffboarding,
  OrganizationOffboardingShape
>()("@surveybeat/domain/OrganizationOffboarding") {}
