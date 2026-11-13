# A test Invitation is its own token kind, and its answers are never saved

A Lead or Organization admin can send themselves a test of a Pulse from the Pulse editor (issue #136). The test is the real Invitation email in the sender's language, with "Test" in the subject, the same one-tap rating links, and the real answer page. The flow runs to the end, including the "Your Lead will see: …" preview and the thank-you screen, but it stores no Submission, no Answer, and no Participation record, so nothing reaches Results, Comment themes, or member history. This amends the ADR 0005 flow for one new token kind. It does not weaken A1–A10.

**Token kind.**
- A test token is derived from `INVITATION_TOKEN_KEY` like an Invitation token, but under its own label: `test-invitation:v1:<pulseId>:<personId>:<testId>`, where `testId` is random per send. A test token can therefore never equal an Invitation token, and the key still never leaves the Worker environment.
- Only the token's hash is stored, in its own D1 table `test_invitation_index` (hash, Organization, Pulse, expiry). It is never written to `invitation_index`, and the Organization has no Invitation row for it. A test token expires 7 days after it is sent. Expired rows in both test tables are deleted whenever a new test goes out. Removing a Person deletes their `test_send` rows; their unexpired index rows hold no Person and simply lapse.
- The Organization stores only the send in `test_send` (send id, Person, Pulse, token hash, time) for the rate limit and for the Queue consumer to index the token once the email is sent, as it does for Invitations. Rows older than 7 days are deleted.

**Answering with a test token.**
- `/exchange` resolves `invitation_index` first. A miss falls back to `test_invitation_index`, and the Organization builds the context from the Pulse's saved Questions and settings, with `test: true`, no Round, `hasAnswered: false`, and the expiry as close time.
- `/first-answer` with a test token applies every check the real route applies (body-only credentials, A5, Edit key hash format). It then redacts the comment as the real path would, returns `{ saved: true, shownToLead }`, and writes nothing to the Organization. It records the Edit key hash in D1's `test_submission_index` (hash, Organization, Pulse, expiry), never in `submission_index`.
- `/answer` resolves `submission_index` first. A miss falls back to `test_submission_index`, and the answer is redacted and discarded the same way.
- The routes that write Submissions and Participation records (`recordFirstAnswer`, `saveAnswer`) are reachable only through `invitation_index` and `submission_index`, so a test token or a test Edit key cannot write a real answer. The privacy suite proves it.
- The answer page shows "This is a test. Your answers aren't saved." It keeps the test Edit key in memory only and does not keep the answers in the browser, so the member history page (ADR 0017) never shows a test.

**Who and how often.** Whoever may edit the Pulse (the Team's Lead and Organization admins, `team.editPulse`) may send a test, to their own address only. The Organization refuses a sixth send by the same Person within an hour. Non-production stages capture the email in D1, as for every other email.

## Considered options

- **A test Round with real Invitations, deleted afterwards.** Rejected: it would write Participation records and Submissions, and any missed cleanup leaks into Results and response rates.
- **A flag on the Invitation token or on `invitation_index`.** Rejected: one missed check would let a test write a real answer. Separate tables make the real write path unreachable.
- **Opening the answer page with a preview flag and no email.** Rejected: the Lead wants to see exactly what members get, including the email and its one-tap links.

## Consequences

- The Submission Worker reads two more D1 tables, and both hold hashes only, with no Person.
- Test answers are lost by design. The Lead cannot see them, and neither can anyone else.
- `test_send` stores a Person and a time, but nothing about answers.
