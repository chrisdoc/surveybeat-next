# Comment themes are computed once at close, need two comments, never quote, and can't be edited

When a Round closes and meets the minimum group size, and the Organization has AI processing on (ADR 0015), the Organization Durable Object asks the model for at most 5 Comment themes over the Round's redacted comments (ADR 0009). Each theme is a short label and one neutral sentence. The model also returns which comments support each theme, and the object keeps only themes supported by **at least two comments**. The result is stored with the Round's Result and never recomputed.

**Who sees what.** Members see each theme's label and sentence, never raw comments and never counts. The Lead sees the themes, how many comments support each, and the redacted raw comments, as in Release 1. Comments that fit no theme with two supporters stay visible only to the Lead.

**No quotes.** The prompt and the JSON schema ask for paraphrase, and a check rejects any theme that repeats 6 or more consecutive words of a comment; a rejected theme is dropped, not repaired. Exact wording or a personal style can identify the author.

**Failure.** The call retries with backoff for up to 24 hours. Until it succeeds, Results show "Themes are being prepared"; after that, Results stand without themes. The Review window (#89) never waits for themes.

**No editing.** The Lead cannot edit, hide, or reorder themes. A Lead who could hide an unflattering theme before sharing would undercut trust before features (SPEC §3.1).

## Considered options

- **Themes from a single comment:** rejected. Shown to the whole Team, a one-comment theme is one person's words in other words.
- **Redacted quotes under each theme** (the old glossary wording): rejected for the same reason as quotes in the sentence.
- **Recomputing themes on view:** rejected. It would call the model on every view, could change what people already saw, and needs the comments sent again.

## Consequences

- The privacy rule table gains rows: a theme never shown below N, never with fewer than two supporting comments, never containing a 6-word run from a comment, and never shown to members with counts.
- Small Teams with few comments often get no themes; the Lead still has the raw comments.
- Themes exist only for Rounds that close after AI processing is turned on.
