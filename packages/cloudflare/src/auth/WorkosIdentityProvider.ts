import {
  AuthUnavailable,
  type CodeExchange,
  IdentityProvider,
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
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

/** What the adapter needs per stage. All three come from Worker secrets (`AuthConfig.ts`). */
export interface WorkosConfig {
  readonly apiKey: Redacted.Redacted<string>;
  readonly clientId: string;
  /** Seals the session cookie (iron-webcrypto). At least 32 characters. */
  readonly cookiePassword: Redacted.Redacted<string>;
}

/** The HTTP status a WorkOS SDK error carries, if any. */
const statusOf = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : undefined;

/** A 4xx other than 408 and 429 means the request itself was refused; anything else is transient. */
const isRefusal = (error: unknown): boolean => {
  const status = statusOf(error);
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
};

class MalformedCookie extends Data.TaggedError("MalformedCookie") {}

/** `fetch` failures, timeouts, and `jose`'s JWKS errors: the identity provider is out of reach. */
const isNetworkFailure = (error: unknown): boolean => {
  if (error instanceof TypeError) return true;
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && typeof error.code === "string" && /^ERR_JWKS|^ERR_JOSE_GENERIC/.test(error.code)) {
    return true;
  }
  const status = statusOf(error);
  return status !== undefined && (status >= 500 || status === 408 || status === 429);
};

/** Calls that only fail when WorkOS cannot be reached or misbehaves. */
const call = <A>(f: () => Promise<A>) => Effect.tryPromise({ try: f, catch: () => new AuthUnavailable() });

/** Calls where a refusal means the user must sign in again. */
const authCall = <A>(f: () => Promise<A>) =>
  Effect.tryPromise({
    try: f,
    catch: (error) => (isRefusal(error) ? new Unauthenticated() : new AuthUnavailable()),
  });

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

/**
 * `IdentityProvider` on `@workos-inc/node`'s workerd build (fetch and Web Crypto, with
 * `iron-webcrypto` and `jose` inlined). Construct it once per isolate: the SDK caches the JWKS on
 * the client, so per-request checks stay local.
 */
export const workosIdentityProvider = (config: WorkosConfig) => {
  const workos = new WorkOS(Redacted.value(config.apiKey), { clientId: config.clientId });
  const users = workos.userManagement;
  const cookiePassword = Redacted.value(config.cookiePassword);

  const load = (sealed: string) => users.loadSealedSession({ sessionData: sealed, cookiePassword });

  /** Unseals and verifies a cookie we just sealed. Anything but success here is WorkOS misbehaving. */
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
        // A user with several WorkOS memberships may be asked to pick one. The sign-in flow picks
        // (`signInWithCode`), since only it knows where the user is still a Person.
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
      Effect.flatMap((response): Effect.Effect<CodeExchange, AuthUnavailable> =>
        "_tag" in response
          ? Effect.succeed(response)
          : Effect.map(sealedResponse(response), (session) => ({ _tag: "Authenticated", session })),
      ),
    );

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
      Effect.tryPromise({
        try: () => load(Redacted.value(sealed)).authenticate(),
        // A throw is either the JWKS being unreachable (keep the session, answer 503) or a cookie
        // too malformed to unseal (sign in again). Only recognisable network failures are the former.
        catch: (error) => (isNetworkFailure(error) ? new AuthUnavailable() : new MalformedCookie()),
      }).pipe(
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
          // Only a terminal failure (`invalid_grant`, a bad cookie) signs the user out. Timeouts,
          // 429, and 5xx keep the session (the 30-second replay window makes retries converge).
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
          // Already ended or unknown: what revoking wants.
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
            // Created by a concurrent request since we looked: read that one.
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
        const memberships = yield* call(() => users.listOrganizationMemberships({ userId, organizationId }));
        const existing = memberships.data[0];
        if (existing === undefined) {
          yield* call(() =>
            users
              .createOrganizationMembership({ userId, organizationId, roleSlug: role })
              .catch((error: unknown) => {
                if (error instanceof ConflictException) return undefined;
                throw error;
              }),
          );
        } else if (existing.status === "inactive") {
          yield* call(() => users.reactivateOrganizationMembership(existing.id));
        }
      }),
  });
};
