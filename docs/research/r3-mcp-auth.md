# Remote MCP Authentication and Streamable HTTP Transport on MainWorker

Research for [issue #301](https://github.com/chrisdoc/surveybeat-next/issues/301). Checked on 2026-11-20 against repo pins `better-auth@1.7.25`, `effect@4.1.4`, and `@alchemy.run/cloudflare@2.0.0-beta.87`, plus published npm tarballs for `@better-auth/mcp@1.7.25`, `@better-auth/oauth-provider@1.7.25`, `@better-auth/core@1.7.25`, `@better-auth/cimd@1.7.25`, `@cloudflare/workers-oauth-provider@1.2.4`, and `@modelcontextprotocol/sdk@1.32.2`.

> [!NOTE]
> `node_modules` was not materialized on initial checkout, so Better Auth 1.7.25 and candidate package internals were verified directly from the published npm package tarballs for the exact repo pins and cross-checked against `packages/auth`, `packages/cloudflare`, `packages/domain`, and `docs/adr/`. `SPEC.md` and `docs/adr/` were not modified (issue #296 owns the `SPEC.md` release-order update).

## 1. Recommendation

1. **OAuth 2.1 + PKCE + Consent (`@better-auth/mcp@1.7.25`)**: Add **`@better-auth/mcp@1.7.25`** (which wraps **`@better-auth/oauth-provider@1.7.25`**, plus **`@better-auth/cimd@1.7.25`** if Client ID Metadata Documents are enabled) to SurveyBeat's existing Better Auth configuration in `packages/auth` on D1.
   - Configure `mcp({ disableJwtPlugin: true, ... })` so access tokens are **opaque** (stored by hash in D1) rather than stateless JWTs, and validate `/mcp` Bearer tokens on `MainWorker` directly against D1 rather than relying solely on `@better-auth/mcp`'s `requireMcpAuth`.
   - Reject `@cloudflare/workers-oauth-provider@1.2.4`: it requires a dedicated Cloudflare KV namespace (`OAUTH_KV`), duplicating auth state outside D1 (violating SPEC §6.2's "Do not use [KV] for sessions that must be revoked at once" and ADR 0022's single-provider rule).
2. **MCP Server & Streamable HTTP Transport (`@modelcontextprotocol/sdk@1.32.2`)**: Serve `POST /mcp` on `MainWorker` using `@modelcontextprotocol/sdk/server/index.js` (`Server`) and `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js` (`WebStandardStreamableHTTPServerTransport`) in **stateless per-request mode** (`sessionIdGenerator: undefined`, `enableJsonResponse: true`), initialized with `CfWorkerJsonSchemaValidator` (`@modelcontextprotocol/sdk/validation/cfworker`) and wrapped by a thin Effect adapter that generates tool JSON Schemas and validates tool inputs/outputs with **Effect Schema**.
   - Do **not** adopt `effect/ai/McpServer` (`effect@4.1.4`) yet: its stateless `McpServer.layerHttpRequestScoped` rejects every protocol older than `2026-07-28`, while its `2025-11-25`/`2025-03-26` `McpServer.layerHttp` stores `mcp-session-id` in an isolate-local `Map` and forks a background fiber.

---

## 2. Better Auth 1.7.25 Package Name & OAuth Comparison

### Confirmed Package Name at Pin `1.7.25`

Inspecting `better-auth@1.7.25` (`dist/plugins/index.d.mts`) confirms that **`better-auth/plugins` does not export an `mcp` plugin**. At `1.7.25`, Better Auth ships MCP support as separate scoped packages pinned alongside `better-auth`:

| Package (`1.7.25`) | Role at `1.7.25` | Key dependencies / exports |
| --- | --- | --- |
| `better-auth` (`1.7.25`) | Core auth, `emailOTP`, `magicLink`, `admin`, `organization`, `jwt` | No `mcp` export in `better-auth/plugins` |
| `@better-auth/mcp` (`1.7.25`) | **Real MCP plugin package**; wraps `oauthProvider` for RFC 9728 / RFC 8707 | Depends on `@better-auth/oauth-provider@^1.7.25`, `jose@^6.1.3`; exports `mcp`, `requireMcpAuth`, `createMcpProtectedRequestHandler` |
| `@better-auth/oauth-provider` (`1.7.25`) | Underlying OAuth 2.1 / OIDC Authorization Server plugin | Peer-depends on `better-auth@^1.7.25`, `@better-auth/core@^1.7.25`; exports `oauthProvider`, metadata helpers |
| `@better-auth/cimd` (`1.7.25`) | Client ID Metadata Documents (`draft-ietf-oauth-client-id-metadata-document-00`) | Optional companion for MCP 2026-07-28 client registration |

### OAuth Provider Comparison for `/mcp` on `MainWorker`

| Dimension | `@better-auth/mcp@1.7.25` + `@better-auth/oauth-provider@1.7.25` | `@cloudflare/workers-oauth-provider@1.2.4` |
| --- | --- | --- |
| **Storage backend** | Existing D1 database (`Database`) via Better Auth adapter and numbered migrations (`migrate: false`, ADR 0022/0024). | Requires a dedicated KV namespace (`OAUTH_KV`); stores hashed tokens and AES-GCM encrypted `props` in KV. |
| **Existing Better Auth sessions** | Native integration: `/oauth2/authorize` reads the existing `__Host-surveybeat-session` cookie via `getSessionFromCtx`. | Requires custom `/authorize` glue to verify the Better Auth session cookie and call `completeAuthorization()`. |
| **OAuth 2.1 + PKCE + Consent** | Authorization Code + PKCE (`S256` enforced for public clients, no implicit grant), signed `loginPage` / `consentPage` / `postLogin` redirects, persisted `oauthConsent`. | Authorization Code + PKCE (`S256` enforced for public clients), custom `/authorize` consent HTML + `completeAuthorization()`. |
| **Client registration** | Pre-registered clients, optional RFC 7591 DCR, and `@better-auth/cimd` (`draft-00`). | Pre-registered clients, optional DCR, and built-in CIMD (`clientIdMetadataDocumentEnabled: true`). |
| **Immediate revocation** | Immediate when configured with `disableJwtPlugin: true` (opaque tokens in D1) plus our D1 grant/session check. Default JWT mode is **not** immediately revocable (see traps below). | Immediate via KV revocation/deletion (subject to KV eventual consistency if written and read across colos). |
| **`MainWorker` fit** | Composes into `MainWorker`'s existing `authInstance.fetch` and Effect router. | Combined `OAuthProvider` wraps the entire Worker `fetch` (`apiRoute` vs `defaultHandler`), fighting Effect `HttpApiBuilder` / `HttpRouter`. |
| **SPEC / ADR alignment** | Single D1 auth store; respects ADR 0022 & ADR 0023. | Introduces KV for revocable auth grants (contrary to SPEC §6.2 and ADR 0022). |

### Primary-Source Traps in `@better-auth/oauth-provider@1.7.25` & `@better-auth/mcp@1.7.25`

Inspecting `authorize-BJStuGWz.mjs` (`@better-auth/oauth-provider@1.7.25`), `index.mjs` (`@better-auth/mcp@1.7.25`), and `verify.mjs` (`@better-auth/core@1.7.25`) revealed four critical traps that shape SurveyBeat's implementation:

1. **Default JWT mode breaks immediate revocation**: In `createUserTokens` (`authorize-BJStuGWz.mjs`), `isJwtAccessToken = audienceClaim && !opts.disableJwtPlugin`. Because `mcp({ resource })` always sets `audienceClaim`, it mints stateless JWT access tokens (3600s default TTL) unless `disableJwtPlugin: true` is set. `requireMcpAuth()` validates JWTs locally via JWKS (`verifyAccessTokenRequest`) with **no D1 lookup**, and `/oauth2/revoke` (`revokeJwtAccessToken`) rejects JWT access tokens with `unsupported_token_type`. Setting **`disableJwtPlugin: true`** switches access tokens to opaque tokens stored by hash in `auth_oauth_access_token`, avoids adding a `jwks` table in D1, and makes `/oauth2/revoke` delete the `oauthAccessToken` row. (Note: when `disableJwtPlugin: true`, `storeClientSecret` must remain `"encrypted"`—its default—not `"hashed"`.)
2. **Deleting consent does not revoke existing tokens**: Better Auth's `/oauth2/delete-consent` (`deleteConsentEndpoint`) deletes the `oauthConsent` row without deleting `oauthAccessToken` or `oauthRefreshToken` rows, and `revokeRefreshToken` marks `revoked = <timestamp>` rather than deleting the row. Moreover, `prepareBackchannelLogoutPlan` intentionally spares `offline_access` refresh tokens when a browser session is deleted, and `oauthAccessToken.sessionId` uses `ON DELETE SET NULL`. Therefore, `/mcp` must verify **both** the token row and an active `oauthConsent` grant row in D1.
3. **`banned` is not enforced on OAuth endpoints or token verification**: Consistent with ADR 0024, Better Auth's `admin` plugin only enforces `banned` in its `session.create.before` hook. Neither `validateJwtAccessToken`, `validateOpaqueAccessToken`, `/oauth2/authorize`, nor `handleRefreshTokenGrant` in `@better-auth/oauth-provider@1.7.25` checks `user.banned`. Every `/mcp` request—and OAuth authorization/refresh hooks—must check `auth_user.banned` and `auth_user.banExpires` explicitly.
4. **`basePath: "/auth"` discovery & SPA asset routing**: `MainWorker.ts` sets `basePath: "/auth"` and forwards only `path.startsWith("/auth/") && !SURVEYBEAT_AUTH_PATHS.has(path)` to `authInstance.fetch`, while `WorkerWiring.ts` (`mainWorkerAssets.runWorkerFirst`) lists `/auth/*` and `/api/*`. However, `mcp()` serves RFC 9728 metadata at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`, and `oauthProvider()` serves RFC 8414 metadata at `/.well-known/oauth-authorization-server/auth` (and `/auth/.well-known/oauth-authorization-server`). Both `/.well-known/*` and `/mcp` must be added to `runWorkerFirst` and routed in `MainWorker.ts` before the SPA fallback.

---

## 3. MCP Server Library for Cloudflare Workers + Effect 4.1.x

### Candidate Evaluation

| Library | Stateless per-request on Workers | Effect Schema tool I/O | `nodejs_compat` / Workers runtime | Client compatibility |
| --- | --- | --- | --- | --- |
| **`effect/ai/McpServer` (`effect@4.1.4`)** | `layerHttpRequestScoped` is stateless/request-scoped, **but** rejects all protocols except `v2026_07_28`. `layerHttp` (`v2025_11_25` / `v2025_03_26`) keeps an isolate-local `Map` (`McpStatefulRuntime`) and forks a background fiber. | First-class (`Toolkit` + `Tool.make` with Effect Schema, `Schema.toJsonSchemaDocument`). | Pure Web / Effect; zero `node:` imports in `src/ai/`. | **Blocker today**: `v2026_07_28` requires `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method`, `Mcp-Name`, and `_meta` headers; current MCP clients (`@modelcontextprotocol/sdk@1.32.2` `LATEST_PROTOCOL_VERSION = "2025-11-25"`) use `initialize` over `2025-03-26`–`2025-11-25`. |
| **`@modelcontextprotocol/sdk@1.32.2` (`Server` + `WebStandardStreamableHTTPServerTransport`)** | **Yes**: `new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` handles `initialize`, `tools/list`, and `tools/call` per HTTP `POST /mcp` with zero cross-request state. | High-level `McpServer` accepts Zod v3/v4 only (`zod-compat.d.ts`). Low-level **`Server`** registers `ListToolsRequestSchema` and `CallToolRequestSchema` handlers directly, so a small Effect bridge supplies JSON Schemas (`Schema.toJsonSchemaDocument`) and validates I/O (`Schema.decodeUnknownEffect` / `Schema.encodeEffect`). | Zero `node:` imports in `webStandardStreamableHttp.js`, `mcp.js`, or `index.js`; works on Workers (`@alchemy.run/cloudflare` enables `nodejs_compat` by default before `2026-08-04`). **Must** pass `CfWorkerJsonSchemaValidator` (`@modelcontextprotocol/sdk/validation/cfworker`) to replace `AjvJsonSchemaValidator`, which uses `new Function`. | Full support for `2024-11-05`, `2025-03-26`, `2025-06-18`, and `2025-11-25`. |
| **Cloudflare `agents` (`McpAgent`)** | Designed around stateful per-session Durable Objects (`McpAgent extends DurableObject`). | Uses `@modelcontextprotocol/sdk` (`McpServer` + Zod). | Native Cloudflare Workers/DOs. | Full client support, but adds DO-per-MCP-session routing alongside the Organization DO. |

### Recommended Transport Wiring

1. Serve `/mcp` on `MainWorker` (never on `SubmissionWorker`, preserving SubmissionWorker's isolation and zero-observability boundary).
2. On `POST /mcp`, authenticate the request first (returning `401` with RFC 9728 `WWW-Authenticate` or `403` `insufficient_scope` / `403` forbidden before touching the MCP transport).
3. Construct a request-scoped `@modelcontextprotocol/sdk` `Server` (with `CfWorkerJsonSchemaValidator`) and `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`, handle the single `Request` inside the Effect runtime so tool handlers execute Effect programs with the resolved `Actor` and domain services (`OrganizationDirectory`, `OrganizationPulses`, `OrganizationRounds`, `OrganizationActions`, `OrganizationNotes`), and close the transport when the request completes.
4. Return `405 Method Not Allowed` for `GET /mcp` and `DELETE /mcp` (stateless Streamable HTTP with no SSE push or server-held MCP sessions).
5. Enforce `Origin` validation on `/mcp` (matching `trustedOrigins` or absent `Origin` for non-browser CLI/desktop clients) against DNS rebinding, and register every MCP tool's domain read/write in `packages/api/src/PrivacyRegistry.ts` (or a sibling MCP privacy check) per SPEC §7.

---

## 4. Token-to-Actor Resolution, Revocation, and Active/Banned Checks

SurveyBeat's domain model separates the global auth user (`AuthUserId` = `auth_user.id`) from per-Organization tenancy (`OrganizationId` + `PersonId` + `Actor`). One human may be different `Person`s across multiple Organizations (`D1PeopleIndex`, ADR 0022/0023).

```text
Bearer Token ──▶ [D1 Auth Check on MainWorker]
                    ├─ Hash token ─▶ auth_oauth_access_token (active, unrevoked, unexpired)
                    ├─ Grant check ─▶ auth_oauth_consent exists for (clientId, userId, referenceId)
                    ├─ Client check ─▶ auth_oauth_client.disabled = 0
                    ├─ Session check ─▶ if sessionId != null, auth_session exists & unexpired
                    └─ Ban check ────▶ auth_user.banned = 0 (or expired banExpires)
                          │
                          ▼ yields (authUserId, organizationId = referenceId, scopes)
                 [Organization Durable Object RPC]
                    ├─ person row: auth_user_id = authUserId AND removed_at IS NULL
                    ├─ membership rows: ended_at IS NULL
                    └─ actorOf(directoryState, person.id) ─▶ Actor { personId, organizationAdmin, roles }
```

### Step-by-Step Resolution

1. **Consent-time Organization binding (`postLogin.consentReferenceId`)**:
   - During `/auth/oauth2/authorize`, `@better-auth/oauth-provider` runs `postLogin` after browser sign-in and before consent.
   - Using `D1PeopleIndex.linkedPersons(authUserId)` (and **not** Better Auth's `auth_organization` / `auth_member` tables, per ADR 0024), resolve the human's linked Organizations:
     - **Zero linked active Persons**: deny authorization (the human has no Organization membership to grant).
     - **One linked Organization**: `postLogin` passes automatically and `consentReferenceId` returns that `OrganizationId`.
     - **Multiple linked Organizations**: `postLogin` redirects to a SurveyBeat Organization-selection page (reusing the candidate-picker semantics from `SignInFlow.ts`), records the selected `OrganizationId` for the authorize continuation, and `consentReferenceId` returns it.
   - Better Auth persists that `OrganizationId` in `referenceId` on `auth_oauth_consent`, `auth_oauth_refresh_token`, and `auth_oauth_access_token`. Pinning each OAuth grant to one `OrganizationId` prevents an MCP client token from crossing Organizations or shifting silently when the human switches Organizations in the web app (`auth_session_organization`).
2. **Per-request D1 verification on `MainWorker` (auth plane)**:
   - Extract `Authorization: Bearer <token>` (reject missing/malformed tokens with `401` and RFC 9728 `WWW-Authenticate: Bearer resource_metadata="..."`).
   - Compute the stored token digest matching Better Auth's `storeTokens` hash and execute a single D1 lookup joining `auth_oauth_access_token`, `auth_oauth_client`, `auth_oauth_consent`, `auth_user`, and (left join) `auth_session`:
     - Token row exists, `revoked IS NULL`, and `expiresAt > now`.
     - `auth_oauth_client` exists and `disabled = 0`.
     - **`auth_oauth_consent` row exists** matching `(clientId, userId, referenceId)` and covers the token's scopes/resources.
     - If `sessionId IS NOT NULL` (or if `offline_access` was not granted), the `auth_session` row still exists and `expiresAt > now`.
     - **`auth_user.banned` check (ADR 0024)**: reject immediately if `banned = 1` and (`banExpires IS NULL` or `banExpires > now`). Also enforce the same `banned` check in `oauthProvider` hooks before `/oauth2/authorize`, `/oauth2/consent`, and `/oauth2/token` (`refresh_token` grant) so banned accounts cannot obtain or refresh tokens.
     - Verify `referenceId` is a non-empty `OrganizationId` (and check optional `person_index` existence).
3. **Per-request Organization DO verification (tenant & `Actor` plane)**:
   - Call the `Organization` Durable Object identified by `organizationId` (`referenceId`) to resolve the active `Person` and `Actor` (`organizationDirectory.activePerson(authUserId)` / `actorOf(directoryState, personId)` in `packages/domain/src/people/Directory.ts`).
   - The DO checks `person.auth_user_id = authUserId AND person.removed_at IS NULL` and computes `Actor { personId, organizationAdmin, roles }` from active `membership` rows (`ended_at IS NULL`).
   - If the `Person` was removed (`removed_at IS NOT NULL`) or deactivated, `activePerson` / `actorOf` returns `None`, and `/mcp` immediately fails the request (`401` / `403`).
   - Every MCP tool passes `Actor` (or `actorId` + DO enforcement) through the existing domain permission function `can(actor, action, resource)` and privacy rules (minimum group size, subtraction-safe roll-ups, comment redaction, Lead-only discussion guides, review windows).

### Revocation Semantics (ADR 0023)

- **No deny list**: Consistent with ADR 0023 (which deleted `revoked_session`), revocation deletes the grant/token rows directly in D1; no deny-list table is added.
- **Immediate failure on next request**:
  - **User revokes an MCP client grant** (from SurveyBeat settings or `/oauth2/delete-consent`): delete the `auth_oauth_consent` row **and** delete matching `auth_oauth_access_token` and `auth_oauth_refresh_token` rows in one `database.batch([...])` call. Because the `/mcp` verifier requires both the `auth_oauth_access_token` row and the `auth_oauth_consent` row, the very next `/mcp` request fails with `401 invalid_token`.
  - **OAuth client calls `/oauth2/revoke`**: `revokeOpaqueAccessToken` deletes the `auth_oauth_access_token` row immediately; `revokeRefreshToken` marks `revoked` on `auth_oauth_refresh_token` and deletes linked `auth_oauth_access_token` rows.
  - **Admin bans a user (`banUser`) or removes a Person (`RemovePerson`)**: `auth_user.banned = 1` and `person.removed_at != NULL` both fail the very next `/mcp` request immediately, and the workflow should also delete matching `auth_oauth_consent`, `auth_oauth_access_token`, and `auth_oauth_refresh_token` rows in D1 (`userId` / `(userId, referenceId)`) so no stale refresh grant lingers.

---

## 5. Storage Changes

### D1 (`packages/cloudflare/d1-migrations/0011_better_auth_mcp.sql` + `d1-migrations.lock.json`)

D1 remains strictly the global auth/routing index—**no survey content** (no Pulses, Rounds, Submissions, Answers, Results, Themes, Actions, or Notes) is ever stored in D1.

With `disableJwtPlugin: true`, `@better-auth/oauth-provider@1.7.25` needs six `auth_`-prefixed tables (mapped in `AUTH_TABLES` in `packages/auth/src/options.ts`, no `jwks` table needed):

| Table | Purpose | Notes |
| --- | --- | --- |
| `auth_oauth_client` | Registered MCP clients (CIMD/DCR/static) | `clientId` (unique), `redirectUris`, `scopes`, `tokenEndpointAuthMethod`, `requirePKCE`, `disabled`, `userId` |
| `auth_oauth_resource` | Canonical resource policies (`/mcp`) | `identifier` (unique), `allowedScopes`, `accessTokenTtl`, `refreshTokenTtl`, `disabled` |
| `auth_oauth_client_resource` | Client-to-resource allow mapping | `(clientId, resourceId)` unique pair with `ON DELETE CASCADE` |
| `auth_oauth_consent` | Active user-per-Organization grants | `(clientId, userId, referenceId)` where `referenceId` stores SurveyBeat `OrganizationId`; deleting this row revokes the grant |
| `auth_oauth_refresh_token` | Hashed refresh tokens (`offline_access`) | `token` (unique), `clientId`, `userId`, `sessionId` (`ON DELETE SET NULL`), `referenceId`, `scopes`, `resources`, `revoked`, `expiresAt` |
| `auth_oauth_access_token` | Hashed opaque access tokens | `token` (unique), `clientId`, `userId`, `sessionId` (`ON DELETE SET NULL`), `referenceId`, `refreshId`, `scopes`, `resources`, `revoked`, `expiresAt` |
| `auth_oauth_client_assertion` | Optional `private_key_jwt` `jti` replay guard | Only needed if CIMD `private_key_jwt` clients are enabled (`id`, `expiresAt`) |

Note on D1 batching: `@effect/sql-d1` / Cloudflare D1 has no SQL `BEGIN`/`COMMIT` transactions (`docs/research/effect-on-workers.md`), so multi-table grant deletion uses `database.batch([...])`.

### Organization Durable Object

**Zero schema changes required.** The `Organization` DO remains the sole system of record for `person` (`auth_user_id`, `removed_at`, `organization_admin`), `membership` (`team_id`, `person_id`, `role`, `ended_at`), and all survey entities.

### Worker Configuration & Routing

- Add `"/mcp"` and `"/.well-known/*"` to `mainWorkerAssets.runWorkerFirst` in `packages/cloudflare/src/WorkerWiring.ts` and route them in `packages/cloudflare/src/MainWorker.ts` (`/.well-known/*` to `authInstance.fetch`, `/mcp` to the authenticated MCP handler).
- If `@better-auth/cimd` is enabled to fetch external client metadata URLs from `MainWorker`, ensure the `global_fetch_strictly_public` compatibility flag is configured in Alchemy for `MainWorker` (matching Cloudflare's CIMD SSRF guidance).

---

## 6. What Could Not Be Verified

1. **Runtime behavior & bundle size in `workerd`**: No dependencies were installed into `packages/*` and no code was built or deployed; `MainWorker` startup CPU and bundle size with `@better-auth/mcp`, `@better-auth/oauth-provider`, `@modelcontextprotocol/sdk`, and `@cfworker/json-schema` were not measured in local `workerd` or a preview stage.
2. **Exact D1 DDL generated by Better Auth 1.7.25**: Table definitions were read from `@better-auth/oauth-provider@1.7.25`'s `oauth-kpy9mh0t.d.mts`, not emitted via Better Auth's SQLite migration generator and exercised against `D1Auth.test.ts`. Exact column defaults, `string[]` JSON encoding, and `ON DELETE CASCADE` behavior in D1 must be validated in `D1Auth.test.ts` when authoring migration `0011`.
3. **Token hash function parity**: `authorize-BJStuGWz.mjs` shows `storeTokens: "hashed"` calls internal `getStoredToken(opts.storeTokens, tokenValue, "access_token")`. Whether the `/mcp` verifier should call an explicit `storeTokens: { hash }` SHA-256 function shared with `options.ts` or invoke `validateOpaqueAccessToken` in-process was not tested against a running Better Auth SQLite adapter.
4. **Real MCP client discovery with `basePath: "/auth"`**: Because SurveyBeat mounts Better Auth at `/auth` rather than root, some MCP clients may probe root `/.well-known/oauth-authorization-server` instead of `/.well-known/oauth-authorization-server/auth` even when RFC 9728 `authorization_servers` points to `https://<host>/auth`. Live client interoperability (Claude Desktop, Claude Code, Cursor) was not tested.
5. **Effect 4.1.4 `Schema.toJsonSchemaDocument` + `CfWorkerJsonSchemaValidator` on branded domain schemas**: Translating `@surveybeat/domain` branded IDs and union schemas into MCP `inputSchema` / `outputSchema` JSON Schemas and validating them under `CfWorkerJsonSchemaValidator` was not tested in code.
