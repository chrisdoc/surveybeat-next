# Offboarding returns no Results, and deleting an Organization wipes both stores

GDPR Article 28(3)(g) asks the processor to return or delete the controller's data when the service ends. SurveyBeat does both for an Organization, and issue 308 adds the second operation. Returning the data does not give an Organization admin every Team's Results. ADR 0003 stands: the Organization admin role grants no access to Results, comments, or Actions without a Membership in that Team. ADR 0014 is unchanged. Anonymous aggregates are destroyed with the tenant, not handed to an admin who has no Membership. A Lead downloads nothing new here; they use the product before offboarding.

**The export** (`GET /api/organization/offboarding-export`, Organization admin only, `organization.offboard`) holds only records an Organization admin can already administer:
- the Organization: id, name, minimum group size, AI processing flag, default language;
- Teams: id, name, time zone;
- People: id, address, `organizationAdmin`, language, time zone, `removedAt`, `erasedAt`. An erased Person already has the tombstone address (ADR 0027); the original is never recovered;
- Memberships, including ended ones: id, Team, Person, role, `startedAt`, `endedAt`;
- Pulses and their Questions (wording and settings), because `team.viewPulses` and `team.editPulse` already include the admin.

It holds no Result, comment, theme, Action, Note, Submission, Answer, participation, Invitation token, token hash, Edit key, email body, auth user id, or session.

**Deleting** (`POST /api/organization/offboarding` with `{ confirmation }`) is irreversible and needs `organization.offboard`, granted only to the admin. A Lead or member gets 403, and the caller's own Person is no substitute. The typed confirmation must equal the Organization's stored name exactly; a wrong name is `ErasureNotConfirmed` (422) and changes nothing. The sole Organization admin may delete: it is neither `LastAdmin` nor `LastLead`. The route needs the same origin, like erasure.

**Crash order.** The Durable Object is the system of record and D1 holds the global index, so the two stores are deleted in a fixed order that a retry can finish:
1. The handler authenticates the session cookie. When `organization_offboarding` already has a row for that account, that row's Organization is the one to finish. The handler does not resolve a Member and does not read the Organization Durable Object to find one, including when the session is also a Member of a different Organization.
2. Otherwise the handler resolves the Member the way `currentMember` does. If the Durable Object still has this Person as an Organization admin, the typed name is required and `organization_offboarding` (migration `0012_organization_offboarding.sql`: `organization_id`, `actor_user_id`, `confirmed_at`) gets a row for the sign-in account. An existing row must belong to the same account.
3. A pending row is finished without asking for the name again. The typed name is ignored, so an Organization with the same name cannot be selected in its place.
4. Anyone else is `Forbidden`. A wrong name on a first confirmation writes no row and deletes nothing.
5. D1 loses this Organization's `invitation_index`, `test_invitation_index`, `test_submission_index`, `submission_index` and `auth_session_organization` rows, so Invitation tokens and Edit keys fail closed in `PageRoutes` and `SubmissionRoutes`.
6. The Organization Durable Object runs `deleteAlarm()` and then `deleteAll()` and nothing after it, so a table added later cannot be missed. The call is safe on empty storage. Before the storage calls, the live isolate records that it is wiped, and `activePerson` then returns no Person without reading SQLite. A later isolate applies migrations to empty storage and also finds no Person. `GET /auth/session` shows the account as not in an Organization, and the same account finishes from that screen or from the Organization picker. Choosing the wiped Organization is refused.
7. D1 reads `person_index.auth_user_id` for the Organization, then in one batch (all or nothing) deletes the `captured_email` rows whose `message_id` is among the Organization's `email_message` rows (never by recipient), then `email_message`, `person_index`, `organization_claim`, `organization_offboarding` and `organization_index`.
8. For each collected account the existing `eraseAccount` path runs. It keeps the account while any `person_index` row remains, including one with `removed_at` set, in another Organization.

`auth_organization`, `auth_member` and `auth_invitation` are not touched; they are unused Better Auth plugin tables (ADR 0022), not SurveyBeat Organizations. Another Organization's rows and Durable Object stay. A crash after the wipe and before the `person_index` delete is finished by the same admin, because the offboarding row remains and the wipe is idempotent. A crash before the row is written leaves everything as it was.

**Backups.** Cloudflare point-in-time recovery copies are not deleted by the app (ADR 0005). The confirmation screen says they expire after `Policy.backupRetentionDays` (30) days, read from that constant so the number cannot drift.

## Considered options

- **Give the admin every Team's Results in the export.** Rejected: it contradicts ADR 0003 and puts leadership roll-ups in through a side door.
- **Delete the Durable Object's tables one by one.** Rejected: a table added later would survive. `deleteAll()` is the wipe.
- **Block deletion for the sole admin like `LastAdmin`.** Rejected: the sole admin is exactly who offboards.
- **Delete D1 first, then the Durable Object.** Rejected: a crash between them would leave an Organization that nobody can reach and nobody can finish deleting. The offboarding row and the idempotent wipe let the same admin finish.

## Consequences

- `OrganizationDirectory` gains `offboardingExport` and `confirmOffboarding`; a new `OrganizationOffboarding` service owns the D1 side. The Organization class gains `viewOffboardingExport`, `confirmOffboarding` and `wipeOrganization`. A pending offboarding is finished before any other Organization is considered. The screens for no Organization and for choosing an Organization can finish a deletion that was already confirmed.
- Two endpoints join `PrivacyRegistry` as `NoResultData`.
- A sign-in account that had a Person only in the deleted Organization is erased with it. Accounts collected in step 7 are lost if the Worker stops between steps 7 and 8; such a human erases the account through `me.eraseAccount`.
- The shipped legal pages are not changed by this decision.
