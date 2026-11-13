import { Schema } from "effect";
import { EmailAddress } from "../email/Email.ts";
import { PersonId } from "./Identity.ts";
import { Locale } from "./Locale.ts";

/** A Team within one Organization. Teams do not nest in Release 1: a Team has no parent. */
export const TeamId = Schema.String.pipe(Schema.brand("TeamId"));
export type TeamId = typeof TeamId.Type;

/** One Membership: a Person's role in one Team over a date range. */
export const MembershipId = Schema.String.pipe(Schema.brand("MembershipId"));
export type MembershipId = typeof MembershipId.Type;

/** A Team's name: trimmed, 1 to 100 characters, unique within its Organization (ignoring case). */
export const TeamName = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(100)),
);

/** IANA names only (`Europe/Berlin`, `UTC`): no offsets like `+01:00`, which Intl also accepts. */
const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/** Whether the runtime's time zone database knows this IANA name. */
export const isTimeZone = (name: string): boolean => {
  if (!IANA_SHAPE.test(name)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
};

/** A Team's time zone, an IANA name. Cadences and answer windows are read in it. */
export const TimeZone = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isTimeZone, { expected: "an IANA time zone name" })),
  Schema.brand("TimeZone"),
);
export type TimeZone = typeof TimeZone.Type;

/**
 * A role in a Team's Membership. Release 1 assigns only `lead` and `member`; `viewer` is part of
 * the model (and of the permission table) so later releases need no migration.
 */
export const MembershipRole = Schema.Literals(["lead", "member", "viewer"]);
export type MembershipRole = typeof MembershipRole.Type;

/** The roles a Lead or admin can give in Release 1. */
export const AssignableRole = Schema.Literals(["lead", "member"]);
export type AssignableRole = typeof AssignableRole.Type;

/**
 * The Organization's minimum group size N (ADR 0004): at least 3, default 4. The cap only keeps
 * typos out. Each Round later stores the N it closed under.
 */
export const MinimumGroupSize = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(3), Schema.isLessThanOrEqualTo(100)),
);
export const DEFAULT_MINIMUM_GROUP_SIZE = 4;

/** A Team as a list shows it, with the caller's own role there (none for an admin outside it). */
export const TeamSummary = Schema.Struct({
  id: TeamId,
  name: Schema.String,
  timeZone: TimeZone,
  yourRole: Schema.NullOr(MembershipRole),
  /** How many active members the Team has; the Teams list sets it. */
  memberCount: Schema.optional(Schema.Int),
  /** The date of the next Round that is scheduled or open, if there is one; the Teams list sets it. */
  nextRoundDate: Schema.optional(Schema.NullOr(Schema.String)),
});
export type TeamSummary = typeof TeamSummary.Type;

/** One active Membership in a Team's roster. `since` is when it started (epoch ms). */
export const RosterEntry = Schema.Struct({
  personId: PersonId,
  email: EmailAddress,
  role: MembershipRole,
  since: Schema.Int,
});
export type RosterEntry = typeof RosterEntry.Type;

/** What the caller may do with this Team, so the screen shows only what will work. */
export const TeamAbilities = Schema.Struct({
  update: Schema.Boolean,
  manageLeads: Schema.Boolean,
  manageMembers: Schema.Boolean,
  managePulses: Schema.Boolean,
  viewResults: Schema.Boolean,
});
export type TeamAbilities = typeof TeamAbilities.Type;

/** A Team's detail: its active roster. Never Result data (ADR 0003). */
export const TeamDetail = Schema.Struct({
  team: TeamSummary,
  roster: Schema.Array(RosterEntry),
  may: TeamAbilities,
});
export type TeamDetail = typeof TeamDetail.Type;

/** An active Person as the Organization admin's People list shows them. */
export const PersonSummary = Schema.Struct({
  personId: PersonId,
  email: EmailAddress,
  organizationAdmin: Schema.Boolean,
  /** Signed in at least once, so linked to a WorkOS user. */
  linked: Schema.Boolean,
});
export type PersonSummary = typeof PersonSummary.Type;

/** The Organization settings screen: N, AI processing, and the People with their admin flag. */
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

/** No such active Person, or not in that Team in the role the request needs. */
export class PersonNotFound extends Schema.TaggedError<PersonNotFound, { readonly brand: unique symbol }>()(
  "PersonNotFound",
  {},
  { httpApiStatus: 404 },
) {}

/** A Team always keeps at least one Lead. Assign another Lead first. */
export class LastLead extends Schema.TaggedError<LastLead, { readonly brand: unique symbol }>()(
  "LastLead",
  { teamId: TeamId },
  { httpApiStatus: 409 },
) {}

/** An Organization always keeps at least one Organization admin. */
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

/** A removed Person can be restored to the Organization only by an Organization admin. */
export class PersonWasRemoved extends Schema.TaggedError<
  PersonWasRemoved,
  { readonly brand: unique symbol }
>()("PersonWasRemoved", {}, { httpApiStatus: 403 }) {}
