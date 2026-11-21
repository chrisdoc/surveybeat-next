# Email rectification follows the account

GDPR Article 16 lets a Person correct their email address. The address is held in three places that must agree: Better Auth's `auth_user.email`, the D1 `person_index.email`, and `person.email` in each Organization Durable Object. Issue 309 changes it in all three, for one Person at a time, and leaves the stored history alone.

**Who may change it.** A signed-in Person changes their own address. Better Auth's email code proves they control the new one: `emailOTP` runs with `changeEmail: { enabled: true }` and without `verifyCurrentEmail`, because the signed-in session already vouches for the old address. `sendVerificationOTP` delivers type `change-email` through the same code-email path as sign-in, with its own wording; sign-in, email-verification and forget-password are untouched. Better Auth's own `/auth/email-otp/request-email-change` and `/auth/email-otp/change-email` answer 404 from the browser, because only the two routes below carry the checks and the propagation. Its sensitive-session check stays and `freshAge` is not set to 0: when Better Auth refuses the session (`UNAUTHORIZED`, `SESSION_EXPIRED` or `SESSION_NOT_FRESH`), the route answers `SignInAgainRequired` and the screen asks the Person to sign in again. Better Auth 1.7's sensitive-session middleware reads the session from the database and does not itself enforce `freshAge` for these two routes; SurveyBeat adds no age check of its own.

**Routes.** All need the same origin, answer 204, and are `NoResultData` in `PrivacyRegistry`.
- `POST /api/me/email-change` `{ email }` sends the code.
- `POST /api/me/email-change/confirm` `{ email, otp }` applies it.
- `POST /api/organization/people/:personId/email` `{ email }` is for an Organization admin, for a Person who has not signed in.

The address goes through `normaliseEmail`, and must also be printable ASCII and match `EmailAddress` (`parseRectifiedEmail`, next to `normaliseEmail`), so the stored value satisfies `email = lower(trim(email))` and stays `emailMatchable` (ADR 0022).

**Collisions are errors.** Better Auth answers success when the new address already has an account, which would hide the problem. Before the code is sent, before the change is applied, and before an admin write, SurveyBeat rejects with `EmailTaken` when the address is another account's `auth_user.email`, or a `person_index.email` whose `auth_user_id` is not this account. An unlinked `person_index` row is a collision for a signed-in change. The caller's own rows are not. The current address is `EmailUnchanged`.

**Confirm order, so a crash can be finished.**
1. Same-origin session; normalise; reject the current address and collisions.
2. Upsert `email_rectification` (`auth_user_id`, `old_email`, `new_email`; D1 migration `0013_email_rectification.sql`).
3. Call Better Auth `change-email` with the session. It verifies the code, sets `auth_user.email` and `emailVerified`, and its `Set-Cookie` goes to the browser the way sign-in's does.
4. Update every `person_index` row for the account, including rows with `removed_at` set.
5. In each Organization Durable Object those rows name, set `person.email` where `auth_user_id` matches and `erased_at IS NULL`. Repeating it changes nothing. A tombstone is never touched.
6. Delete the `email_rectification` row.

A wrong code deletes the row it just wrote and changes nothing. If the Worker stops after step 3, `auth_user.email` already equals the pending address; reading the session finishes steps 4 to 6 with no new code. Asking for that same address finishes them too, then answers `EmailUnchanged` and sends no code. While `auth_user.email` is the pending address, a different address is refused (`EmailChangePending`) until that change finishes. A pending row for another address is replaced only while `auth_user.email` is still the old one. Erasing the account (ADR 0027) deletes the row.

**Admin correction.** Only a Person of this Organization with `auth_user_id IS NULL` and `erased_at IS NULL`, removed or not, and only `person.email` and that `person_index` row change. A linked Person is refused with `PersonHasAccount`; they use the self-service routes. The address is refused when it is any `auth_user.email` or any `person_index.email` with a non-null `auth_user_id`. An unlinked row in a different Organization may use it, which is how one human is added twice before signing in. Inside the Organization the address is unique among non-erased People. The permission is `organization.correctEmail`, granted to the Organization admin only; the admin check comes before the D1 look-up, so a caller who is not an admin learns nothing about other accounts.

**What stays.** `email_send` and `email_message` bodies, `captured_email`, and the sign-in codes already issued are not rewritten: a past send went to the address that was live then. `linkPerson` is unchanged; it still links by an exact match on the verified email. Better Auth 1.7 stores the change-email code as `change-email-otp-<auth user id>:<new address>`. Erasure deletes every `auth_verification` row with that account's prefix, so the code and both addresses go when the account goes, including when `auth_user.email` has already moved. The colon after the account id is the boundary: a longer account id does not match. A row shaped like `change-email-otp-<old address>-<new address>` is not what this version writes, and erasure does not delete by address prefix, because `ada@example.co` would match `ada@example.co-op.com`.

## Considered options

- **Let the browser call Better Auth directly.** Rejected: nothing would check collisions or update the index and the Durable Objects, and a silent success would leave the three stores apart.
- **Require a code at the old address too (`verifyCurrentEmail`).** Rejected: the signed-in session already proves the old address, and a Person who lost access to it is exactly who needs to correct it.
- **Update the Durable Objects first.** Rejected: a crash would leave a Person row that no sign-in finds. Better Auth is the account's source of truth, so it moves first and the others follow from the pending row.
- **Rewrite past sends to the new address.** Rejected: it would change what the delivery log says happened.

## Consequences

- `OrganizationDirectory` gains `rectifyEmail`; `PeopleIndex` gains `correctEmail`; a new `EmailRectification` service owns the D1 side. `SessionIdentityProvider` gains `requestEmailChange` and `confirmEmailChange`.
- Objection (Article 21) and restriction (Article 18) are separate issues and not part of this change.
- The shipped legal pages are not changed by this decision.
