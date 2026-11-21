import { Clock, Effect, Option } from "effect";
import type { Redacted } from "effect";
import type { EmailAddress } from "../email/Email.ts";
import { resumeEmailChange } from "./EmailRectification.ts";
import { normaliseEmail } from "./Identity.ts";
import type { OrganizationCreationAllowlist, PersonId } from "./Identity.ts";
import type { Locale } from "./Locale.ts";
import type { OrganizationId } from "./Organization.ts";
import { candidatesFor, decideSignIn, Forbidden } from "./SignIn.ts";
import type { OrganizationSummary, PersonCandidate, SessionState } from "./SignIn.ts";
import { NewIds, OrganizationPeople, PeopleIndex } from "./SignInPorts.ts";
import type { ClaimStatus, OrganizationClaim } from "./SignInPorts.ts";
import { SessionIdentityProvider } from "./SessionIdentity.ts";
import type { SignedInSession } from "./SessionIdentity.ts";
import { AccountStillInUse, ErasureNotConfirmed } from "./Team.ts";

export interface Member {
  readonly organization: OrganizationSummary;
  readonly personId: PersonId;

  readonly organizationAdmin: boolean;
  readonly locale: Locale | null;
  readonly detectedLocale: Locale | null;
  readonly organizationLocale: Locale;
}

export interface CheckedSession {
  readonly session: SignedInSession;

  readonly member: Option.Option<Member>;
}

export interface SessionOutcome {
  readonly state: SessionState;
  readonly session: SignedInSession;
}

const memberOf = Effect.fnUntraced(function* (session: SignedInSession, organization: OrganizationSummary) {
  const people = yield* OrganizationPeople;
  const person = yield* people.activePerson(organization.id, session.identity.userId);

  return Option.map(person, (active) => ({ organization, ...active }));
});

export const checkSession = Effect.fnUntraced(function* (cookie: Redacted.Redacted) {
  const sessions = yield* SessionIdentityProvider;
  const index = yield* PeopleIndex;

  const session = yield* sessions.authenticate(cookie);
  const chosen = yield* sessions.chosenOrganization(session.sessionId);

  if (Option.isSome(chosen)) {
    const [linked, unlinked] = yield* Effect.all(
      [
        index.linkedPersons(session.identity.userId),
        session.identity.emailMatchable ? index.unlinkedPersons(session.identity.email) : Effect.succeed([]),
      ],
      { concurrency: "unbounded" },
    );

    const candidate = candidatesFor(session.identity, linked, unlinked).find(
      (each) => each.organization.id === chosen.value,
    );

    const member =
      candidate === undefined ? Option.none<Member>() : yield* memberOf(session, candidate.organization);

    return { session, member } satisfies CheckedSession;
  }

  const linked = yield* index.linkedPersons(session.identity.userId);
  const [only, ...rest] = linked;

  if (only === undefined || rest.length > 0) {
    return { session, member: Option.none() } satisfies CheckedSession;
  }

  return { session, member: yield* memberOf(session, only.organization) } satisfies CheckedSession;
});

const signedIn = (session: SignedInSession, member: Member): SessionOutcome => ({
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

const candidatesOf = Effect.fnUntraced(function* (session: SignedInSession) {
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

const enter = Effect.fnUntraced(function* (session: SignedInSession, candidate: PersonCandidate) {
  const sessions = yield* SessionIdentityProvider;
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

    if (!linked) {
      return yield* new Forbidden();
    }

    yield* index.linkPerson(organizationId, candidate.personId, identity.userId);
  }

  const member = yield* memberOf(session, candidate.organization);

  if (Option.isNone(member)) {
    return yield* new Forbidden();
  }

  yield* sessions.chooseOrganization(session.sessionId, organizationId);

  return signedIn(session, member.value);
});

const finishCreation = Effect.fnUntraced(function* (session: SignedInSession, claim: OrganizationClaim) {
  const sessions = yield* SessionIdentityProvider;
  const index = yield* PeopleIndex;
  const people = yield* OrganizationPeople;
  const { identity } = session;
  const { organization, adminPersonId } = claim;

  yield* people.createWithAdmin(organization, {
    personId: adminPersonId,
    email: identity.email,
    userId: identity.userId,
  });

  const member = yield* memberOf(session, organization);

  if (Option.isNone(member)) {
    yield* index.completeClaim(identity.userId, yield* Clock.currentTimeMillis);

    return yield* new Forbidden();
  }

  yield* index.putOrganization(organization);
  yield* index.putPerson({
    organizationId: organization.id,
    personId: adminPersonId,
    email: identity.email,
    userId: Option.some(identity.userId),
  });
  yield* index.completeClaim(identity.userId, yield* Clock.currentTimeMillis);
  yield* sessions.chooseOrganization(session.sessionId, organization.id);

  return signedIn(session, member.value);
});

const isUnfinished = (
  claim: Option.Option<ClaimStatus>,
  session: SignedInSession,
  allowlist: OrganizationCreationAllowlist,
): claim is Option.Some<ClaimStatus> =>
  Option.isSome(claim) && !claim.value.completed && allowlist.allows(session.identity);

export const sessionState = Effect.fnUntraced(function* (
  checked: CheckedSession,
  allowlist: OrganizationCreationAllowlist,
) {
  const { session } = checked;

  yield* resumeEmailChange(session);

  if (Option.isSome(checked.member)) {
    return signedIn(session, checked.member.value);
  }

  const claim = yield* (yield* PeopleIndex).claimOf(session.identity.userId);

  if (isUnfinished(claim, session, allowlist)) {
    return yield* finishCreation(session, claim.value);
  }

  const decision = decideSignIn(session.identity, yield* candidatesOf(session), allowlist);

  switch (decision._tag) {
    case "Enter": {
      return yield* enter(session, decision.candidate);
    }

    case "ChooseOrganization": {
      return {
        session,
        state: {
          _tag: "ChooseOrganization",
          organizations: decision.candidates.map((candidate) => candidate.organization),
        },
      } satisfies SessionOutcome;
    }

    case "CreateOrganization": {
      return {
        session,
        state: { _tag: Option.isSome(claim) ? "NotInOrganization" : "CreateOrganization" },
      } satisfies SessionOutcome;
    }

    case "NotInOrganization": {
      return { session, state: { _tag: decision._tag } } satisfies SessionOutcome;
    }
  }
});

const finishOrEnter = (session: SignedInSession, claim: ClaimStatus) =>
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

  if (Option.isSome(checked.member)) {
    return signedIn(session, checked.member.value);
  }

  if (!allowlist.allows(session.identity)) {
    return yield* new Forbidden();
  }

  const existing = yield* index.claimOf(session.identity.userId);

  if (Option.isSome(existing)) {
    return yield* finishOrEnter(session, existing.value);
  }

  const decision = decideSignIn(session.identity, yield* candidatesOf(session), allowlist);

  if (decision._tag !== "CreateOrganization") {
    return yield* new Forbidden();
  }

  const claimed = yield* index.claimOrganization(session.identity.userId, {
    organization: { id: yield* ids.organizationId, name },
    adminPersonId: yield* ids.personId,
  });

  const canonical = Option.getOrElse(yield* index.claimOf(session.identity.userId), () => claimed);

  return yield* finishOrEnter(session, canonical);
});

export const chooseOrganization = Effect.fnUntraced(function* (
  checked: CheckedSession,
  organizationId: OrganizationId,
) {
  const candidate = (yield* candidatesOf(checked.session)).find(
    (each) => each.organization.id === organizationId,
  );

  if (candidate === undefined) {
    return yield* new Forbidden();
  }

  return yield* enter(checked.session, candidate);
});

export const signOut = Effect.fnUntraced(function* (cookie: Redacted.Redacted) {
  const sessions = yield* SessionIdentityProvider;
  const session = yield* sessions.authenticate(cookie).pipe(Effect.option);

  if (Option.isNone(session)) {
    return yield* Effect.void;
  }

  yield* sessions.revokeSession(session.value.sessionId);
});

export const eraseAccount = Effect.fnUntraced(function* (
  session: SignedInSession,
  confirmation: EmailAddress,
) {
  if (normaliseEmail(confirmation) !== session.identity.email) {
    return yield* new ErasureNotConfirmed();
  }

  const erased = yield* (yield* PeopleIndex).eraseAccount(session.identity.userId);

  if (!erased) {
    return yield* new AccountStillInUse();
  }
});
