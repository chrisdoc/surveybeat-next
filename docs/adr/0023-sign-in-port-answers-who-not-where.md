# The sign-in port answers who is signed in, not where

ADR 0022 moved sign-in into Better Auth and left the WorkOS-shaped `IdentityProvider` in place. That port does two jobs at once: it reads a session, and it asks the provider where the person belongs — an AuthKit organization, an organization-selection prompt, a membership with a role. Better Auth has no organizations at all, and SurveyBeat never wanted the provider to own them (ADR 0006, ADR 0003). This ADR splits the two jobs so the route swap in the next slice has a port to talk to.

**The session port.** `SessionIdentityProvider` in `packages/domain/src/people/SessionIdentity.ts` has two calls: `authenticate(cookie)` returns the `Identity` plus the provider session id, or `Unauthenticated`; `revokeSession(sessionId)` deletes the session. `BetterAuthIdentityProvider` implements it by reading `auth.api.getSession` with the `__Host-surveybeat-session` cookie and, on revoke, deleting the `auth_session` row by id. Nothing is sealed any more: the cookie value is Better Auth's own session token, so a session check costs one D1 read rather than a provider call, and there is no refresh that re-issues a cookie. The WorkOS-shaped `IdentityProvider` keeps serving `/auth/*` until the routes move; then it, `CodeExchange`, `ProviderSession.sealed`, `refresh`, `logoutUrl`, `authorizationUrl` and `authenticateWithCode` are deleted.

**The picker.** A picker only exists because a human can be several Persons. That fact already lives in `people_index` and the Organization's own people table, and `decideSignIn` already builds the candidate list from `PeopleIndex` and `OrganizationPeople`. So the picker stops being a provider concept: no AuthKit organization id, no `OrganizationSelectionRequired`, no pending-authentication token, and no provider round trip when someone chooses. `/auth/organization/choose` resolves the chosen `OrganizationId` against the same candidates and sets nothing in the cookie, because the session is one session across organizations. The `workos_organization_id` column, `organizationByWorkos` and `workosOrganizationOf` go with it.

**Membership.** The provider kept a second copy of membership: `createOrganization`, `ensureMembership`, `setMembershipRole`, `deactivateMembership`. All four leave the port. The Organization is the Durable Object tenant, its `person` rows are the membership, and `organizationAdmin` is a fact in that object (ADR 0003). Nothing writes an admin flag to an auth user, and nothing syncs a role outward, because there is nowhere outward to sync to. The one provider-side id that used to be stored in `people_index` (`workos_user_id`) becomes the Better Auth user id; `PersonId` stays SurveyBeat's own id and `session.user.id` is never treated as one.

**The HTTP surface.** `/auth/logout`, `/auth/session`, `/auth/organization` and `/auth/organization/choose` keep their paths and their responses. `/auth/login` still starts sign-in, but it can no longer redirect to a hosted AuthKit page: the Foldkit app asks for an email address, posts it to Better Auth's code endpoint, and the code returns the session cookie that `/auth/session` already reads. `/auth/callback` exists only because AuthKit redirects, so it goes; the paths in #200 never listed it. Sign-out deletes the session row and answers 303 to the app, since there is no hosted logout page left to redirect to.

**Revocation.** Deleting the row is the revocation. The `revoked_session` deny list stays until a test shows a deleted session is refused on the next request with no extra row; then the table and that part of ADR 0010 go in the same change.

## Considered options

- **Keep the WorkOS-shaped port and implement it over Better Auth.** Rejected: it would need an authorization URL, an organization-selection exchange and membership writes that Better Auth cannot perform, so the adapter would either lie or die on paths the routes still call.
- **Keep the organization picker in the provider by adopting Better Auth's organization plugin.** Rejected in ADR 0022: a second tenant next to the Durable Object.
- **Sync Better Auth's user id into `person_index` as the membership key and drop the Person's email lookup.** Rejected: an email still links an unlinked Person before the first sign-in, and `person_index` already holds that evidence.
- **Rename `WorkosUserId` in the same change as the port.** Rejected for now: the rename touches every domain, D1 and Durable Object call site, and the live WorkOS routes would have to be rewritten twice. The port and the adapter land first; the rename lands with the route swap.

## Consequences

- `BetterAuthIdentityProvider` and its tests land while WorkOS still serves, so the port is proven against both the in-memory adapter and the real D1 migration before a single route changes.
- The route swap is smaller: `AuthHandlers` loses the callback handler and the state cookie, and `MainWorker` provides `SessionIdentityProvider` instead of `IdentityProvider`.
- `packages/cloudflare/d1-migrations` needs one more migration to stop storing `workos_organization_id` and to keep `workos_user_id` as the Better Auth user id, which the route swap carries.
- The sign-in screen gains an email field, which the web app does not have today; that is the first UI change this issue makes.
