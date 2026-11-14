import { Context, type Effect, type Option, type Redacted } from "effect";
import type { EmailAddress } from "../email/Email.ts";
import type { Identity, PersonId, SessionId, WorkosOrganizationId, WorkosUserId } from "./Identity.ts";
import type { Locale } from "./Locale.ts";
import type { OrganizationId } from "./Organization.ts";
import type { MembershipId, TeamId } from "./Team.ts";
import type { AuthUnavailable, OrganizationSummary, PersonCandidate, Unauthenticated } from "./SignIn.ts";
import type { PulseId } from "../pulses/Pulse.ts";
import type { QuestionId } from "../pulses/Question.ts";

export interface ProviderSession {
  readonly sealed: Redacted.Redacted<string>;
  readonly sessionId: SessionId;
  readonly identity: Identity;

  readonly workosOrganizationId: Option.Option<WorkosOrganizationId>;

  readonly role: Option.Option<string>;
}

export type SessionCheck =
  | { readonly _tag: "Valid"; readonly session: ProviderSession }
  | { readonly _tag: "Expired" }
  | { readonly _tag: "Invalid" };

export type OrganizationRole = "admin" | "member";

export type CodeExchange =
  | { readonly _tag: "Authenticated"; readonly session: ProviderSession }
  | {
      readonly _tag: "OrganizationSelectionRequired";
      readonly pendingAuthenticationToken: Redacted.Redacted<string>;

      readonly userId: Option.Option<WorkosUserId>;
      readonly organizations: ReadonlyArray<WorkosOrganizationId>;
    };

export interface IdentityProviderShape {
  readonly authorizationUrl: (options: { readonly redirectUri: string; readonly state: string }) => string;

  readonly authenticateWithCode: (
    code: string,
  ) => Effect.Effect<CodeExchange, Unauthenticated | AuthUnavailable>;

  readonly authenticateWithOrganizationSelection: (
    pendingAuthenticationToken: Redacted.Redacted<string>,
    organization: WorkosOrganizationId,
  ) => Effect.Effect<ProviderSession, Unauthenticated | AuthUnavailable>;

  readonly authenticate: (sealed: Redacted.Redacted<string>) => Effect.Effect<SessionCheck, AuthUnavailable>;

  readonly refresh: (
    sealed: Redacted.Redacted<string>,
    organization: Option.Option<WorkosOrganizationId>,
  ) => Effect.Effect<ProviderSession, Unauthenticated | AuthUnavailable>;

  readonly logoutUrl: (sessionId: SessionId, returnTo: string) => string;

  readonly revokeSession: (sessionId: SessionId) => Effect.Effect<void, AuthUnavailable>;

  readonly createOrganization: (
    name: string,
    externalId: OrganizationId,
  ) => Effect.Effect<WorkosOrganizationId, AuthUnavailable>;

  readonly ensureMembership: (
    userId: WorkosUserId,
    organization: WorkosOrganizationId,
    role: OrganizationRole,
  ) => Effect.Effect<void, AuthUnavailable>;

  readonly setMembershipRole: (
    userId: WorkosUserId,
    organization: WorkosOrganizationId,
    role: OrganizationRole,
  ) => Effect.Effect<void, AuthUnavailable>;

  readonly deactivateMembership: (
    userId: WorkosUserId,
    organization: WorkosOrganizationId,
  ) => Effect.Effect<void, AuthUnavailable>;
}

export class IdentityProvider extends Context.Service<IdentityProvider, IdentityProviderShape>()(
  "@surveybeat/domain/IdentityProvider",
) {}

export interface OrganizationClaim {
  readonly organization: OrganizationSummary;
  readonly adminPersonId: PersonId;
}

export interface ClaimStatus extends OrganizationClaim {
  readonly completed: boolean;
}

export interface PeopleIndexShape {
  readonly linkedPersons: (userId: WorkosUserId) => Effect.Effect<ReadonlyArray<PersonCandidate>>;
  readonly unlinkedPersons: (email: EmailAddress) => Effect.Effect<ReadonlyArray<PersonCandidate>>;

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

  readonly putPerson: (person: {
    readonly organizationId: OrganizationId;
    readonly personId: PersonId;
    readonly email: EmailAddress;
    readonly userId: Option.Option<WorkosUserId>;
  }) => Effect.Effect<void>;

  readonly removePerson: (organizationId: OrganizationId, personId: PersonId) => Effect.Effect<void>;

  readonly linkPerson: (
    organizationId: OrganizationId,
    personId: PersonId,
    userId: WorkosUserId,
  ) => Effect.Effect<void>;

  readonly claimOrganization: (
    userId: WorkosUserId,
    proposed: OrganizationClaim,
  ) => Effect.Effect<ClaimStatus>;
  readonly claimOf: (userId: WorkosUserId) => Effect.Effect<Option.Option<ClaimStatus>>;

  readonly completeClaim: (userId: WorkosUserId, now: number) => Effect.Effect<void>;
  readonly revokeSession: (sessionId: SessionId, now: number) => Effect.Effect<void>;
  readonly isSessionRevoked: (sessionId: SessionId) => Effect.Effect<boolean>;
}

export class PeopleIndex extends Context.Service<PeopleIndex, PeopleIndexShape>()(
  "@surveybeat/domain/PeopleIndex",
) {}

export interface OrganizationPeopleShape {
  readonly createWithAdmin: (
    organization: OrganizationSummary,
    admin: { readonly personId: PersonId; readonly email: EmailAddress; readonly userId: WorkosUserId },
  ) => Effect.Effect<void>;

  readonly linkPerson: (
    organizationId: OrganizationId,
    personId: PersonId,
    userId: WorkosUserId,
    email: EmailAddress,
  ) => Effect.Effect<boolean>;

  readonly activePerson: (
    organizationId: OrganizationId,
    userId: WorkosUserId,
  ) => Effect.Effect<Option.Option<ActivePerson>>;
}

export interface ActivePerson {
  readonly personId: PersonId;
  readonly organizationAdmin: boolean;

  readonly locale: Locale | null;

  readonly detectedLocale: Locale | null;

  readonly organizationLocale: Locale;
}

export class OrganizationPeople extends Context.Service<OrganizationPeople, OrganizationPeopleShape>()(
  "@surveybeat/domain/OrganizationPeople",
) {}

export interface NewIdsShape {
  readonly organizationId: Effect.Effect<OrganizationId>;
  readonly personId: Effect.Effect<PersonId>;
  readonly teamId: Effect.Effect<TeamId>;
  readonly membershipId: Effect.Effect<MembershipId>;
  readonly pulseId: Effect.Effect<PulseId>;
  readonly questionId: Effect.Effect<QuestionId>;
}

export class NewIds extends Context.Service<NewIds, NewIdsShape>()("@surveybeat/domain/NewIds") {}
