import { Schema } from "effect";
import { EmailAddress } from "../email/Email.ts";
import { Policy } from "../Policy.ts";
import { PersonId } from "./Identity.ts";
import { Locale } from "./Locale.ts";

export const TeamId = Schema.String.pipe(Schema.brand("TeamId"));

export type TeamId = typeof TeamId.Type;

export const MembershipId = Schema.String.pipe(Schema.brand("MembershipId"));

export type MembershipId = typeof MembershipId.Type;

export const TeamName = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(100)),
);

const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

export const isTimeZone = (name: string): boolean => {
  if (!IANA_SHAPE.test(name)) {
    return false;
  }

  try {
    Intl.DateTimeFormat("en", { timeZone: name });

    return true;
  } catch {
    return false;
  }
};

export const TimeZone = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isTimeZone, { expected: "an IANA time zone name" })),
  Schema.brand("TimeZone"),
);

export type TimeZone = typeof TimeZone.Type;

export const MembershipRole = Schema.Literals(["lead", "member", "viewer"]);

export type MembershipRole = typeof MembershipRole.Type;

export const AssignableRole = Schema.Literals(["lead", "member"]);

export type AssignableRole = typeof AssignableRole.Type;

export const MinimumGroupSize = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(Policy.groupSize.minimum),
    Schema.isLessThanOrEqualTo(Policy.groupSize.maximum),
  ),
);

export const DEFAULT_MINIMUM_GROUP_SIZE = Policy.groupSize.defaultValue;

export const TeamSummary = Schema.Struct({
  id: TeamId,
  name: Schema.String,
  timeZone: TimeZone,
  yourRole: Schema.NullOr(MembershipRole),

  memberCount: Schema.optional(Schema.Int),

  nextRoundDate: Schema.optional(Schema.NullOr(Schema.String)),
});

export type TeamSummary = typeof TeamSummary.Type;

export const RosterEntry = Schema.Struct({
  personId: PersonId,
  email: EmailAddress,
  role: MembershipRole,
  since: Schema.Int,
});

export type RosterEntry = typeof RosterEntry.Type;

export const TeamAbilities = Schema.Struct({
  update: Schema.Boolean,
  manageLeads: Schema.Boolean,
  manageMembers: Schema.Boolean,
  managePulses: Schema.Boolean,
  viewResults: Schema.Boolean,
});

export type TeamAbilities = typeof TeamAbilities.Type;

export const TeamDetail = Schema.Struct({
  team: TeamSummary,
  roster: Schema.Array(RosterEntry),
  may: TeamAbilities,
});

export type TeamDetail = typeof TeamDetail.Type;

export const PersonSummary = Schema.Struct({
  personId: PersonId,
  email: EmailAddress,
  organizationAdmin: Schema.Boolean,

  linked: Schema.Boolean,
});

export type PersonSummary = typeof PersonSummary.Type;

export const OrganizationSettings = Schema.Struct({
  name: Schema.String,
  minimumGroupSize: MinimumGroupSize,
  aiProcessing: Schema.Boolean,
  defaultLocale: Locale,
  people: Schema.Array(PersonSummary),
});

export type OrganizationSettings = typeof OrganizationSettings.Type;

export class TeamNotFound extends Schema.TaggedError<TeamNotFound, { readonly brand: unique symbol }>()(
  "TeamNotFound",
  {},
  { httpApiStatus: 404 },
) {}

export class PersonNotFound extends Schema.TaggedError<PersonNotFound, { readonly brand: unique symbol }>()(
  "PersonNotFound",
  {},
  { httpApiStatus: 404 },
) {}

export class LastLead extends Schema.TaggedError<LastLead, { readonly brand: unique symbol }>()(
  "LastLead",
  { teamId: TeamId },
  { httpApiStatus: 409 },
) {}

export class LastAdmin extends Schema.TaggedError<LastAdmin, { readonly brand: unique symbol }>()(
  "LastAdmin",
  {},
  { httpApiStatus: 409 },
) {}

export class TeamNameTaken extends Schema.TaggedError<TeamNameTaken, { readonly brand: unique symbol }>()(
  "TeamNameTaken",
  {},
  { httpApiStatus: 409 },
) {}

export class PersonWasRemoved extends Schema.TaggedError<
  PersonWasRemoved,
  { readonly brand: unique symbol }
>()("PersonWasRemoved", {}, { httpApiStatus: 403 }) {}
