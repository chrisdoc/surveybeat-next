# The discussion guide is written by the AI, in the same call as the themes, for the Lead only

When a Round closes and meets the minimum group size, and the Organization has AI processing on (ADR 0015), the call that writes the Comment themes (ADR 0016) also writes the Round's discussion guide. It has four sections: what stood out, what people raised, Actions to check on, and at most 3 questions to ask the Team. A Round without comments still gets a guide from its scores and Actions.

**Input.** This extends ADR 0015's list of what may be sent: the Dimension scores and changes (with which are flagged as larger than usual), the redacted comments, the Question text, and the titles of open Actions passed through the same Redaction (ADR 0009). Never an Action owner, a Person, or any name, id, or time.

**Rules.** The guide never quotes (the 6-word-run check of ADR 0016 applies to every section), never says or guesses who said what, and must match a strict JSON schema. A guide that fails a check is dropped as a whole.

**No AI, no guide.** There is no rule-based fallback. With AI processing off, the Lead sees a line saying an Organization admin can turn it on. If the call fails for 24 hours, the Round has no guide.

**Lead only, as generated.** The guide is stored with the Result, generated once, shown only to the Lead on the Results page with a "Copy as text" button, and cannot be edited in SurveyBeat. After the conversation, the Lead can write a Note on the Results page that the Team sees.

## Considered options

- **Rules-written guide with optional AI questions:** rejected by the product owner; the guide is the AI's job.
- **A separate call for the guide:** rejected; it would send the comments twice.

## Consequences

- The guide exists only for Organizations that turn AI processing on, and only for Rounds that close afterwards.
- The privacy rule table gains rows for the guide: never below N, never shown to members, never containing a 6-word run from a comment, never naming an Action owner.
