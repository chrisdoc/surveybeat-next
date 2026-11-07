import { Context, type Effect, type Option, type Redacted } from "effect";
import type { EmailAddress } from "../email/Email.ts";
import type { Identity, PersonId, SessionId, WorkosOrganizationId, WorkosUserId } from "./Identity.ts";
import type { OrganizationId } from "./Organization.ts";
import type { AuthUnavailable, OrganizationSummary, PersonCandidate, Unauthenticated } from "./SignIn.ts";

/** A verified session from the identity provider, and the sealed cookie value that carries it. */
export interface ProviderSession {
  readonly sealed: Redacted.Redacted<string>;
  readonly sessionId: SessionId;
  readonly identity: Identity;
  /** The WorkOS organization the access token is scoped to, if any. */
  readonly workosOrganizationId: Option.Option<WorkosOrganizationId>;
  /** The org-level WorkOS role slug in that organization (`admin`, `member`). */
  readonly role: Option.Option<string>;
}

/** What the local check of a sealed session found. Network trouble is `AuthUnavailable`, never one of these. */
export type SessionCheck =
  | { readonly _tag: "Valid"; readonly session: ProviderSession }
  /** The access token expired (about 5 minutes): refresh it. */
  | { readonly _tag: "Expired" }
  /** Missing, tampered, or not a user token: sign in again. */
  | { readonly _tag: "Invalid" };

export type OrganizationRole = "admin" | "member";

/**
 * WorkOS AuthKit behind a domain interface. The adapter is `@workos-inc/node`'s workerd build;
 * tests use a fake. Every call that reaches WorkOS maps transient failures to `AuthUnavailable`.
 */
export interface IdentityProviderShape {
  /** The hosted AuthKit URL (email code, Google, Microsoft). */
  readonly authorizationUrl: (options: { readonly redirectUri: string; readonly state: string }) => string;
  /** Exchanges the callback's code. Fails `Unauthenticated` for a bad or used code. */
  readonly authenticateWithCode: (
    code: string,
  ) => Effect.Effect<ProviderSession, Unauthenticated | AuthUnavailable>;
  /** Verifies the access token locally (JWKS), with no network call once the keys are cached. */
  readonly authenticate: (sealed: Redacted.Redacted<string>) => Effect.Effect<SessionCheck, AuthUnavailable>;
  /** Rotates the refresh token, optionally switching organization. A terminal failure is `Unauthenticated`. */
  readonly refresh: (
    sealed: Redacted.Redacted<string>,
    organization: Option.Option<WorkosOrganizationId>,
  ) => Effect.Effect<ProviderSession, Unauthenticated | AuthUnavailable>;
  /** Where to send the browser to end the WorkOS session too. */
  readonly logoutUrl: (sessionId: SessionId, returnTo: string) => string;
  /** Idempotent per `externalId`: a retry returns the organization the first call created. */
  readonly createOrganization: (
    name: string,
    externalId: OrganizationId,
  ) => Effect.Effect<WorkosOrganizationId, AuthUnavailable>;
  /** Idempotent: an existing membership is kept as it is (never downgraded). */
  readonly ensureMembership: (
    userId: WorkosUserId,
    organization: WorkosOrganizationId,
    role: OrganizationRole,
  ) => Effect.Effect<void, AuthUnavailable>;
}

export class IdentityProvider extends Context.Service<IdentityProvider, IdentityProviderShape>()(
  "@surveybeat/domain/IdentityProvider",
) {}

/** The Organization a WorkOS user claimed by creating it: one per user, whatever the retries. */
export interface OrganizationClaim {
  readonly organization: OrganizationSummary;
  readonly adminPersonId: PersonId;
}

/**
 * The D1 global index (SPEC §6.2): what must be looked up before the Organization is known.
 * WorkOS user → Persons, email → not-yet-linked Persons, WorkOS organization → Organization, and
 * the revoked-session deny list. Emails are normalised. No survey content.
 */
export interface PeopleIndexShape {
  readonly linkedPersons: (userId: WorkosUserId) => Effect.Effect<ReadonlyArray<PersonCandidate>>;
  readonly unlinkedPersons: (email: EmailAddress) => Effect.Effect<ReadonlyArray<PersonCandidate>>;
  /** Idempotent. Records the Organization and, once known, its WorkOS organization. */
  readonly putOrganization: (
    organization: OrganizationSummary,
    workosOrganizationId: Option.Option<WorkosOrganizationId>,
  ) => Effect.Effect<void>;
  readonly organizationByWorkos: (
    workosOrganizationId: WorkosOrganizationId,
  ) => Effect.Effect<Option.Option<OrganizationSummary>>;
  readonly workosOrganizationOf: (
    organizationId: OrganizationId,
  ) => Effect.Effect<Option.Option<WorkosOrganizationId>>;
  /** Idempotent per (Organization, Person). */
  readonly putPerson: (person: {
    readonly organizationId: OrganizationId;
    readonly personId: PersonId;
    readonly email: EmailAddress;
    readonly userId: Option.Option<WorkosUserId>;
  }) => Effect.Effect<void>;
  /** Links an unlinked Person. Does nothing when the Person is already linked (to anyone). */
  readonly linkPerson: (
    organizationId: OrganizationId,
    personId: PersonId,
    userId: WorkosUserId,
  ) => Effect.Effect<void>;
  /** The first claim for a user wins; every later call returns it unchanged. */
  readonly claimOrganization: (
    userId: WorkosUserId,
    proposed: OrganizationClaim,
  ) => Effect.Effect<OrganizationClaim>;
  readonly claimOf: (userId: WorkosUserId) => Effect.Effect<Option.Option<OrganizationClaim>>;
  readonly revokeSession: (sessionId: SessionId, now: number) => Effect.Effect<void>;
  readonly isSessionRevoked: (sessionId: SessionId) => Effect.Effect<boolean>;
}

export class PeopleIndex extends Context.Service<PeopleIndex, PeopleIndexShape>()(
  "@surveybeat/domain/PeopleIndex",
) {}

/**
 * The People of each Organization, as its Durable Object holds them (ADR 0006). This is the
 * authority for "is this Person still here": the per-request check asks it, not the index.
 */
export interface OrganizationPeopleShape {
  /** Idempotent: creates the Organization with its first Person as Organization admin. */
  readonly createWithAdmin: (
    organization: OrganizationSummary,
    admin: { readonly personId: PersonId; readonly email: EmailAddress; readonly userId: WorkosUserId },
  ) => Effect.Effect<void>;
  /**
   * Links the Person to the user when the Person exists, is not removed, has exactly this
   * (normalised) email, and is unlinked or already linked to this user. Returns whether it is linked.
   */
  readonly linkPerson: (
    organizationId: OrganizationId,
    personId: PersonId,
    userId: WorkosUserId,
    email: EmailAddress,
  ) => Effect.Effect<boolean>;
  /** The user's Person in this Organization, unless it is removed or ended. */
  readonly activePerson: (
    organizationId: OrganizationId,
    userId: WorkosUserId,
  ) => Effect.Effect<Option.Option<PersonId>>;
}

export class OrganizationPeople extends Context.Service<OrganizationPeople, OrganizationPeopleShape>()(
  "@surveybeat/domain/OrganizationPeople",
) {}

/** Fresh unguessable ids. The adapter uses Web Crypto. */
export interface NewIdsShape {
  readonly organizationId: Effect.Effect<OrganizationId>;
  readonly personId: Effect.Effect<PersonId>;
}

export class NewIds extends Context.Service<NewIds, NewIdsShape>()("@surveybeat/domain/NewIds") {}
