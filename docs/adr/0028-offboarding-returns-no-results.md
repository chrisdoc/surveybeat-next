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
1. The handler resolves the session and the Organization the way `currentMember` does.
2. If the Durable Object still has this Person as an Organization admin, the typed name is required and `organization_offboarding` (migration `0012_organization_offboarding.sql`: `organization_id`, `actor_user_id`, `confirmed_at`) gets a row for the sign-in account. An existing row must belong to the same account.
3. If the Durable Object no longer has the Person, the handler continues only when `organization_offboarding.actor_user_id` is the session's account, and does not ask for the name again.
4. Anyone else is `Forbidden`. A wrong name writes no row and deletes nothing.
5. D1 loses this Organization's `invitation_index`, `test_invitation_index`, `test_submission_index`, `submission_index` and `auth_session_organization` rows, so Invitation tokens and Edit keys fail closed in `PageRoutes` and `SubmissionRoutes`.
6. The Organization Durable Object runs `deleteAlarm()` and then `deleteAll()` and nothing after it, so a table added later cannot be missed. The call is safe on empty storage.
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

- `OrganizationDirectory` gains `offboardingExport` and `confirmOffboarding`; a new `OrganizationOffboarding` service owns the D1 side. The Organization class gains `viewOffboardingExport`, `confirmOffboarding` and `wipeOrganization`.
- Two endpoints join `PrivacyRegistry` as `NoResultData`.
- A sign-in account that had a Person only in the deleted Organization is erased with it. Accounts collected in step 7 are lost if the Worker stops between steps 7 and 8; such a human erases the account through `me.eraseAccount`.
- The shipped legal pages are not changed by this decision.
