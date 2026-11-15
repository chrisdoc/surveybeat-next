import { SurveyBeatApi } from "@surveybeat/api";
import {
  checkSession,
  chooseOrganization,
  createOrganization,
  Forbidden,
  type NewIds,
  type OrganizationCreationAllowlist,
  type OrganizationPeople,
  type PeopleIndex,
  type SessionOutcome,
  sessionState,
  SessionIdentityProvider,
  signOut,
  Unauthenticated,
} from "@surveybeat/domain";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpEffect from "effect/http/HttpEffect";
import { HttpServerRequest, toURL } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

export const SESSION_COOKIE = "__Host-surveybeat-session";

const SESSION_MAX_AGE = "30 days";
const cookieOptions = { path: "/", httpOnly: true, secure: true, sameSite: "lax" } as const;

export type AuthServices = SessionIdentityProvider | PeopleIndex | OrganizationPeople | NewIds;

export interface AuthHandlerOptions<R> {
  readonly services: Effect.Effect<Context.Context<AuthServices>, never, R>;
  readonly allowlist: Effect.Effect<OrganizationCreationAllowlist, never, R>;
}

export const requestOrigin = Effect.map(HttpServerRequest, (request) =>
  URL.canParse(request.originalUrl)
    ? new URL(request.originalUrl).origin
    : Option.match(toURL(request), { onNone: () => "http://localhost", onSome: (url) => url.origin }),
);

const sessionCookie = Effect.map(HttpServerRequest, (request) =>
  Option.map(Option.fromNullishOr(request.cookies[SESSION_COOKIE]), Redacted.make),
);

const expireSessionCookie = HttpEffect.appendPreResponseHandler((_request, response) =>
  HttpServerResponse.expireCookie(response, SESSION_COOKIE, cookieOptions).pipe(Effect.orDie),
);

export const requireSameOrigin = Effect.gen(function* () {
  const request = yield* HttpServerRequest;
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== (yield* requestOrigin)) return yield* new Forbidden();
});

const setSessionCookie = (token: Redacted.Redacted<string>) =>
  HttpEffect.appendPreResponseHandler((_request, response) =>
    HttpServerResponse.setCookie(response, SESSION_COOKIE, Redacted.value(token), {
      ...cookieOptions,
      maxAge: SESSION_MAX_AGE,
    }).pipe(Effect.orDie),
  );

const authenticated = Effect.gen(function* () {
  const cookie = yield* sessionCookie;
  if (Option.isNone(cookie)) return yield* new Unauthenticated();
  return yield* checkSession(cookie.value).pipe(
    Effect.tapError((error) => (error._tag === "Unauthenticated" ? expireSessionCookie : Effect.void)),
  );
});

export const currentMember = Effect.gen(function* () {
  const checked = yield* authenticated;
  if (Option.isNone(checked.member)) return yield* new Forbidden();
  return checked.member.value;
});

const respond = (outcome: SessionOutcome) => Effect.succeed(outcome.state);

export const authHandlers = <R>({ services, allowlist }: AuthHandlerOptions<R>) => {
  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(services, (context) => Effect.provideContext(effect, context));
  return HttpApiBuilder.group(SurveyBeatApi, "auth", (handlers) =>
    handlers
      .handle("login", () =>
        provide(
          Effect.gen(function* () {
            const home = `${yield* requestOrigin}/`;
            return HttpServerResponse.redirect(home);
          }),
        ),
      )
      .handle("sendSignInCode", ({ payload }) =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const sessions = yield* SessionIdentityProvider;
            yield* sessions.sendSignInCode(payload.email);
          }),
        ),
      )
      .handle("verifySignInCode", ({ payload }) =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const sessions = yield* SessionIdentityProvider;
            const token = yield* sessions.verifySignInCode(payload.email, payload.code);
            if (Option.isSome(token)) {
              yield* setSessionCookie(Redacted.make(token.value));
            }
            return { verified: Option.isSome(token) };
          }),
        ),
      )
      .handle("logout", () =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            yield* expireSessionCookie;
            const cookie = yield* sessionCookie;
            if (Option.isSome(cookie)) yield* signOut(cookie.value);
            const home = `${yield* requestOrigin}/`;
            return HttpServerResponse.redirect(home, { status: 303 });
          }),
        ),
      )
      .handle("session", () =>
        provide(
          Effect.gen(function* () {
            const checked = yield* authenticated;
            return yield* sessionState(checked, yield* allowlist).pipe(
              Effect.flatMap(respond),
              Effect.catchTag("Forbidden", () => Effect.succeed({ _tag: "NotInOrganization" } as const)),
            );
          }),
        ),
      )
      .handle("createOrganization", ({ payload }) =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const checked = yield* authenticated;
            return yield* respond(yield* createOrganization(checked, payload.name, yield* allowlist));
          }),
        ),
      )
      .handle("chooseOrganization", ({ payload }) =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const checked = yield* authenticated;
            return yield* respond(yield* chooseOrganization(checked, payload.organizationId));
          }),
        ),
      ),
  );
};
