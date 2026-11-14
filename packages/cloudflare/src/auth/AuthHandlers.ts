import { SurveyBeatApi } from "@surveybeat/api";
import {
  checkSession,
  chooseOrganization,
  createOrganization,
  Forbidden,
  IdentityProvider,
  type NewIds,
  type OrganizationCreationAllowlist,
  type OrganizationPeople,
  type PeopleIndex,
  sealedChanged,
  type SessionOutcome,
  sessionState,
  signInWithCode,
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
export const STATE_COOKIE = "__Host-surveybeat-auth-state";

const SESSION_MAX_AGE = "30 days";
const STATE_MAX_AGE = "10 minutes";
const cookieOptions = { path: "/", httpOnly: true, secure: true, sameSite: "lax" } as const;

export type AuthServices = IdentityProvider | PeopleIndex | OrganizationPeople | NewIds;

export interface AuthHandlerOptions<R> {
  readonly services: Effect.Effect<Context.Context<AuthServices>, never, R>;
  readonly allowlist: Effect.Effect<OrganizationCreationAllowlist, never, R>;
}

const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );

export const requestOrigin = Effect.map(HttpServerRequest, (request) =>
  URL.canParse(request.originalUrl)
    ? new URL(request.originalUrl).origin
    : Option.match(toURL(request), { onNone: () => "http://localhost", onSome: (url) => url.origin }),
);

const sealedFromRequest = Effect.map(HttpServerRequest, (request) =>
  Option.map(Option.fromNullishOr(request.cookies[SESSION_COOKIE]), Redacted.make),
);

const setSessionCookie = (sealed: Redacted.Redacted<string>) =>
  HttpEffect.appendPreResponseHandler((_request, response) =>
    HttpServerResponse.setCookie(response, SESSION_COOKIE, Redacted.value(sealed), {
      ...cookieOptions,
      maxAge: SESSION_MAX_AGE,
    }).pipe(Effect.orDie),
  );

const expireSessionCookie = HttpEffect.appendPreResponseHandler((_request, response) =>
  HttpServerResponse.expireCookie(response, SESSION_COOKIE, cookieOptions).pipe(Effect.orDie),
);

export const requireSameOrigin = Effect.gen(function* () {
  const request = yield* HttpServerRequest;
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== (yield* requestOrigin)) return yield* new Forbidden();
});

const authenticated = Effect.gen(function* () {
  const sealed = yield* sealedFromRequest;
  if (Option.isNone(sealed)) return yield* new Unauthenticated();
  return yield* checkSession(sealed.value).pipe(
    Effect.tapError((error) => (error._tag === "Unauthenticated" ? expireSessionCookie : Effect.void)),
    Effect.map((checked) => ({ sealed: sealed.value, checked })),
  );
});

export const currentMember = Effect.gen(function* () {
  const { sealed, checked } = yield* authenticated;
  if (sealedChanged(sealed, checked.session)) yield* setSessionCookie(checked.session.sealed);
  if (Option.isNone(checked.member)) return yield* new Forbidden();
  return checked.member.value;
});

const respond = (sealed: Redacted.Redacted<string>, outcome: SessionOutcome) =>
  Effect.gen(function* () {
    if (sealedChanged(sealed, outcome.session)) yield* setSessionCookie(outcome.session.sealed);
    return outcome.state;
  });

export const authHandlers = <R>({ services, allowlist }: AuthHandlerOptions<R>) => {
  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(services, (context) => Effect.provideContext(effect, context));
  return HttpApiBuilder.group(SurveyBeatApi, "auth", (handlers) =>
    handlers
      .handle("login", () =>
        provide(
          Effect.gen(function* () {
            const identityProvider = yield* IdentityProvider;
            const state = randomToken();
            const url = identityProvider.authorizationUrl({
              redirectUri: `${yield* requestOrigin}/auth/callback`,
              state,
            });
            return yield* HttpServerResponse.redirect(url).pipe(
              HttpServerResponse.setCookie(STATE_COOKIE, state, { ...cookieOptions, maxAge: STATE_MAX_AGE }),
              Effect.orDie,
            );
          }),
        ),
      )
      .handle("callback", ({ query }) =>
        provide(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest;
            const expected = request.cookies[STATE_COOKIE];
            const home = `${yield* requestOrigin}/`;
            const back = (location: string) =>
              HttpServerResponse.redirect(location).pipe(
                HttpServerResponse.expireCookie(STATE_COOKIE, cookieOptions),
                Effect.orDie,
              );
            if (query.code === undefined || expected === undefined || query.state !== expected) {
              return yield* back(`${home}?signin=failed`);
            }
            const session = yield* signInWithCode(query.code).pipe(Effect.option);
            if (Option.isNone(session)) return yield* back(`${home}?signin=failed`);
            return yield* back(home).pipe(
              Effect.flatMap(
                HttpServerResponse.setCookie(SESSION_COOKIE, Redacted.value(session.value.sealed), {
                  ...cookieOptions,
                  maxAge: SESSION_MAX_AGE,
                }),
              ),
              Effect.orDie,
            );
          }),
        ),
      )
      .handle("logout", () =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            yield* expireSessionCookie;
            const home = `${yield* requestOrigin}/`;
            const sealed = yield* sealedFromRequest;
            const logoutUrl = Option.isNone(sealed)
              ? Option.none<string>()
              : yield* signOut(sealed.value, home);
            return HttpServerResponse.redirect(
              Option.getOrElse(logoutUrl, () => home),
              { status: 303 },
            );
          }),
        ),
      )
      .handle("session", () =>
        provide(
          Effect.gen(function* () {
            const { sealed, checked } = yield* authenticated;
            return yield* sessionState(checked, yield* allowlist).pipe(
              Effect.flatMap((outcome) => respond(sealed, outcome)),
              Effect.catchTag("Forbidden", () => Effect.succeed({ _tag: "NotInOrganization" } as const)),
            );
          }),
        ),
      )
      .handle("createOrganization", ({ payload }) =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const { sealed, checked } = yield* authenticated;
            return yield* respond(sealed, yield* createOrganization(checked, payload.name, yield* allowlist));
          }),
        ),
      )
      .handle("chooseOrganization", ({ payload }) =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const { sealed, checked } = yield* authenticated;
            return yield* respond(sealed, yield* chooseOrganization(checked, payload.organizationId));
          }),
        ),
      ),
  );
};
