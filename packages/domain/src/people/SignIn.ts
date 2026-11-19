import { Schema } from "effect";
import { PersonId } from "./Identity.ts";
import type { OrganizationCreationAllowlist, Identity } from "./Identity.ts";
import { Locale } from "./Locale.ts";
import { OrganizationId } from "./Organization.ts";

export const OrganizationSummary = Schema.Struct({ id: OrganizationId, name: Schema.String });
export type OrganizationSummary = typeof OrganizationSummary.Type;

export interface PersonCandidate {
  readonly organization: OrganizationSummary;
  readonly personId: PersonId;

  readonly linked: boolean;
}

export type SignInDecision =
  | { readonly _tag: "Enter"; readonly candidate: PersonCandidate }
  | { readonly _tag: "ChooseOrganization"; readonly candidates: readonly PersonCandidate[] }
  | { readonly _tag: "CreateOrganization" }
  | { readonly _tag: "NotInOrganization" };

export const candidatesFor = (
  identity: Identity,
  linked: readonly PersonCandidate[],
  unlinkedWithEmail: readonly PersonCandidate[],
): readonly PersonCandidate[] => {
  const byOrganization = new Map<OrganizationId, PersonCandidate>();
  for (const candidate of linked) {
    byOrganization.set(candidate.organization.id, candidate);
  }
  if (identity.emailMatchable) {
    for (const candidate of unlinkedWithEmail) {
      if (!byOrganization.has(candidate.organization.id)) {
        byOrganization.set(candidate.organization.id, candidate);
      }
    }
  }
  return [...byOrganization.values()].sort((a, b) => a.organization.name.localeCompare(b.organization.name));
};

export const decideSignIn = (
  identity: Identity,
  candidates: readonly PersonCandidate[],
  allowlist: OrganizationCreationAllowlist,
): SignInDecision => {
  const [only, ...rest] = candidates;
  if (only !== undefined && rest.length === 0) {
    return { _tag: "Enter", candidate: only };
  }
  if (only !== undefined) {
    return { _tag: "ChooseOrganization", candidates };
  }
  return allowlist.allows(identity) ? { _tag: "CreateOrganization" } : { _tag: "NotInOrganization" };
};

export const SessionState = Schema.Union([
  Schema.TaggedStruct("SignedIn", {
    organization: OrganizationSummary,
    personId: PersonId,

    organizationAdmin: Schema.Boolean,

    locale: Schema.NullOr(Locale),

    detectedLocale: Schema.NullOr(Locale),

    organizationLocale: Locale,
  }),
  Schema.TaggedStruct("ChooseOrganization", { organizations: Schema.Array(OrganizationSummary) }),
  Schema.TaggedStruct("CreateOrganization", {}),
  Schema.TaggedStruct("NotInOrganization", {}),
]);
export type SessionState = typeof SessionState.Type;

export class Unauthenticated extends Schema.TaggedError<Unauthenticated, { readonly brand: unique symbol }>()(
  "Unauthenticated",
  {},
  { httpApiStatus: 401 },
) {}

export class Forbidden extends Schema.TaggedError<Forbidden, { readonly brand: unique symbol }>()(
  "Forbidden",
  {},
  { httpApiStatus: 403 },
) {}

export class AuthUnavailable extends Schema.TaggedError<AuthUnavailable, { readonly brand: unique symbol }>()(
  "AuthUnavailable",
  {},
  { httpApiStatus: 503 },
) {}
