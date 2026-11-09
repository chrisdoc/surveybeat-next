# The domain package is organised as built: Submissions and Results live in `rounds/`

Amends the folder list for `packages/domain` in ADR 0008, which named `people/`, `pulses/`, `rounds/`, `answering/`, `results/`, `actions/`, and `privacy/`. The `answering/` and `results/` folders were never created. As built, the concept folders are `people/`, `pulses/`, `rounds/`, `actions/`, `privacy/`, and `email/`:

- `rounds/` holds Round, Lifecycle, `Submission.ts`, and `Results.ts` (result computation and minimum group size, ADR 0004). A Submission and a Result are both defined by their Round, and they change with its lifecycle, so they stay together.
- `email/` holds `EmailSender`, templates, and send states (R1 05); ADR 0008 did not list it.

The dependency rule is unchanged: `domain` depends only on `effect`.
