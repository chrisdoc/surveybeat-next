import { Schema } from "effect";
import { OrganizationCreationAllowlist, type Identity, PersonId } from "./Identity.ts";
import { OrganizationId } from "./Organization.ts";

/** An Organization as the sign-in screens show it: id and name only. */
export const OrganizationSummary = Schema.Struct({ id: OrganizationId, name: Schema.String });
export type OrganizationSummary = typeof OrganizationSummary.Type;

/** A Person the signed-in user may enter as: already linked to them, or matched by verified email. */
export interface PersonCandidate {
  readonly organization: OrganizationSummary;
  readonly personId: PersonId;
  /** Already linked to this WorkOS user. Otherwise entering links it. */
  readonly linked: boolean;
}

/** What first sign-in leads to, before any side effect. */
export type SignInDecision =
  | { readonly _tag: "Enter"; readonly candidate: PersonCandidate }
  | { readonly _tag: "ChooseOrganization"; readonly candidates: ReadonlyArray<PersonCandidate> }
  | { readonly _tag: "CreateOrganization" }
  | { readonly _tag: "NotInOrganization" };

/**
 * The Persons a user may enter as: every Person linked to them, plus, only when the identity
 * provider verified their email, the not-yet-linked Persons with exactly that email (ADR 0002).
 * At most one per Organization, preferring the linked one.
 */
export const candidatesFor = (
  identity: Identity,
  linked: ReadonlyArray<PersonCandidate>,
  unlinkedWithEmail: ReadonlyArray<PersonCandidate>,
): ReadonlyArray<PersonCandidate> => {
  const byOrganization = new Map<OrganizationId, PersonCandidate>();
  for (const candidate of linked) byOrganization.set(candidate.organization.id, candidate);
  if (identity.emailVerified) {
    for (const candidate of unlinkedWithEmail) {
      if (!byOrganization.has(candidate.organization.id)) {
        byOrganization.set(candidate.organization.id, candidate);
      }
    }
  }
  return [...byOrganization.values()].sort((a, b) => a.organization.name.localeCompare(b.organization.name));
};

/**
 * First sign-in with no Organization in the session: one Person enters, several get a picker, and
 * none leads to "Create an Organization" for an allowlisted verified email, or to "You're not part
 * of an Organization yet" for everyone else.
 */
export const decideSignIn = (
  identity: Identity,
  candidates: ReadonlyArray<PersonCandidate>,
  allowlist: OrganizationCreationAllowlist,
): SignInDecision => {
  const [only, ...rest] = candidates;
  if (only !== undefined && rest.length === 0) return { _tag: "Enter", candidate: only };
  if (only !== undefined) return { _tag: "ChooseOrganization", candidates };
  return allowlist.allows(identity) ? { _tag: "CreateOrganization" } : { _tag: "NotInOrganization" };
};

/** Where the signed-in user stands, as `GET /auth/session` reports it. */
export const SessionState = Schema.Union([
  Schema.TaggedStruct("SignedIn", {
    organization: OrganizationSummary,
    personId: PersonId,
    /** WorkOS's org-level `admin` role. It grants no access to any Team's Results (ADR 0003). */
    organizationAdmin: Schema.Boolean,
  }),
  Schema.TaggedStruct("ChooseOrganization", { organizations: Schema.Array(OrganizationSummary) }),
  Schema.TaggedStruct("CreateOrganization", {}),
  Schema.TaggedStruct("NotInOrganization", {}),
]);
export type SessionState = typeof SessionState.Type;

/** The request carries no valid session: sign in again. */
export class Unauthenticated extends Schema.TaggedError<Unauthenticated, { readonly brand: unique symbol }>()(
  "Unauthenticated",
  {},
  { httpApiStatus: 401 },
) {}

/** Signed in, but this action is not open to them (not allowlisted, not offered that Organization). */
export class Forbidden extends Schema.TaggedError<Forbidden, { readonly brand: unique symbol }>()(
  "Forbidden",
  {},
  { httpApiStatus: 403 },
) {}

/** The identity provider could not be reached. The session is kept; try again. */
export class AuthUnavailable extends Schema.TaggedError<AuthUnavailable, { readonly brand: unique symbol }>()(
  "AuthUnavailable",
  {},
  { httpApiStatus: 503 },
) {}
