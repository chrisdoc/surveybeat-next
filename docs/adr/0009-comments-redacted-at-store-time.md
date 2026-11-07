# Comments are redacted when stored, and the raw text is never kept

Release 1's rule-based redaction (ADR 0001) runs in the Submission Worker as the comment is saved. It uses the Organization's roster at that moment, and only the redacted text is stored. The raw text exists only in that request's memory. It is never logged, stored, or sent to a model. We rejected keeping the raw text and redacting each time a comment is shown, for two reasons. Deleting a Person would take their name out of the roster and expose it in every old comment that mentions them. And raw comments at rest would be the most identifying data SurveyBeat holds.

**What is removed:**
- first names, last names, full names, and email local parts of every Person in the Organization, matched as whole words, ignoring case, width, and accents (names shorter than 2 characters are ignored);
- email addresses, phone numbers (7 or more digits with common separators), @handles, and every URL.

Each match becomes a placeholder (`[name]`, `[email]`, `[phone]`, `[handle]`, `[link]`). A comment is never held back as a whole. Roster names that are also ordinary words ("will", "may") are redacted anyway.

## Consequences

- Redaction is permanent. A false positive can't be undone, and a member who edits their comment edits the redacted text.
- People added to the roster later are not redacted from older comments.
- No nicknames, no names outside the roster, and no "unusual identifying phrases" in Release 1. The answer page says exactly what is and isn't removed.
- The Release 2 AI pass can only ever run on new comments, because the raw text of older comments no longer exists.
