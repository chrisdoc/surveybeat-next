import { Context, type Effect, type Redacted } from "effect";
import type { Identity, SessionId } from "./Identity.ts";
import type { AuthUnavailable, Unauthenticated } from "./SignIn.ts";

export interface SignedInSession {
  readonly identity: Identity;
  readonly sessionId: SessionId;
}

export interface SessionIdentityProviderShape {
  readonly authenticate: (
    cookie: Redacted.Redacted<string>,
  ) => Effect.Effect<SignedInSession, Unauthenticated | AuthUnavailable>;

  readonly revokeSession: (sessionId: SessionId) => Effect.Effect<void, AuthUnavailable>;
}

export class SessionIdentityProvider extends Context.Service<
  SessionIdentityProvider,
  SessionIdentityProviderShape
>()("@surveybeat/domain/SessionIdentityProvider") {}
