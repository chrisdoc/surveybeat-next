# Release 1 shows comments to the Lead after rule-based redaction only

SPEC §5.3 says that in anonymous Rounds the Lead sees comments only after an AI redaction pass followed by a rule-based check. AI redaction ships in Release 2. Release 1 still collects comments: long-text Questions and the optional "Want to say more?" field on rating Questions. The Lead sees them only when the Round meets the minimum group size, and only after a rule-based pass removes names from the Organization's roster, email addresses, and phone numbers. Before the first Question, the answer page tells the member that the Lead reads their comment as written, with names and contact details removed. Members see no comments in Release 1, because members see only Comment themes, and themes ship in Release 2.

## Considered Options

- **No text in Release 1.** Rejected: without what people wrote, the Understand step of the loop is half built, which repeats the old product's gap.
- **Collect text, show the Lead only a count until Release 2.** Rejected: the comments are delayed until Release 2, so dogfooding gets nothing from them in the meantime.
- **Raw comments behind N, with a disclosure.** Rejected: it drops the redaction rule entirely, against "trust before features".

## Consequences

Comments collected in Release 1 never get the AI pass retroactively unless a later decision says so. The rule-based pass stays in Release 2 as the check that runs after the AI step.
