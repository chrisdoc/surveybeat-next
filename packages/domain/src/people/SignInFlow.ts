import { Clock, Effect, Option, Redacted } from "effect";
import type { OrganizationCreationAllowlist, PersonId, WorkosOrganizationId } from "./Identity.ts";
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
  type ClaimStatus,
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
  /** From the Organization's Durable Object, not the token's role claim, which can be minutes old. */
  readonly organizationAdmin: boolean;
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
 * access token stays valid until it expires. Only a revoked session is refused outright: a user
 * removed from the token's Organization keeps the session, with no member, so they get the picker
 * or "not part of an Organization" rather than a sign-in loop.
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
  // Removed from the Organization (or never a Person there): the session is no longer good for it,
  // but still is for the user. WorkOS keeps a refreshed session in its organization, so the token
  // stays as it is and nothing trusts its organization: only `member` grants access.
  if (Option.isNone(person)) return { session, member: Option.none() } satisfies CheckedSession;
  return {
    session,
    member: Option.some({ organization: organization.value, ...person.value }),
  } satisfies CheckedSession;
});

const signedIn = (session: ProviderSession, member: Member): SessionOutcome => ({
  session,
  state: {
    _tag: "SignedIn",
    organization: member.organization,
    personId: member.personId,
    organizationAdmin: member.organizationAdmin,
  },
});

const candidatesOf = Effect.fnUntraced(function* (session: ProviderSession) {
  const index = yield* PeopleIndex;
  const { identity } = session;
  const [linked, unlinked] = yield* Effect.all(
    [
      index.linkedPersons(identity.userId),
      // An unverified or non-ASCII email never links (ADR 0002), so it is not even looked up.
      identity.emailMatchable ? index.unlinkedPersons(identity.email) : Effect.succeed([]),
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
  yield* identityProvider.ensureMembership(
    identity.userId,
    workosOrganizationId.value,
    person.value.organizationAdmin ? "admin" : "member",
  );
  const refreshed = yield* identityProvider.refresh(session.sealed, workosOrganizationId);
  return signedIn(refreshed, { organization: candidate.organization, ...person.value });
});

/**
 * Finishes creating a claimed Organization, then closes the claim so it is never finished again
 * (a creator removed later must not be made admin by it). Safe to run any number of times, from
 * any point a previous run stopped at: each step is idempotent, and their order means a crash
 * leaves nothing that a later run cannot complete.
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
  // `createWithAdmin` does nothing once the Organization exists, so a creator removed since the
  // claim stays removed: close the claim and refuse.
  const person = yield* people.activePerson(organization.id, identity.userId);
  if (Option.isNone(person)) {
    yield* index.completeClaim(identity.userId, yield* Clock.currentTimeMillis);
    return yield* new Forbidden();
  }
  const workosOrganizationId = yield* identityProvider.createOrganization(organization.name, organization.id);
  yield* index.putOrganization(organization, Option.some(workosOrganizationId));
  yield* index.putPerson({
    organizationId: organization.id,
    personId: adminPersonId,
    email: identity.email,
    userId: Option.some(identity.userId),
  });
  yield* identityProvider.ensureMembership(identity.userId, workosOrganizationId, "admin");
  yield* index.completeClaim(identity.userId, yield* Clock.currentTimeMillis);
  const refreshed = yield* identityProvider.refresh(session.sealed, Option.some(workosOrganizationId));
  return signedIn(refreshed, { organization, ...person.value });
});

/** A creation this user may still finish: started, not completed, and still allowlisted. */
const isUnfinished = (
  claim: Option.Option<ClaimStatus>,
  session: ProviderSession,
  allowlist: OrganizationCreationAllowlist,
): claim is Option.Some<ClaimStatus> =>
  Option.isSome(claim) && !claim.value.completed && allowlist.allows(session.identity);

/**
 * `GET /auth/session`: where the user stands. A user with exactly one Person enters (and is linked
 * on first sign-in); several get the Organization picker; none get "Create an Organization" or
 * "You're not part of an Organization yet".
 *
 * A GET with side effects (linking, WorkOS membership, finishing an open claim), on purpose: each
 * is idempotent and is only what this user is entitled to anyway, so a cross-site top-level GET
 * (which carries the `SameSite=Lax` cookie) can at most do early what their next visit would do.
 */
export const sessionState = Effect.fnUntraced(function* (
  checked: CheckedSession,
  allowlist: OrganizationCreationAllowlist,
) {
  const { session } = checked;
  if (Option.isSome(checked.member)) return signedIn(session, checked.member.value);

  const claim = yield* (yield* PeopleIndex).claimOf(session.identity.userId);
  if (isUnfinished(claim, session, allowlist)) return yield* finishCreation(session, claim.value);

  const decision = decideSignIn(session.identity, yield* candidatesOf(session), allowlist);
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
      // One Organization per creator: a user whose claim is closed cannot create another.
      return {
        session,
        state: { _tag: Option.isSome(claim) ? "NotInOrganization" : "CreateOrganization" },
      } satisfies SessionOutcome;
    case "NotInOrganization":
      return { session, state: { _tag: decision._tag } } satisfies SessionOutcome;
  }
});

/** Finishes an open claim; a closed one is only entered like any Organization, if still a Person there. */
const finishOrEnter = (session: ProviderSession, claim: ClaimStatus) =>
  claim.completed
    ? enter(session, { organization: claim.organization, personId: claim.adminPersonId, linked: true })
    : finishCreation(session, claim);

/**
 * `POST /auth/organization`: "Create an Organization" (name only). Only for a verified,
 * allowlisted email with no Organization in the session. Idempotent per WorkOS user: the first
 * claim wins, a retry finishes that same Organization, and a double submit after it was finished
 * enters it as its (still active) Person.
 */
export const createOrganization = Effect.fnUntraced(function* (
  checked: CheckedSession,
  name: string,
  allowlist: OrganizationCreationAllowlist,
) {
  const index = yield* PeopleIndex;
  const ids = yield* NewIds;
  const { session } = checked;

  if (Option.isSome(checked.member) || !allowlist.allows(session.identity)) return yield* new Forbidden();

  const existing = yield* index.claimOf(session.identity.userId);
  if (Option.isSome(existing)) return yield* finishOrEnter(session, existing.value);

  const decision = decideSignIn(session.identity, yield* candidatesOf(session), allowlist);
  if (decision._tag !== "CreateOrganization") return yield* new Forbidden();

  const claim = yield* index.claimOrganization(session.identity.userId, {
    organization: { id: yield* ids.organizationId, name },
    adminPersonId: yield* ids.personId,
  });
  return yield* finishOrEnter(session, claim);
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
 * `GET /auth/callback`: exchanges the code for a session. When WorkOS needs one of the user's
 * organizations picked, this takes one where they still have an active Person, so a membership
 * left over from a removal is not chosen; the first otherwise (the per-request check then treats
 * the session as having no Organization).
 */
export const signInWithCode = Effect.fnUntraced(function* (code: string) {
  const identityProvider = yield* IdentityProvider;
  const index = yield* PeopleIndex;
  const people = yield* OrganizationPeople;

  const exchange = yield* identityProvider.authenticateWithCode(code);
  if (exchange._tag === "Authenticated") return exchange.session;
  const [first] = exchange.organizations;
  if (first === undefined) return yield* new Unauthenticated();

  let chosen: WorkosOrganizationId = first;
  if (Option.isSome(exchange.userId)) {
    for (const workosOrganizationId of exchange.organizations) {
      const organization = yield* index.organizationByWorkos(workosOrganizationId);
      if (Option.isNone(organization)) continue;
      if (Option.isSome(yield* people.activePerson(organization.value.id, exchange.userId.value))) {
        chosen = workosOrganizationId;
        break;
      }
    }
  }
  return yield* identityProvider.authenticateWithOrganizationSelection(
    exchange.pendingAuthenticationToken,
    chosen,
  );
});

/**
 * `POST /auth/logout`: denies the session at once (the access token would otherwise stay valid
 * for minutes), ends it at WorkOS so its refresh token stops working, and returns the WorkOS
 * logout URL, or none when there was no live session. The deny-list row is written first, so it
 * is in place even when WorkOS cannot be reached (`AuthUnavailable`).
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
  yield* identityProvider.revokeSession(session.value.sessionId);
  return Option.some(identityProvider.logoutUrl(session.value.sessionId, returnTo));
});

/** Whether a response must write a new cookie. */
export const sealedChanged = (before: Redacted.Redacted<string>, after: ProviderSession): boolean =>
  Redacted.value(before) !== Redacted.value(after.sealed);
