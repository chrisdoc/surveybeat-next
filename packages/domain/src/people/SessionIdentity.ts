import { Context, type Effect, type Option, type Redacted } from "effect";
import type { Identity, SessionId } from "./Identity.ts";
import type { OrganizationId } from "./Organization.ts";
import type { AuthUnavailable, Unauthenticated } from "./SignIn.ts";

export interface SignedInSession {
  readonly identity: Identity;
  readonly sessionId: SessionId;
}

export interface SessionIdentityProviderShape {
  readonly authenticate: (
    cookie: Redacted.Redacted<string>,
  ) => Effect.Effect<SignedInSession, Unauthenticated | AuthUnavailable>;

  readonly chosenOrganization: (
    sessionId: SessionId,
  ) => Effect.Effect<Option.Option<OrganizationId>, AuthUnavailable>;

  readonly chooseOrganization: (
    sessionId: SessionId,
    organizationId: OrganizationId,
  ) => Effect.Effect<void, AuthUnavailable>;

  readonly sendSignInCode: (email: string) => Effect.Effect<void, AuthUnavailable>;

  readonly verifySignInCode: (
    email: string,
    code: string,
  ) => Effect.Effect<Option.Option<string>, AuthUnavailable>;

  readonly revokeSession: (sessionId: SessionId) => Effect.Effect<void, AuthUnavailable>;
}

export class SessionIdentityProvider extends Context.Service<
  SessionIdentityProvider,
  SessionIdentityProviderShape
>()("@surveybeat/domain/SessionIdentityProvider") {}
