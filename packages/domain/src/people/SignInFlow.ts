import { Clock, Effect, Option, Redacted } from "effect";
import type { OrganizationCreationAllowlist, PersonId, WorkosOrganizationId } from "./Identity.ts";
import type { Locale } from "./Locale.ts";
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

export interface Member {
  readonly organization: OrganizationSummary;
  readonly personId: PersonId;

  readonly organizationAdmin: boolean;
  readonly locale: Locale | null;
  readonly detectedLocale: Locale | null;
  readonly organizationLocale: Locale;
}

export interface CheckedSession {
  readonly session: ProviderSession;

  readonly member: Option.Option<Member>;
}

export interface SessionOutcome {
  readonly state: SessionState;
  readonly session: ProviderSession;
}

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
    locale: member.locale,
    detectedLocale: member.detectedLocale,
    organizationLocale: member.organizationLocale,
  },
});

const candidatesOf = Effect.fnUntraced(function* (session: ProviderSession) {
  const index = yield* PeopleIndex;
  const { identity } = session;
  const [linked, unlinked] = yield* Effect.all(
    [
      index.linkedPersons(identity.userId),

      identity.emailMatchable ? index.unlinkedPersons(identity.email) : Effect.succeed([]),
    ],
    { concurrency: "unbounded" },
  );
  return candidatesFor(identity, linked, unlinked);
});

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

const isUnfinished = (
  claim: Option.Option<ClaimStatus>,
  session: ProviderSession,
  allowlist: OrganizationCreationAllowlist,
): claim is Option.Some<ClaimStatus> =>
  Option.isSome(claim) && !claim.value.completed && allowlist.allows(session.identity);

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
      return {
        session,
        state: { _tag: Option.isSome(claim) ? "NotInOrganization" : "CreateOrganization" },
      } satisfies SessionOutcome;
    case "NotInOrganization":
      return { session, state: { _tag: decision._tag } } satisfies SessionOutcome;
  }
});

const finishOrEnter = (session: ProviderSession, claim: ClaimStatus) =>
  claim.completed
    ? enter(session, { organization: claim.organization, personId: claim.adminPersonId, linked: true })
    : finishCreation(session, claim);

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

export const sealedChanged = (before: Redacted.Redacted<string>, after: ProviderSession): boolean =>
  Redacted.value(before) !== Redacted.value(after.sealed);
