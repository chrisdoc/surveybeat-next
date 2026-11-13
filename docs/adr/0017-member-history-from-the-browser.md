# A member's history page reads past answers only from their own browser

The member's private history page lists the Rounds the member took part in, from their Participation records, which the server already holds with a Person and no answers (ADR 0005). Their own past answers come only from their own browser: when the answer page saves a Submission, it also keeps the member's answers in local storage next to the Edit key, for one year, and the member can clear them. For each Round the page shows the member's own answer beside the Team's score, but only once the Result is shared and the aggregate meets the minimum group size.

The server never learns which Submission is the member's. A new device or cleared browser data shows the Rounds without answers, and the page says why.

## Considered options

- **Server-side history encrypted with a key only the member holds:** rejected for Release 2. Key recovery across devices is hard to get right, and any server-side record of a member's answers, encrypted or not, weakens the A1–A10 invariants (ADR 0005) that the privacy suite proves.
- **Only the Team's Results the member took part in, no own answers:** too little to be worth a page.

## Consequences

- Answers stay on one device. The page must state this plainly.
- Comments are kept in the browser as the member typed them, not redacted; they never leave the device.
- Clearing site data or a private window loses the history. Nothing on the server can restore it.
