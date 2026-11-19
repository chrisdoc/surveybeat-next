import { SESSION_COOKIE } from "@surveybeat/auth";
import {
  AuthUnavailable,
  AuthUserId,
  identityOf,
  SessionId,
  SessionIdentityProvider,
  Unauthenticated,
} from "@surveybeat/domain";
import type { OrganizationId } from "@surveybeat/domain";
import type { Auth } from "better-auth";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

const authOrigin = "http://localhost:5173";

const authRequest = (path: string, body: unknown) =>
  new Request(`${authOrigin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: authOrigin },
    body: JSON.stringify(body),
  });

const sessionTokenFromCookie = (header: string): string => {
  const pair = header.split(";")[0] ?? "";
  return Option.getOrElse(Option.fromNullishOr(pair.split("=").slice(1).join("=")), () => "");
};

export const betterAuthIdentityProvider = (params: {
  readonly auth: Pick<Auth, "api" | "handler">;
  readonly chosenOrganization: (
    sessionId: SessionId,
  ) => Effect.Effect<Option.Option<OrganizationId>, AuthUnavailable>;
  readonly rememberOrganization: (
    sessionId: SessionId,
    organizationId: OrganizationId,
  ) => Effect.Effect<void, AuthUnavailable>;
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
                  AuthUserId.make(session.user.id),
                  session.user.email,
                  session.user.emailVerified,
                ),
                sessionId: SessionId.make(session.session.id),
              }),
        ),
      ),

    chosenOrganization: (sessionId) => params.chosenOrganization(sessionId),

    chooseOrganization: (sessionId, organizationId) => params.rememberOrganization(sessionId, organizationId),

    sendSignInCode: (email) =>
      Effect.tryPromise({
        try: () =>
          params.auth
            .handler(authRequest("/auth/email-otp/send-verification-otp", { email, type: "sign-in" }))
            .then((response) => {
              if (!response.ok) throw new Error(`send-verification-otp answered ${response.status}`);
              return response;
            }),
        catch: () => new AuthUnavailable(),
      }).pipe(Effect.asVoid),

    verifySignInCode: (email, code) =>
      Effect.tryPromise({
        try: () =>
          params.auth
            .handler(authRequest("/auth/sign-in/email-otp", { email, otp: code }))
            .then((response) =>
              response.ok
                ? Option.map(Option.fromNullishOr(response.headers.get("set-cookie")), sessionTokenFromCookie)
                : Option.none<string>(),
            ),
        catch: () => new AuthUnavailable(),
      }),

    revokeSession: (sessionId) => params.deleteSession(sessionId),
  });
