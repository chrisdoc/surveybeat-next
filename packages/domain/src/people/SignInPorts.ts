import { Context } from "effect";
import type { Effect, Option } from "effect";
import type { EmailAddress, SendId } from "../email/Email.ts";
import type { AuthUserId, PersonId } from "./Identity.ts";
import type { Locale } from "./Locale.ts";
import type { OrganizationId } from "./Organization.ts";
import type { MembershipId, TeamId } from "./Team.ts";
import type { OrganizationSummary, PersonCandidate } from "./SignIn.ts";
import type { PulseId } from "../pulses/Pulse.ts";
import type { QuestionId } from "../pulses/Question.ts";

export interface OrganizationClaim {
  readonly organization: OrganizationSummary;
  readonly adminPersonId: PersonId;
}

export interface ClaimStatus extends OrganizationClaim {
  readonly completed: boolean;
}

export interface PeopleIndexShape {
  readonly linkedPersons: (userId: AuthUserId) => Effect.Effect<readonly PersonCandidate[]>;
  readonly unlinkedPersons: (email: EmailAddress) => Effect.Effect<readonly PersonCandidate[]>;

  readonly putOrganization: (organization: OrganizationSummary) => Effect.Effect<void>;

  readonly putPerson: (person: {
    readonly organizationId: OrganizationId;
    readonly personId: PersonId;
    readonly email: EmailAddress;
    readonly userId: Option.Option<AuthUserId>;
  }) => Effect.Effect<void>;

  readonly removePerson: (organizationId: OrganizationId, personId: PersonId) => Effect.Effect<void>;

  readonly linkPerson: (
    organizationId: OrganizationId,
    personId: PersonId,
    userId: AuthUserId,
  ) => Effect.Effect<void>;

  readonly erasePerson: (erased: {
    readonly organizationId: OrganizationId;
    readonly personId: PersonId;
    readonly userId: Option.Option<AuthUserId>;
    readonly sendIds: readonly SendId[];
    readonly testTokenHashes: readonly string[];
  }) => Effect.Effect<void>;

  readonly eraseAccount: (userId: AuthUserId) => Effect.Effect<boolean>;

  readonly claimOrganization: (userId: AuthUserId, proposed: OrganizationClaim) => Effect.Effect<ClaimStatus>;
  readonly claimOf: (userId: AuthUserId) => Effect.Effect<Option.Option<ClaimStatus>>;

  readonly completeClaim: (userId: AuthUserId, now: number) => Effect.Effect<void>;
}

export class PeopleIndex extends Context.Service<PeopleIndex, PeopleIndexShape>()(
  "@surveybeat/domain/PeopleIndex",
) {}

export interface OrganizationPeopleShape {
  readonly createWithAdmin: (
    organization: OrganizationSummary,
    admin: { readonly personId: PersonId; readonly email: EmailAddress; readonly userId: AuthUserId },
  ) => Effect.Effect<void>;

  readonly linkPerson: (
    organizationId: OrganizationId,
    personId: PersonId,
    userId: AuthUserId,
    email: EmailAddress,
  ) => Effect.Effect<boolean>;

  readonly activePerson: (
    organizationId: OrganizationId,
    userId: AuthUserId,
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
