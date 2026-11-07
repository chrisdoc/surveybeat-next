# People join an Organization only by being added, and are linked by verified email

In Release 1, a sign-in never creates or joins an Organization on its own. Creating an Organization is self-serve but limited to an operator allowlist, because an open Organization lets anyone have SurveyBeat email arbitrary addresses from our domain, and Cloudflare Email Sending allows transactional mail only. Everyone else joins because a Lead or an Organization admin added them. Adding someone creates a Person (email only) and a Membership, and sends one "you've been added" email of our own. No WorkOS invitation is sent. When that Person first signs in, the Worker links their WorkOS user to the Person by an exact match on a verified email, and only then creates the WorkOS organization membership.

## Considered Options

- **WorkOS invitations.** Rejected: members answer Rounds without ever signing in, so a pending invitation that expires in 7–30 days is the wrong model, and it would send a second, WorkOS-branded email.
- **Joining automatically by verified email domain (WorkOS JIT).** Deferred to Release 3 with SSO. Free-mail domains make it unreliable for small teams.
- **Blocking a second Organization for the same company.** Rejected for Release 1: warning someone that "example.com already uses SurveyBeat" tells outsiders who our customers are.

## Consequences

The global index needs an email → Organizations lookup for Persons with no WorkOS user yet. A sign-in with an unverified email never links. Two Organizations for one company can exist and cannot be merged until a later release decides how.
