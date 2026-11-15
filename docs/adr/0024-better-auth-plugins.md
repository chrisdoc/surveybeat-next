# Better Auth's magic-link, admin, organization and passkey plugins are enabled

ADR 0022 adopted Better Auth for sign-in with the email one-time-code plugin only, and rejected the organization plugin as the tenant. This ADR adds three more plugins and the passkey plugin to the same instance. The tenant decision does not change: the Organization Durable Object is still the system of record for Teams, People and survey content (ADR 0006), and the plugins are an auth-plane capability rather than a second tenant.

**What is enabled.** `packages/auth/src/options.ts` builds one plugin list for every instance, `authOptions`, so the Worker's `BetterAuth` resource and `createAuth`/`memoryAuth` in tests cannot drift:

- `magicLink` with `MAGIC_LINK_TTL_SECONDS` (300 seconds). The link is delivered through the same `EmailSender` the invitation and sign-in code use, so a non-production stage records it in `captured_email` and production sends it. Better Auth consumes a token on the first verification, so one link mints at most one session.
- `admin` with `defaultRole: "user"` and `adminRoles: ["admin"]`. This role is the auth plane's own and is not the Organization admin: Organization admins stay a fact in the Organization object (ADR 0003). No product route reads `user.role`.
- `organization` with `allowUserToCreateOrganization: false`. Creating an Organization stays the allowlisted flow in `packages/domain` and the Organization Durable Object; the plugin's `auth_organization`, `auth_member` and `auth_invitation` rows are not the tenant and no product route treats them as one.
- `passkey` (`@better-auth/passkey`, pinned with `better-auth`). The relying party is derived from the instance's base URL, so a stage's passkey registrations and the local stage on `localhost` are scoped to their own origin.

**Store.** The plugin columns and tables are a numbered D1 migration, `packages/cloudflare/d1-migrations/0009_better_auth_plugins.sql`, in the same style as ADR 0022: `auth_user` gains `role`, `banned`, `banReason` and `banExpires`; `auth_session` gains `impersonatedBy` and `activeOrganizationId`; four new tables (`auth_organization`, `auth_member`, `auth_invitation`, `auth_passkey`) keep the `auth_` prefix. Columns and indexes are the schema Better Auth 1.7.11 generates for these plugins with SurveyBeat's model names, so no deploy-time push exists and `migrate: false` still holds.

**Surface.** The Worker forwards every `/auth/*` path it does not answer itself to Better Auth, so the plugin endpoints (`/auth/sign-in/magic-link`, `/auth/magic-link/verify`, `/auth/passkey/*`, `/auth/admin/*`, `/auth/organization/*`) are reachable on the Worker's own origin without a client library. The exact paths SurveyBeat answers, `/auth/organization` and `/auth/organization/choose` among them, keep priority; the plugin's nested routes do not collide with them.

## Considered options

- **Keep email codes as the only sign-in.** Rejected: the plugins are requested, and a mailed link is the shape that survives a mail client that breaks a code across lines.
- **Adopt the organization plugin as the tenant.** Still rejected, for the reason in ADR 0022: two sources of truth for Teams and People.
- **Let any signed-in user create a Better Auth organization.** Rejected: Organization creation is allowlisted (`infra/org-creation-allowlist.yaml`), and a second creation path would bypass that list.

## Consequences

- ADR 0022's "the organization plugin is not adopted" sentence is superseded by this ADR; its other decisions stand.
- The mail sender has a second delivery, `sendMagicLink`, beside `sendSignInCode`.
- The admin plugin's `banned` flag is enforced by Better Auth on its own endpoints. SurveyBeat's per-request check is unchanged: the Person must be active in the chosen Organization.
