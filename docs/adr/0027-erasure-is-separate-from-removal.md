# Erasure is a separate, irreversible operation from Remove from Organization

GDPR Article 17 and SPEC §5.3 require that a Person can have their personal data deleted. Remove from Organization (`RemovePerson`) is not that: it is offboarding. It ends Memberships and access, keeps the Person's address so an access export can still find them (`person_index.removed_at` stays set, sign-in reads only rows with `removed_at IS NULL`), and an Organization admin can add the same address back. Issue 307 adds the second operation without changing the first.

**Erase personal data** scrubs one Person inside one Organization, in one Durable Object transaction, and then cleans D1.
- The `person` row stays so `membership` and `action` rows keep their foreign keys. Its `email` becomes `erased-<personId>@erased.invalid`; `auth_user_id`, `time_zone`, `locale` and `detected_locale` become `NULL`; `organization_admin` becomes `0`; `removed_at` and the new `erased_at` are set (migration `0020_person_erased_at.sql`). Active Memberships end.
- `participation`, `round_member`, `invitation`, `pulse_reminder_opt_out` and `test_send` rows for the Person are deleted. The `email_send` rows addressed to them are deleted with their `email_outbox` rows, which removes the address and the body; an `AddedToTeam` email to someone else that names the Person as the adder gets the tombstone address. A send that is deleted is treated as missing by delivery, so a pending one never goes out.
- D1 loses that Person's `person_index`, `invitation_index` and `test_invitation_index` rows, the `email_message` and non-production `captured_email` rows of the deleted sends, and the `organization_claim` for that Organization. When the human then has no `person_index` row left, the whole sign-in account goes: sessions (which ends every cookie, ADR 0010 and ADR 0022), accounts, passkeys, verification codes, `auth_member`, `auth_invitation` and `auth_user`. A human who has an account but no Person erases the account through its own endpoint, which refuses while a Person is left.
- `submission`, `answer` and `round_result` are never read or written by erasure. Anonymous Submissions carry no Person (ADR 0005), so they stay unlinkable and the aggregates stay as computed.
- `action.owner_id` stays. The API returns `ownerEmail: null` for an erased owner and the app shows "Former member", never the tombstone address.
- A later sign-in with the same address finds no `person_index` row and no `person.email` that matches, so it creates or links a new Person. The tombstone is never revived.

**Who may call it.** The signed-in Person erases their own data through `POST /api/me/erasure`, which takes the Person from the session and no id from the request. An Organization admin erases a Person through `POST /api/organization/people/:personId/erasure`, including a removed Person who never signed in. Both require the Person's address typed as confirmation, so one click is not enough, and both need the same origin. A Person who is the only Lead of a Team or the only Organization admin is refused (`LastLead`, `LastAdmin`) until the role is handed over. Deleting an Organization is not part of this change.

**Retry.** The D1 steps run after the Durable Object commit. If the Worker stops between them, erasing the same Person again repeats the follow-ups without needing the old address, because the Durable Object accepts an already erased Person. Only an Organization admin can do that, since the erased Person no longer has a session.

## Considered options

- **Delete the `person` row.** Rejected: `membership.person_id` and `action.owner_id` reference it, and the history must stay.
- **Scrub `email_send` in place.** Rejected: the stored content must keep decoding as a `StoredEmail`, and a failed send could be resent to the tombstone. Deleting the row removes the address and the body and delivery already skips a missing send.
- **Turn Remove from Organization into erasure.** Rejected: removal is reversible and keeps the export path for an access request; erasure is neither.

## Consequences

- `PeopleIndex` gains `erasePerson` and `eraseAccount`; `PersonRecord` gains `erasedAt`; Organization settings list removed, not yet erased People so an admin can erase them.
- The privacy page carries the self-service erasure next to the personal-data export, and a confirmed erasure clears this browser's `sb_answers_` and `sb_edit_` entries. `/history` still clears kept answers only.
- The shipped legal pages are not changed by this decision.
