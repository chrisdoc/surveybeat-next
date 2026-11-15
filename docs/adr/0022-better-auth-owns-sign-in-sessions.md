# Better Auth owns sign-in sessions in D1

Sign-in is WorkOS AuthKit today: the Worker seals a WorkOS session into `__Host-surveybeat-session`, verifies the access token locally, and D1 indexes WorkOS users and organizations (`docs/infra.md`, ADR 0010). Issue #200 replaces the provider with Better Auth, the library rat-stack runs on the same Alchemy pin, so SurveyBeat owns its user and session rows in D1 and stops calling a provider on every sign-in.

**What moves.** A new package, `packages/auth`, owns the Better Auth options: `basePath: "/auth"`, the email one-time-code plugin, a 30-day session, and the `__Host-surveybeat-session` cookie with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` and no `Domain`. The Worker keeps its own HTTP surface (`/auth/login`, `/auth/logout`, `/auth/session`, `/auth/organization`, `/auth/organization/choose`) and reaches Better Auth through the `IdentityProvider` port, so the Foldkit app never talks to Better Auth's default client routes. `better-auth` is pinned at `1.7.11` and `@alchemy.run/better-auth` at `2.0.0-beta.85` next to the existing Alchemy pin.

**What does not move.** The Organization is still the Durable Object tenant (ADR 0006); Better Auth's organization plugin is not adopted and there is no one-to-one WorkOS organization map any more. The Better Auth user id replaces `WorkosUserId`, and `PersonId` stays SurveyBeat's own id: one human can be a different Person in each Organization, so `session.user.id` is never treated as a `PersonId`. Organization admin stays a fact in the Organization object (ADR 0003). An email links a Person or passes the create-organization allowlist only when the provider verified it and it is printable ASCII (ADR 0002); the allowlist file stays `infra/org-creation-allowlist.yaml`.

**Revocation.** ADR 0010's requirement stands: a revoked session fails the next request. Sign-out deletes the Better Auth session row in D1. The `revoked_session` deny list stays until a test shows a deleted session is refused on the next request with no extra row; then the row and that part of ADR 0010 go in the same change.

**Deferred.** Enterprise SSO (SAML or OIDC) and Directory Sync (SCIM) leave this change; SPEC §5.6 and §6.1 name them deferred until a later issue. Google and Microsoft stay on the sign-in screen only if Better Auth can configure them inside the Worker; a provider that cannot is called out rather than silently dropped.

## Considered options

- **Keep WorkOS and add Better Auth beside it.** Rejected: two providers mean two session truths and two revocation paths.
- **Adopt Better Auth's organization plugin as the tenant.** Rejected: it would put a second source of truth next to the Organization Durable Object, contradicting ADR 0006.
- **Treat `session.user.id` as the Person id, as rat-stack does.** Rejected: a Person is per Organization here, and the same human is several Persons.

## Consequences

- SurveyBeat stores users and sessions in D1 instead of indexing WorkOS; `@workos-inc/node`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID` and the cookie password that sealed WorkOS sessions go away at cutover.
- The Worker must answer better-auth's endpoint surface internally, and CI needs an in-memory Better Auth layer for tests, which `memoryAuth` provides.
- Migration is staged: the pins, options and in-memory sign-in test land first with WorkOS still serving, then the D1 session store, then the port and routes, then revocation and the docs.
