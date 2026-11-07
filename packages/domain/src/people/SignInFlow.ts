import { Clock, Effect, Option, Redacted } from "effect";
import type { OrganizationCreationAllowlist, PersonId } from "./Identity.ts";
import type { OrganizationId } from "./Organization.ts";
import {
  candidatesFor,
  decideSignIn,
  Forbidden,
  type OrganizationSummary,
  type PersonCandidate,
  type SessionState,
  Unauthenticated,
} from "./SignIn.ts";
import {
  IdentityProvider,
  NewIds,
  type OrganizationClaim,
  OrganizationPeople,
  PeopleIndex,
  type ProviderSession,
} from "./SignInPorts.ts";

/** The Person a session is signed in as. */
export interface Member {
  readonly organization: OrganizationSummary;
  readonly personId: PersonId;
}

/** A session that passed the per-request check, possibly refreshed on the way. */
export interface CheckedSession {
  readonly session: ProviderSession;
  /** Signed in to an Organization, with a Person that is still active there. */
  readonly member: Option.Option<Member>;
}

/** What an endpoint answers, and the session the response must leave in the cookie. */
export interface SessionOutcome {
  readonly state: SessionState;
  readonly session: ProviderSession;
}

/**
 * The per-request session check (SPEC §6.1):
 * 1. verify the access token locally, refreshing it when it expired;
 * 2. our own deny check: the session is not revoked (D1), and when the token is scoped to an
 *    Organization, the user's Person there is still active (its Durable Object).
 * The JWT only proves who the caller is; step 2 is what makes revocation immediate even though an
 * access token stays valid until it expires.
 */
export const checkSession = Effect.fnUntraced(function* (sealed: Redacted.Redacted<string>) {
  const identityProvider = yield* IdentityProvider;
  const index = yield* PeopleIndex;
  const people = yield* OrganizationPeople;

  const check = yield* identityProvider.authenticate(sealed);
  const session =
    check._tag === "Valid"
      ? check.session
      : check._tag === "Expired"
        ? yield* identityProvider.refresh(sealed, Option.none())
        : yield* new Unauthenticated();

  const [revoked, organization] = yield* Effect.all(
    [
      index.isSessionRevoked(session.sessionId),
      Option.match(session.workosOrganizationId, {
        onNone: () => Effect.succeedNone,
        onSome: index.organizationByWorkos,
      }),
    ],
    { concurrency: "unbounded" },
  );
  if (revoked) return yield* new Unauthenticated();
  if (Option.isNone(organization)) return { session, member: Option.none() } satisfies CheckedSession;

  const person = yield* people.activePerson(organization.value.id, session.identity.userId);
  // Removed from the Organization (or never a Person there): the session is no longer good for it.
  if (Option.isNone(person)) return yield* new Unauthenticated();
  return {
    session,
    member: Option.some({ organization: organization.value, personId: person.value }),
  } satisfies CheckedSession;
});

const signedIn = (session: ProviderSession, member: Member): SessionOutcome => ({
  session,
  state: {
    _tag: "SignedIn",
    organization: member.organization,
    personId: member.personId,
    organizationAdmin: Option.contains(session.role, "admin"),
  },
});

const candidatesOf = Effect.fnUntraced(function* (session: ProviderSession) {
  const index = yield* PeopleIndex;
  const { identity } = session;
  const [linked, unlinked] = yield* Effect.all(
    [
      index.linkedPersons(identity.userId),
      // An unverified email never links (ADR 0002), so it is not even looked up.
      identity.emailVerified ? index.unlinkedPersons(identity.email) : Effect.succeed([]),
    ],
    { concurrency: "unbounded" },
  );
  return candidatesFor(identity, linked, unlinked);
});

/**
 * Enters an Organization as a candidate Person: links the Person by verified email if it is not
 * linked yet (the Durable Object first, since it is the authority), makes sure the WorkOS
 * membership exists, and refreshes the session into that organization. Every step is idempotent.
 */
const enter = Effect.fnUntraced(function* (session: ProviderSession, candidate: PersonCandidate) {
  const identityProvider = yield* IdentityProvider;
  const index = yield* PeopleIndex;
  const people = yield* OrganizationPeople;
  const { identity } = session;
  const organizationId = candidate.organization.id;

  if (!candidate.linked) {
    const linked = yield* people.linkPerson(
      organizationId,
      candidate.personId,
      identity.userId,
      identity.email,
    );
    if (!linked) return yield* new Forbidden();
    yield* index.linkPerson(organizationId, candidate.personId, identity.userId);
  }
  const person = yield* people.activePerson(organizationId, identity.userId);
  if (Option.isNone(person)) return yield* new Forbidden();

  const workosOrganizationId = yield* index.workosOrganizationOf(organizationId);
  if (Option.isNone(workosOrganizationId)) {
    return yield* Effect.die(`Organization ${organizationId} has People but no WorkOS organization`);
  }
  yield* identityProvider.ensureMembership(identity.userId, workosOrganizationId.value, "member");
  const refreshed = yield* identityProvider.refresh(session.sealed, workosOrganizationId);
  return signedIn(refreshed, { organization: candidate.organization, personId: person.value });
});

/**
 * Finishes creating a claimed Organization. Safe to run any number of times, from any point a
 * previous run stopped at: each step is idempotent, and their order means a crash leaves nothing
 * that a later run cannot complete.
 */
const finishCreation = Effect.fnUntraced(function* (session: ProviderSession, claim: OrganizationClaim) {
  const identityProvider = yield* IdentityProvider;
  const index = yield* PeopleIndex;
  const people = yield* OrganizationPeople;
  const { identity } = session;
  const { organization, adminPersonId } = claim;

  yield* people.createWithAdmin(organization, {
    personId: adminPersonId,
    email: identity.email,
    userId: identity.userId,
  });
  const workosOrganizationId = yield* identityProvider.createOrganization(organization.name, organization.id);
  yield* index.putOrganization(organization, Option.some(workosOrganizationId));
  yield* index.putPerson({
    organizationId: organization.id,
    personId: adminPersonId,
    email: identity.email,
    userId: Option.some(identity.userId),
  });
  yield* identityProvider.ensureMembership(identity.userId, workosOrganizationId, "admin");
  const refreshed = yield* identityProvider.refresh(session.sealed, Option.some(workosOrganizationId));
  return signedIn(refreshed, { organization, personId: adminPersonId });
});

/** A creation this user started and that has not reached their session yet. */
const unfinishedClaim = Effect.fnUntraced(function* (
  session: ProviderSession,
  candidates: ReadonlyArray<PersonCandidate>,
) {
  const claim = yield* (yield* PeopleIndex).claimOf(session.identity.userId);
  return Option.filter(
    claim,
    (claimed) => !candidates.some((candidate) => candidate.organization.id === claimed.organization.id),
  );
});

/**
 * `GET /auth/session`: where the user stands. A user with exactly one Person enters (and is linked
 * on first sign-in); several get the Organization picker; none get "Create an Organization" or
 * "You're not part of an Organization yet".
 */
export const sessionState = Effect.fnUntraced(function* (
  checked: CheckedSession,
  allowlist: OrganizationCreationAllowlist,
) {
  const { session } = checked;
  if (Option.isSome(checked.member)) return signedIn(session, checked.member.value);

  const candidates = yield* candidatesOf(session);
  const claim = yield* unfinishedClaim(session, candidates);
  if (Option.isSome(claim)) return yield* finishCreation(session, claim.value);

  const decision = decideSignIn(session.identity, candidates, allowlist);
  switch (decision._tag) {
    case "Enter":
      return yield* enter(session, decision.candidate);
    case "ChooseOrganization":
      return {
        session,
        state: {
          _tag: "ChooseOrganization",
          organizations: decision.candidates.map((candidate) => candidate.organization),
        },
      } satisfies SessionOutcome;
    case "CreateOrganization":
    case "NotInOrganization":
      return { session, state: { _tag: decision._tag } } satisfies SessionOutcome;
  }
});

/**
 * `POST /auth/organization`: "Create an Organization" (name only). Idempotent per WorkOS user: the
 * first claim wins, and a double submit or retry finishes that same Organization.
 */
export const createOrganization = Effect.fnUntraced(function* (
  checked: CheckedSession,
  name: string,
  allowlist: OrganizationCreationAllowlist,
) {
  const index = yield* PeopleIndex;
  const ids = yield* NewIds;
  const { session } = checked;

  const existing = yield* index.claimOf(session.identity.userId);
  if (Option.isSome(existing)) return yield* finishCreation(session, existing.value);

  if (Option.isSome(checked.member)) return yield* new Forbidden();
  const decision = decideSignIn(session.identity, yield* candidatesOf(session), allowlist);
  if (decision._tag !== "CreateOrganization") return yield* new Forbidden();

  const claim = yield* index.claimOrganization(session.identity.userId, {
    organization: { id: yield* ids.organizationId, name },
    adminPersonId: yield* ids.personId,
  });
  return yield* finishCreation(session, claim);
});

/** `POST /auth/organization/choose`: the Organization picker. Only an offered Organization can be entered. */
export const chooseOrganization = Effect.fnUntraced(function* (
  checked: CheckedSession,
  organizationId: OrganizationId,
) {
  const candidate = (yield* candidatesOf(checked.session)).find(
    (each) => each.organization.id === organizationId,
  );
  if (candidate === undefined) return yield* new Forbidden();
  return yield* enter(checked.session, candidate);
});

/**
 * `POST /auth/logout`: denies the session at once (the access token would otherwise stay valid
 * for minutes) and returns the WorkOS logout URL, or none when there was no live session.
 */
export const signOut = Effect.fnUntraced(function* (sealed: Redacted.Redacted<string>, returnTo: string) {
  const identityProvider = yield* IdentityProvider;
  const index = yield* PeopleIndex;

  const check = yield* identityProvider.authenticate(sealed);
  const session =
    check._tag === "Valid"
      ? Option.some(check.session)
      : check._tag === "Expired"
        ? yield* identityProvider.refresh(sealed, Option.none()).pipe(
            Effect.asSome,
            Effect.catchTag("Unauthenticated", () => Effect.succeedNone),
          )
        : Option.none<ProviderSession>();
  if (Option.isNone(session)) return Option.none<string>();

  yield* index.revokeSession(session.value.sessionId, yield* Clock.currentTimeMillis);
  return Option.some(identityProvider.logoutUrl(session.value.sessionId, returnTo));
});

/** Whether a response must write a new cookie. */
export const sealedChanged = (before: Redacted.Redacted<string>, after: ProviderSession): boolean =>
  Redacted.value(before) !== Redacted.value(after.sealed);
