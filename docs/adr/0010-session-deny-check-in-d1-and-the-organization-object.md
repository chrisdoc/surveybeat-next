# Each request checks revoked sessions in D1 and the Person's status in the Organization Durable Object

A WorkOS access token is verified locally and stays valid until it expires (about 5 minutes), even after its session is revoked. To make revocation take effect on the next request, the Main Worker adds its own deny check after the JWT check. It has two parts, each kept where its data already lives:

- **Revoked sessions are in D1** (`revoked_session`, keyed by the token's `sid`). Sign-out writes the row, then calls WorkOS `revokeSession` so the refresh token stops working too, then redirects to WorkOS's logout. If WorkOS cannot be reached, sign-out answers 503 but the row is already written and the cookie is still expired. The key is the session, not the Organization, because one WorkOS session moves between Organizations when it is refreshed into another one, and an Organization-less session (first sign-in, the picker, "Create an Organization") has no Durable Object to ask. D1 has a single primary and read replication stays off, so the next read sees the write.
- **"Person removed" and "Membership ended" are in the Organization's Durable Object**, which owns People and Memberships (ADR 0006). When the token is scoped to an Organization, the check asks that object for the user's active Person. A user with no active Person there keeps the session, but without an Organization: they get the picker or "not part of an Organization", not a 401. Only a revoked session is refused outright. WorkOS keeps a refreshed session in its organization, so nothing may trust the token's organization on its own. Mirroring removals and Membership end dates into D1 would add a second copy that can lag the first, and the Durable Object is called on nearly every Organization request anyway.

The D1 read and the Organization lookup run concurrently, then the Durable Object is asked.

## Considered Options

- **KV for the deny list.** Rejected by SPEC §6.2: KV is eventually consistent, so a revoked session could keep working for up to a minute in other locations.
- **Everything in the Organization Durable Object.** Rejected: sessions without an Organization would have no place to be revoked, and a session refreshed into another Organization would escape a revocation recorded in the first.
- **Everything in D1.** Rejected: Person and Membership state would have to be copied from the Durable Object on every change.
- **Calling WorkOS `revokeSession` alone and relying on short tokens.** Not enough: the token keeps working until it expires. Sign-out calls it as well as writing the deny list.

## Consequences

- Every signed-in request costs one D1 read, plus one Durable Object call when it is in an Organization.
- `GET /auth/session` has side effects: it links a Person, creates the WorkOS membership, and finishes an open Organization claim. Each is idempotent and is only what that user is entitled to, so a cross-site top-level GET (which carries the `SameSite=Lax` cookie) can at most do early what their next visit would do.
- `revoked_session` rows can be deleted once they are older than the longest WorkOS session. Nothing prunes them yet.
- Slice 04 must deactivate the WorkOS organization membership when it removes a Person, so that AuthKit stops putting the user back into that Organization at sign-in.
