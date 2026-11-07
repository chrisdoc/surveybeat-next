# Anonymous Submissions store no person and no time, and are unlinkable at rest, not against a restore

**Threat model.** The Lead, Organization admins, and anyone using the product (UI, API, exports) must never be able to link a member to their Submission, and neither can an operator reading stored data, dumps, or R2 backups. We do **not** claim to defend against an operator who restores the Durable Object to a past moment (point-in-time recovery replays every write, including the one transaction that writes a Participation record and its Submission), reads Cloudflare's internal edge logs, or changes the code to start logging. Against that we use controls instead: only named people can trigger a restore, the privacy page states the 30-day restore window, and code changes on the submission path need review. The answer page's "Your name is never stored with your answers" is true of everything stored.

**Design.**
- Everything lives in the Organization's Durable Object. There is no per-Round object. The first Answer writes the Participation record and a Submission holding that one Answer in **one transaction**, which is how a double submission is rejected (a unique Participation record per Round and Person).
- An anonymous Submission stores only its Round, its Answers, and an Edit key hash. It stores **no person, no Invitation, and no time at all**, not even the day SPEC allows. A Participation record stores Round, Person, and the fact of answering, also with no time.
- Submission and Answer tables are `WITHOUT ROWID` with random 128-bit keys. Reads aggregate or sort by the random key. Dumps and backups are written in key order.
- **The anonymous Submission table has no person column, ever.** Attributed Submissions get their own table, so no bug can put a name on an anonymous answer.
- The Invitation token travels in the **URL fragment**, so the answer page GET (and every link scanner) never sends it. The page POSTs it to a **separate Submission Worker** with logs, traces, tail, Logpush, and Analytics Engine writes all off. That Worker logs error codes only. Tokens are stored only as hashes.
- The **browser generates the Edit key** and sends only its SHA-256 hash with the first Answer. Later Answers and changes carry only the Edit key. **No request may carry both an Invitation token and an Edit key**, and the server rejects one that does.

## Considered Options

- **Submissions in a separate Durable Object.** Rejected: without one transaction, a crash either loses the Answer or allows a second Submission, and the timing gap still exists.
- **Shuffled batch writes.** Rejected: buffered Answers are lost if the object is evicted, and it defends only against the restore threat we don't claim to cover.
- **A nullable person column shared with attributed mode.** Rejected: a single bug would put names on anonymous answers.

## Consequences

Response and answer counts come from Participation records. Answer latency is measured only in tests on a preview stage. Deleting a Person deletes their Participation records, and their anonymous Submissions survive. A member who loses the Edit key cannot change their answers, and that is accepted.
