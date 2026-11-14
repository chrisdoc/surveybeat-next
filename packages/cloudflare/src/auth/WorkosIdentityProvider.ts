// @effect-diagnostics asyncFunction:off -- the WorkOS SDK is promise-based; this wraps one SDK call before it becomes an Effect.

import {
  AuthUnavailable,
  type CodeExchange,
  IdentityProvider,
  type OrganizationRole,
  identityOf,
  type ProviderSession,
  SessionId,
  type SessionCheck,
  Unauthenticated,
  WorkosOrganizationId,
  WorkosUserId,
} from "@surveybeat/domain";
import {
  AuthenticationException,
  ConflictException,
  NotFoundException,
  type User,
  WorkOS,
} from "@workos-inc/node/worker";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { withProviderDeadline } from "./ProviderDeadline.ts";

export interface WorkosConfig {
  readonly apiKey: Redacted.Redacted<string>;
  readonly clientId: string;
  readonly cookiePassword: Redacted.Redacted<string>;
  readonly requestTimeout: Duration.Duration;
}

const statusOf = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : undefined;

const isRefusal = (error: unknown): boolean => {
  const status = statusOf(error);
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
};

class MalformedCookie extends Data.TaggedError("MalformedCookie") {}

const isNetworkFailure = (error: unknown): boolean => {
  if (error instanceof TypeError) return true;
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && typeof error.code === "string" && /^ERR_JWKS|^ERR_JOSE_GENERIC/.test(error.code)) {
    return true;
  }
  const status = statusOf(error);
  return status !== undefined && (status >= 500 || status === 408 || status === 429);
};

const callWith =
  (timeout: Duration.Duration) =>
  <A>(f: () => Promise<A>) =>
    withProviderDeadline(Effect.tryPromise({ try: f, catch: () => new AuthUnavailable() }), timeout);

const authCallWith =
  (timeout: Duration.Duration) =>
  <A>(f: () => Promise<A>) =>
    withProviderDeadline(
      Effect.tryPromise({
        try: f,
        catch: (error) => (isRefusal(error) ? new Unauthenticated() : new AuthUnavailable()),
      }),
      timeout,
    );

const toSession = (
  sealed: string,
  claims: {
    readonly sessionId: string;
    readonly organizationId?: string | undefined;
    readonly role?: string | undefined;
    readonly user: User;
  },
): ProviderSession => ({
  sealed: Redacted.make(sealed),
  sessionId: SessionId.make(claims.sessionId),
  identity: identityOf(WorkosUserId.make(claims.user.id), claims.user.email, claims.user.emailVerified),
  workosOrganizationId: Option.map(Option.fromNullishOr(claims.organizationId), (id) =>
    WorkosOrganizationId.make(id),
  ),
  role: Option.fromNullishOr(claims.role),
});

export const workosIdentityProvider = (config: WorkosConfig) => {
  const workos = new WorkOS(Redacted.value(config.apiKey), { clientId: config.clientId });
  const users = workos.userManagement;
  const cookiePassword = Redacted.value(config.cookiePassword);
  const call = callWith(config.requestTimeout);
  const authCall = authCallWith(config.requestTimeout);

  const load = (sealed: string) => users.loadSealedSession({ sessionData: sealed, cookiePassword });

  const verified = (sealed: string) =>
    call(() => load(sealed).authenticate()).pipe(
      Effect.flatMap((result) =>
        result.authenticated ? Effect.succeed(toSession(sealed, result)) : Effect.fail(new AuthUnavailable()),
      ),
    );

  const sealedResponse = (response: { readonly sealedSession?: string | undefined }) =>
    response.sealedSession === undefined
      ? Effect.fail(new AuthUnavailable())
      : verified(response.sealedSession);

  const authenticateWithCode = (code: string) =>
    authCall(async () => {
      try {
        return await users.authenticateWithCode({
          code,
          clientId: config.clientId,
          session: { sealSession: true, cookiePassword },
        });
      } catch (error) {
        if (
          error instanceof AuthenticationException &&
          error.code === "organization_selection_required" &&
          error.pendingAuthenticationToken !== undefined
        ) {
          return {
            _tag: "OrganizationSelectionRequired",
            pendingAuthenticationToken: Redacted.make(error.pendingAuthenticationToken),
            userId: Option.map(Option.fromNullishOr(error.rawData.user?.id), (id) => WorkosUserId.make(id)),
            organizations: (error.rawData.organizations ?? []).map((organization) =>
              WorkosOrganizationId.make(organization.id),
            ),
          } satisfies CodeExchange;
        }
        throw error;
      }
    }).pipe(
      Effect.filterOrElse(
        (response) => "_tag" in response,
        (response) =>
          Effect.map(sealedResponse(response), (session) => ({ _tag: "Authenticated" as const, session })),
      ),
    );

  const membershipOf = (userId: string, organizationId: string) =>
    call(() => users.listOrganizationMemberships({ userId, organizationId })).pipe(
      Effect.map((memberships) => memberships.data[0]),
    );

  const setRole = (membershipId: string, role: OrganizationRole) =>
    call(() => users.updateOrganizationMembership(membershipId, { roleSlug: role })).pipe(Effect.asVoid);

  return IdentityProvider.of({
    authorizationUrl: ({ redirectUri, state }) =>
      users.getAuthorizationUrl({ provider: "authkit", clientId: config.clientId, redirectUri, state }),

    authenticateWithCode,

    authenticateWithOrganizationSelection: (pendingAuthenticationToken, organizationId) =>
      authCall(() =>
        users.authenticateWithOrganizationSelection({
          clientId: config.clientId,
          pendingAuthenticationToken: Redacted.value(pendingAuthenticationToken),
          organizationId,
          session: { sealSession: true, cookiePassword },
        }),
      ).pipe(Effect.flatMap(sealedResponse)),

    authenticate: (sealed) =>
      withProviderDeadline(
        Effect.tryPromise({
          try: () => load(Redacted.value(sealed)).authenticate(),
          catch: (error) => (isNetworkFailure(error) ? new AuthUnavailable() : new MalformedCookie()),
        }),
        config.requestTimeout,
      ).pipe(
        Effect.map((result): SessionCheck => {
          if (result.authenticated)
            return { _tag: "Valid", session: toSession(Redacted.value(sealed), result) };
          return result.reason === "invalid_jwt" ? { _tag: "Expired" } : { _tag: "Invalid" };
        }),
        Effect.catchTag("MalformedCookie", () => Effect.succeed<SessionCheck>({ _tag: "Invalid" })),
      ),

    refresh: (sealed, organization) =>
      call(() =>
        load(Redacted.value(sealed)).refresh(
          Option.match(organization, {
            onNone: () => ({}),
            onSome: (organizationId) => ({ organizationId }),
          }),
        ),
      ).pipe(
        Effect.flatMap((result): Effect.Effect<ProviderSession, Unauthenticated | AuthUnavailable> => {
          if (!result.authenticated) {
            return result.retryable ? Effect.fail(new AuthUnavailable()) : Effect.fail(new Unauthenticated());
          }
          return result.sealedSession === undefined
            ? Effect.fail(new AuthUnavailable())
            : Effect.succeed(toSession(result.sealedSession, result));
        }),
      ),

    logoutUrl: (sessionId, returnTo) => users.getLogoutUrl({ sessionId, returnTo }),

    revokeSession: (sessionId) =>
      call(() =>
        users.revokeSession({ sessionId }).catch((error: unknown) => {
          if (isRefusal(error)) return undefined;
          throw error;
        }),
      ).pipe(Effect.asVoid),

    createOrganization: (name, externalId) => {
      const byExternalId = call(() =>
        workos.organizations.getOrganizationByExternalId(externalId).catch((error: unknown) => {
          if (error instanceof NotFoundException) return undefined;
          throw error;
        }),
      );
      const create = call(() =>
        workos.organizations
          .createOrganization(
            { name, externalId },
            { idempotencyKey: `surveybeat-organization-${externalId}` },
          )
          .catch((error: unknown) => {
            if (error instanceof ConflictException) return undefined;
            throw error;
          }),
      );
      return Effect.gen(function* () {
        const existing = (yield* byExternalId) ?? (yield* create) ?? (yield* byExternalId);
        if (existing === undefined) return yield* new AuthUnavailable();
        return WorkosOrganizationId.make(existing.id);
      });
    },

    ensureMembership: (userId, organizationId, role) =>
      Effect.gen(function* () {
        const existing = yield* membershipOf(userId, organizationId);
        if (existing === undefined) {
          yield* call(() =>
            users
              .createOrganizationMembership({ userId, organizationId, roleSlug: role })
              .catch((error: unknown) => {
                if (error instanceof ConflictException) return undefined;
                throw error;
              }),
          );
          return;
        }
        if (existing.status === "inactive") {
          yield* call(() => users.reactivateOrganizationMembership(existing.id));
        }
        if (existing.role.slug !== role) yield* setRole(existing.id, role);
      }),

    setMembershipRole: (userId, organizationId, role) =>
      Effect.gen(function* () {
        const existing = yield* membershipOf(userId, organizationId);
        if (existing !== undefined && existing.role.slug !== role) yield* setRole(existing.id, role);
      }),

    deactivateMembership: (userId, organizationId) =>
      Effect.gen(function* () {
        const existing = yield* membershipOf(userId, organizationId);
        if (existing?.status === "active" || existing?.status === "pending") {
          yield* call(() =>
            users.deactivateOrganizationMembership(existing.id).catch((error: unknown) => {
              if (isRefusal(error)) return undefined;
              throw error;
            }),
          );
        }
      }),
  });
};
