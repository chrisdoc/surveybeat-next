import { SESSION_COOKIE } from "@surveybeat/auth";
import {
  AuthUnavailable,
  identityOf,
  SessionId,
  SessionIdentityProvider,
  Unauthenticated,
  WorkosUserId,
} from "@surveybeat/domain";
import type { Auth } from "better-auth";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export const betterAuthIdentityProvider = (params: {
  readonly auth: Auth;
  readonly deleteSession: (sessionId: SessionId) => Effect.Effect<void, AuthUnavailable>;
}) =>
  SessionIdentityProvider.of({
    authenticate: (cookie) =>
      Effect.tryPromise({
        try: () =>
          params.auth.api.getSession({
            headers: new Headers({ cookie: `${SESSION_COOKIE}=${Redacted.value(cookie)}` }),
          }),
        catch: () => new AuthUnavailable(),
      }).pipe(
        Effect.flatMap((session) =>
          session === null
            ? Effect.fail(new Unauthenticated())
            : Effect.succeed({
                identity: identityOf(
                  WorkosUserId.make(session.user.id),
                  session.user.email,
                  session.user.emailVerified,
                ),
                sessionId: SessionId.make(session.session.id),
              }),
        ),
      ),

    revokeSession: (sessionId) => params.deleteSession(sessionId),
  });
