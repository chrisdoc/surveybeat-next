# The minimum group size applies per aggregate, never loosens for the past, and Release 1 has no live Results

Every number SurveyBeat shows is checked against the minimum group size (N) on its own Contributors: a Question counts the Submissions that answered it, and a Dimension score uses only Questions that meet N themselves, so a hidden Question cannot be recovered by subtraction. Each Round records the N it closed under and is always shown under the stricter of that and the current N. Raising N hides past Rounds, but lowering N never reveals a Round that members answered under a stricter promise. Release 1 shows no Results while a Round is Open, for Teams of any size, only the response count. This drops SPEC §5.3's live updates for Teams of 2N or more, which would let a Lead time a new response against a member who just said they answered.

## Consequences

- Rounds never pool: two Rounds below N are not combined.
- A Round that never reaches N keeps its Answers hidden permanently.
- Comments are gated on the Round's Submission count rather than per comment, and are shown unlinked from their Submission's ratings and from each other. This keeps them from adding up to a profile of one member.
