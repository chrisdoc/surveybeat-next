# WorkOS AuthKit from a Cloudflare Worker (no Next.js SDK)

Research for issue #7 (map #1). Context: SPEC.md §5.6 (sign-in, Directory Sync, roles) and §6.1 (the Worker handles the OAuth callback, keeps a session cookie, checks it on every request, and verifies WorkOS webhooks).

Researched 2026-11-07 against `@workos-inc/node` v12.2.0 (released 2026-11-05) and the WorkOS docs.

## TL;DR

- **Use `@workos-inc/node` directly in the Worker.** Its `package.json` has a `workerd` export condition that resolves to `lib/index.worker.mjs`. That build uses `fetch` and Web Crypto (`SubtleCryptoProvider`), and it bundles `iron-webcrypto` and `jose` inline. Wrangler or esbuild picks the `workerd` condition on its own. You can also import `@workos-inc/node/worker` explicitly. Source: [package.json](https://github.com/workos/workos-node/blob/main/package.json), [src/index.worker.ts](https://github.com/workos/workos-node/blob/main/src/index.worker.ts).
- **Everything the spec needs exists in that SDK**: the hosted-UI authorization URL, the code exchange with a sealed cookie, `loadSealedSession().authenticate()` (local JWKS check), `refresh()`, the logout URL, `revokeSession`, organizations, memberships, invitations, and `webhooks.constructEvent`.
- **Catch 1: "magic link" is a code.** AuthKit Magic Auth emails a six-digit one-time code, not a clickable link.
- **Catch 2: revocation is not immediate under local JWT checks.** An access token stays valid until its `exp`, even after its session is revoked. To meet SPEC's "lose access immediately", the Worker needs its own deny check on each request (see §5).
- **Catch 3: self-serve Organizations are app code.** AuthKit does not create an Organization at sign-up. The app does it: create the Organization, create the membership, then refresh with `organizationId`.
- **Optional helper:** `@workos/authkit-session` (v0.9.1, *prerelease*) is a framework-agnostic toolkit that uses `Request`/`Response`, `iron-webcrypto`, `jose`, and `valibot`, and has no Node APIs. It's useful as a reference. Pinning a prerelease is optional. Source: [workos/authkit-session README](https://github.com/workos/authkit-session).

## 1. Packages and the Workers runtime

| Package | Runs in Workers? | Notes |
| --- | --- | --- |
| `@workos-inc/node` ≥ v7.x (current 12.2.0) | **Yes** | Its `exports` map has `workerd`, `edge-light`, and `convex` conditions that point to `lib/index.worker.{mjs,cjs}`, plus an explicit `./worker` subpath. `WorkOSWorker` overrides `createHttpClient` with `FetchHttpClient` and `getCryptoProvider` with `SubtleCryptoProvider`. `inlinedDependencies` contains `iron-webcrypto` 2.0.0, `jose` 6.2.12, and `uint8array-extras`. The repo's `scripts/ecosystem-check.ts` imports the SDK under **miniflare**, and it checks that "the worker entry bundles cleanly without node builtins". [package.json](https://github.com/workos/workos-node/blob/main/package.json), [index.worker.ts](https://github.com/workos/workos-node/blob/main/src/index.worker.ts), [ecosystem-check.ts](https://github.com/workos/workos-node/blob/main/scripts/ecosystem-check.ts) |
| `@workos/authkit-session` 0.9.1 | Yes (by design) | Prerelease ("APIs may change without notice"). Includes `AuthKitCore` (JWKS with caching, session encryption, refresh orchestration), `AuthOperations`, and `CookieSessionStorage<Request, Response>`. [repo](https://github.com/workos/authkit-session) |
| `@workos-inc/authkit-nextjs`, `authkit-remix`, `authkit-react-router`, `authkit-tanstack-start`, `authkit-astro`, `authkit-sveltekit` | Not applicable | Framework glue. SPEC rules out Next.js. |
| `@workos-inc/authkit-js` / `authkit-react` | Browser | Client-side PKCE SDKs that keep the refresh token in the browser. They don't fit, because §6.1 wants the Worker to hold the session. |

WorkOS announced Workers support in 2024. That release replaced Node `http` and `crypto` with Fetch and Web Crypto ([blog](https://workos.com/blog/launch-week-spring-2024-day-4-cloudflare-workers-edge-support)).

**Official Cloudflare examples:** no first-party AuthKit plus plain-Worker sample exists. The closest are:
- [workos/mcp-shop-cloudflare](https://github.com/workos/mcp-shop-cloudflare): an MCP server on Workers with AuthKit OAuth. Relevant to SPEC §5.7's MCP server.
- The 2024 blog's webhook Worker that uses `itty-router` (see §8 for a caveat about its body handling).
- An open PR adding Cloudflare deploy to the [authkit-tanstack-start example](https://github.com/workos/authkit-tanstack-start).

Construct the client once per isolate, inside `fetch`, because secrets live on `env`: `new WorkOS(env.WORKOS_API_KEY, { clientId: env.WORKOS_CLIENT_ID })`. The SDK caches the JWKS on the `UserManagement` instance (`createRemoteJWKSet` with a five-minute cooldown). If you memoize the client per isolate, the JWKS cache survives between requests ([user-management.ts](https://github.com/workos/workos-node/blob/main/src/user-management/user-management.ts)).

## 2. Hosted UI and OAuth callback flow

1. **`GET /login`** redirects to `workos.userManagement.getAuthorizationUrl({ provider: 'authkit', clientId, redirectUri, state, screenHint?, loginHint?, organizationId? })`.
   - `provider`, `connectionId`, and `organizationId` are mutually exclusive connection selectors, and exactly one is required.
   - `screenHint` takes `'sign-in'` or `'sign-up'` and works only with `authkit`.
   - `state` comes back unchanged on the redirect. Use it for CSRF protection plus a return-to path.
   - `getAuthorizationUrlWithPKCE` also exists, but PKCE is optional for a confidential server client.
   - Sources: [Get authorization URL](https://workos.com/docs/reference/authkit/authentication/get-authorization-url), [user-management.ts `getAuthorizationUrl`](https://github.com/workos/workos-node/blob/main/src/user-management/user-management.ts).
2. **`GET /callback?code&state`**: check `state` against a short-lived cookie. Then call `workos.userManagement.authenticateWithCode({ clientId, code, session: { sealSession: true, cookiePassword } })`. The call returns `user`, `organizationId`, `accessToken`, `refreshToken`, and `sealedSession`. The code is valid for 10 minutes ([Node AuthKit guide](https://workos.com/docs/authkit/vanilla/nodejs)).
3. Set `wos-session=<sealedSession>` with `Path=/; HttpOnly; Secure; SameSite=Lax` (same guide).
4. In the dashboard, configure the Redirect URI, the Initiate login URI, and the Sign-out URI. Logout errors out if no Sign-out URI is set (same guide).

## 3. Session cookie sealing and per-request validation

- **Sealing:** `sealData`/`unsealData` wrap **iron-webcrypto** with a versioned seal (`~2`) and a password of at least 32 characters (`WORKOS_COOKIE_PASSWORD`). The seal contains the access token, the refresh token, the user, and the impersonator. Sources: [seal.ts](https://github.com/workos/workos-node/blob/main/src/common/crypto/seal.ts), [session.ts](https://github.com/workos/workos-node/blob/main/src/user-management/session.ts).
- **Per request:** `const s = workos.userManagement.loadSealedSession({ sessionData, cookiePassword }); const r = await s.authenticate();` This unseals the cookie, then calls `verifyAccessToken`. That runs `jose.jwtVerify` against the remote JWKS and checks the issuer when one is configured. It then checks the claims a user token needs: `sub`, `sid`, `iss`, `exp`, `iat`, and `auth_time`. Agent and widget tokens are rejected. No network call is made once the JWKS is cached.
  - On success, it returns `{ authenticated: true, sessionId, organizationId, role, roles, permissions, entitlements, featureFlags, user, accessToken }`.
  - On failure, `reason` is one of `no_session_cookie_provided`, `invalid_session_cookie`, or `invalid_jwt`.
  - JWKS or network errors throw. They are not treated as an invalid session.
  - Source: [session.ts](https://github.com/workos/workos-node/blob/main/src/user-management/session.ts), [user-management.ts `verifyAccessToken`](https://github.com/workos/workos-node/blob/main/src/user-management/user-management.ts).
- **JWKS:** `https://api.workos.com/sso/jwks/{client_id}`, also available from `getJwksUrl(clientId)`. Access token claims include `sid`, `org_id`, `role`, `roles`, `permissions`, `entitlements`, `feature_flags`, `exp`, and others. The docs' example token lives for 300 s ([Session tokens](https://workos.com/docs/reference/authkit/session-tokens)). The lifetime is configurable in Dashboard → Sessions, and WorkOS recommends keeping it short ([Sessions](https://workos.com/docs/authkit/sessions)).
- **Effect fit:** wrap `authenticate()` in an `Effect.tryPromise` service. Map the `reason` values to typed errors, and treat thrown errors as `Unavailable`, not `Unauthenticated`.

## 4. Refresh

- When `authenticate()` fails with `invalid_jwt` (the token expired), call `await s.refresh({ organizationId? })`. It calls `authenticateWithRefreshToken` and reseals the cookie. It returns `{ authenticated, sealedSession, ...claims }`. The caller must write the new `Set-Cookie`. If it doesn't, every request refreshes again ([session.ts](https://github.com/workos/workos-node/blob/main/src/user-management/session.ts), [authkit-session README](https://github.com/workos/authkit-session)).
- Refresh tokens are **single-use and rotate** ([Session tokens](https://workos.com/docs/reference/authkit/session-tokens)). A **30-second replay grace period** makes concurrent or retried refreshes "converge on one result". That matters for an SPA that sends parallel API calls with the same expired cookie.
  - After the 30 seconds, an old token returns `invalid_grant`.
  - Treat timeouts, 5xx, and 429 as transient: keep the session and retry.
  - Sign the user out **only** on a terminal `invalid_grant`.
  - The SDK sorts these cases into terminal (`retryable: false`) and retryable results.
  - Source: [Session resilience](https://workos.com/docs/authkit/session-resilience).
- `refresh({ organizationId })` is also how a user **switches Organization** and how the app gets an `org_id` after creating one (§7).
- Session limits: the maximum session length and the inactivity timeout (no refresh within the window) are set in the dashboard. The required ordering is access token duration < inactivity timeout < max session length ([Sessions](https://workos.com/docs/authkit/sessions), [WorkOS blog](https://workos.com/blog/session-length-access-token-duration-inactivity-timeout)).

## 5. Sign-out and immediate revocation

- **Sign-out:** handle `POST /logout`, which needs CSRF protection. Call `await s.getLogoutUrl({ returnTo? })`, which builds `https://api.workos.com/user_management/sessions/logout?session_id=<sid>&return_to=…`. Clear the cookie, then redirect. WorkOS ends its session and sends the user to the Sign-out URI ([Node guide](https://workos.com/docs/authkit/vanilla/nodejs), [user-management.ts `getLogoutUrl`](https://github.com/workos/workos-node/blob/main/src/user-management/user-management.ts)).
- **Revoke from the server:** `workos.userManagement.revokeSession({ sessionId })` calls `POST /user_management/sessions/revoke`. `listSessions(userId)` lists a user's sessions ([Session API](https://workos.com/docs/reference/authkit/session)).
- **Deactivating an organization membership revokes all of that user's active sessions** ([Users and organizations](https://workos.com/docs/authkit/users-organizations.md)).
- **But revocation is not instant for local verification:** revoking "stops the session from being refreshed, but tokens already issued remain valid until they expire" ([WorkOS blog](https://workos.com/blog/session-length-access-token-duration-inactivity-timeout); also [stateless JWT logout](https://workos.com/blog/stateless-jwt-logout-problem)).
- **Recommendation for SPEC §5.6 ("lose access immediately"):**
  - Keep the access token short, for example 5 minutes.
  - On each request, also look up SurveyBeat's own Person or Membership state in D1 or KV, which is needed for authorization anyway.
  - Keep a revoked-`sid` deny set, fed by `session.revoked`, `organization_membership.updated`/`deleted`, `dsync.user.deleted`, and `user.deleted` events.
  - This makes revocation immediate. The JWT check only proves who the caller is.

## 6. Magic link, Google, Microsoft

All three are enabled in the Dashboard → Authentication. AuthKit's hosted page then shows them, with no code changes ([Social login](https://workos.com/docs/authkit/social-login)).

- **Magic Auth:** an emailed **six-digit, one-time code that expires after 10 minutes**, not a link ([Magic Auth](https://workos.com/docs/authkit/magic-auth)). SPEC §5.6 says "email magic link", so the product owner should accept a code. If a clickable link is required, build a custom UI with `createMagicAuth` and `authenticateWithMagicAuth` (both in the SDK).
- **Google:** in staging, WorkOS's default credentials work. In **production you must supply your own Google client ID and secret**, and register the WorkOS redirect URI from Dashboard → Authentication → OAuth providers → Google. Direct provider value: `GoogleOAuth` ([Google OAuth](https://workos.com/docs/integrations/google-oauth)).
- **Microsoft:** same pattern, with your own Azure app registration in production, a Web-platform redirect URI, and provider value `MicrosoftOAuth` ([Microsoft OAuth](https://workos.com/docs/integrations/microsoft-oauth)).
  - **Watch out:** the page currently says to pick "Personal Microsoft accounts only" under Supported Account Types, which looks wrong for B2B work accounts. Confirm this with WorkOS or test it before production.
- **Enterprise SSO (SAML/OIDC):** pass `organizationId` (or `connectionId`) to `getAuthorizationUrl`, or let AuthKit route by domain.

## 7. Self-serve: create a WorkOS Organization at first sign-in

AuthKit does not do this on its own. The documented pattern ([Users and organizations](https://workos.com/docs/authkit/users-organizations.md)):

1. After the callback, check whether the result or the token has an `org_id`.
2. If it has none, show a "name your organization" form. Then call `workos.organizations.createOrganization({ name, externalId? })` and `workos.userManagement.createOrganizationMembership({ userId, organizationId, roleSlug: 'admin' })`.
3. Call `session.refresh({ organizationId })` (or `authenticateWithRefreshToken({ organizationId })`) to get a token scoped to that organization, then reseal the cookie.

Make this idempotent, because users double-submit and Workers retry. Store the SurveyBeat Organization row keyed by the WorkOS org id. Setting `externalId` to SurveyBeat's id helps here. Users can also be JIT-provisioned into an existing Organization when their email matches one of its verified domains (same page).

## 8. Inviting People who have not signed in

- `workos.userManagement.sendInvitation({ email, organizationId, roleSlug?, expiresInDays? (1–30, default 7), inviterUserId?, locale? })`. Invitation states are `pending`, `accepted`, `expired`, and `revoked`. The invitation object includes `token` and `accept_invitation_url`. Other calls: `resendInvitation`, `revokeInvitation`, `findInvitationByToken`, `listInvitations` ([Invitation API](https://workos.com/docs/reference/authkit/invitation)).
- "Invitations are for both new users and existing users." A new user gets a sign-up link and "automatically join[s] the organization". The membership stays `pending` until they accept ([Invitations](https://workos.com/docs/authkit/invitations), [Users and organizations](https://workos.com/docs/authkit/users-organizations.md)).
- **Email sending:** WorkOS sends the invitation email by default. Sending it yourself is supported. SPEC §5.8 wants Cloudflare Email Service for invitations, so use the `accept_invitation_url` in our own template. Before accepting, check that the invitee's email matches, using `findInvitationByToken`. The exact setting that turns off WorkOS's email isn't clearly documented, so check the dashboard's email settings. Sandbox limit: 100 invitation emails per 24 hours.
- Domain mapping: create the SurveyBeat Person when we invite, with an email and no WorkOS user id. Link the Person on the `invitation.accepted` and `organization_membership.created` events, or at the first callback.

## 9. Organization roles

- Roles have immutable slugs. The environment default role is `member` and can't be deleted. Define an `admin` role yourself in the dashboard; it isn't built in. Organization-specific custom roles (prefixed `org`) are also possible. Each membership has one role by default, and multiple roles can be turned on ([Roles and permissions](https://workos.com/docs/authkit/roles-and-permissions)).
- Roles are set through the membership APIs (`roleSlug` on create, update, and invite), SSO or directory group mapping, or the dashboard. A change emits `organization_membership.updated`.
- The access token carries `role`, `roles`, and `permissions` for the current organization ([Session tokens](https://workos.com/docs/reference/authkit/session-tokens)). A role change reaches the token only at the next refresh, which is a reason to keep token lifetimes short. Team roles (lead, member, viewer) stay in SurveyBeat's data, as SPEC §5.6 says.

## 10. Verifying webhooks in a Worker, and the Events API

- **Header:** `WorkOS-Signature: t=<ms epoch>,v1=<hex HMAC-SHA256>`. The signature is computed over `` `${t}.${rawBody}` `` with the endpoint secret.
- **SDK:** `await workos.webhooks.constructEvent({ payload, sigHeader, secret, tolerance = 180000 })`. This runs on `SubtleCryptoProvider` with a constant-time compare, checks the timestamp tolerance (3 minutes), and **parses only after verification succeeds**.
- **Pass the raw body:** use `await request.text()`, not `request.json()`. The SDK accepts objects, but it would re-serialize them, and that may not match the exact bytes that were signed. The 2024 blog example passes parsed JSON, so don't copy it.
- Sources: [Webhooks](https://workos.com/docs/events/data-syncing/webhooks), [signature-provider.ts](https://github.com/workos/workos-node/blob/main/src/common/crypto/signature-provider.ts), [webhooks.ts](https://github.com/workos/workos-node/blob/main/src/webhooks/webhooks.ts).
- **Delivery:**
  - Any non-2xx response counts as a failure. Production retries up to 6 times with exponential backoff over 3 days. Staging retries only for a few minutes.
  - Delivery is **not ordered**, and duplicates are possible. Upsert using `updated_at` and dedupe on the event id.
  - WorkOS publishes a list of 15 source IPs that you can allowlist.
  - Pattern: verify, enqueue to a Cloudflare Queue, and return 200 quickly.
  - Source: [Webhooks](https://workos.com/docs/events/data-syncing/webhooks).
- **Events API:** `workos.events.listEvents({ events: [...], after?, rangeStart? })` lets you poll with a cursor. It keeps events for **90 days** and returns at most 30 days per request. WorkOS recommends processing events in order and storing the cursor after each one. Event ids are the same as in webhooks ([Events API](https://workos.com/docs/events/data-syncing/events-api)). A Cron Trigger plus a cursor in D1 makes a good **reconciliation backstop** for missed webhooks. Both paths can feed one idempotent handler.
- **Relevant events** ([Events](https://workos.com/docs/events)):
  - `user.created`, `user.updated`, `user.deleted`
  - `session.created`, `session.revoked`
  - `organization.*`
  - `organization_membership.created`, `organization_membership.updated`, `organization_membership.deleted`
  - `invitation.created`, `invitation.accepted`, `invitation.revoked`, `invitation.resent`
  - `dsync.user.*`, `dsync.group.*`, `dsync.group.user_added`, `dsync.group.user_removed`
  - `role.*`, `organization_role.*`

## Open points for the product owner or architecture

1. Is a six-digit email code acceptable as SPEC's "magic link"? If not, we need a custom UI for that one method.
2. Microsoft's "Personal accounts only" instruction in the WorkOS docs needs testing before production.
3. Decide on the deny check (revoked `sid` plus Person status in D1/KV) as the mechanism for "immediate" revocation, and set the access token lifetime (5 min suggested).
4. Use `@workos-inc/node` directly (stable). Possibly borrow from `@workos/authkit-session` (prerelease), but don't depend on it yet.
