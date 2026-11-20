import { SESSION_COOKIE } from "@surveybeat/auth";
import {
  AuthUnavailable,
  AuthUserId,
  identityOf,
  SessionId,
  SessionIdentityProvider,
  SignInAgainRequired,
  Unauthenticated,
  WrongEmailCode,
} from "@surveybeat/domain";
import type { OrganizationId } from "@surveybeat/domain";
import type { Auth } from "better-auth";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

const authOrigin = "http://localhost:5173";

const authRequest = (path: string, body: unknown, cookie?: Redacted.Redacted) =>
  new Request(`${authOrigin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: authOrigin,
      ...(cookie === undefined ? {} : { cookie: `${SESSION_COOKIE}=${Redacted.value(cookie)}` }),
    },
    body: JSON.stringify(body),
  });

const sessionTokenFromCookie = (header: string): string => {
  const pair = header.split(";")[0] ?? "";

  return Option.getOrElse(Option.fromNullishOr(pair.split("=").slice(1).join("=")), () => "");
};

const WRONG_CODE_ERRORS = new Set(["INVALID_OTP", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"]);

const SIGN_IN_AGAIN_ERRORS = new Set(["SESSION_NOT_FRESH", "SESSION_EXPIRED", "UNAUTHORIZED"]);

const refusalCode = (response: Response): Effect.Effect<unknown> =>
  Effect.tryPromise({
    try: () => response.json(),
    catch: () => new AuthUnavailable(),
  }).pipe(
    Effect.map((body) => (typeof body === "object" && body !== null && "code" in body ? body.code : null)),
    Effect.orElseSucceed(() => null),
  );

const refusalOf = (code: unknown): SignInAgainRequired | WrongEmailCode | AuthUnavailable => {
  if (typeof code !== "string") {
    return new AuthUnavailable();
  }

  if (SIGN_IN_AGAIN_ERRORS.has(code)) {
    return new SignInAgainRequired();
  }

  return WRONG_CODE_ERRORS.has(code) ? new WrongEmailCode() : new AuthUnavailable();
};

const emailChange = (
  auth: Pick<Auth, "handler">,
  path: string,
  body: unknown,
  cookie: Redacted.Redacted,
): Effect.Effect<Response, SignInAgainRequired | WrongEmailCode | AuthUnavailable> =>
  Effect.tryPromise({
    try: () => auth.handler(authRequest(path, body, cookie)),
    catch: () => new AuthUnavailable(),
  }).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : refusalCode(response).pipe(Effect.flatMap((code) => Effect.fail(refusalOf(code)))),
    ),
  );

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
              if (!response.ok) {
                throw new Error(`send-verification-otp answered ${response.status}`);
              }

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

    requestEmailChange: (cookie, email) =>
      emailChange(params.auth, "/auth/email-otp/request-email-change", { newEmail: email }, cookie).pipe(
        Effect.mapError((refused) => (refused._tag === "WrongEmailCode" ? new AuthUnavailable() : refused)),
        Effect.asVoid,
      ),

    confirmEmailChange: (cookie, email, code) =>
      emailChange(params.auth, "/auth/email-otp/change-email", { newEmail: email, otp: code }, cookie).pipe(
        Effect.map((response) =>
          Option.map(Option.fromNullishOr(response.headers.get("set-cookie")), sessionTokenFromCookie),
        ),
      ),

    revokeSession: (sessionId) => params.deleteSession(sessionId),
  });
