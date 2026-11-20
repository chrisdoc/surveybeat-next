# A CI job runs when the change can need its answer

The pull request workflow deployed a Cloudflare stage for every push and then proved it three times over: a smoke test, a privacy read-back, and the end-to-end suite. Every run paid the whole cost even when the revision was already superseded, and even when the diff could not change a deployed byte. Nothing was wrong with any single check; what was wrong is that a run started before it knew the answer was still wanted.

**What the workflow does now.** `preview.yml` asks two questions at the start of the `deploy` job, and each answer is a reason to stop before a runner installs anything:

- **Is this revision still the head of the pull request?** One `gh api` read of `pulls/<n>` and no checkout. The concurrency group is `cancel-in-progress: false` because cancelling a half-applied Alchemy deploy is worse than letting it finish, so without this guard every superseded revision took its turn ahead of the revision the author had already replaced. A revision that is no longer the head stops in about ten seconds; the newer run answers for the newer revision. A failed API read answers yes, because being unsure is a reason to run the check.
- **Can this diff change what the stage serves?** The answer comes from `scripts/ci/select.mjs`, which classifies the pull request's diff against its base: a diff of prose (`docs/`, any `*.md`), agent instructions, hooks or CI tooling gets no stage, and anything else does, including a mixed diff and an empty one.

`preview-privacy` and `e2e` consume the same classification through the `deploy` job's outputs, so the diff is read once per run instead of once per job, and a canary sweep or a Lighthouse gate cannot disagree with the job it depends on. The canary sweep and the Lighthouse build keep the path rules they already had; they now read them from one tested module rather than two inline `grep`s.

**What did not change.** `ci.yml` still runs typecheck, the ledgers, formatting, lint, the web build, the unit suite with coverage and the separate privacy job on every pull request and every push to `main`. The privacy suite is still its own required job. `deploy.yml` still deploys staging and production after every successful `main` run and still runs the staging canary sweep every time: a `workflow_run` on `main` does not carry the range of commits a push contained, so the set of affected paths cannot be established with the same certainty a pull request gives, and an uncertain selection runs the full proof. The end-to-end suite and the privacy read-back still run on every revision that gets a stage.

## Considered options

- **`cancel-in-progress: true` on the preview group.** Rejected: it interrupts a running `alchemy deploy` or `destroy`, and the state store and the Cloudflare resources can disagree when an apply stops halfway. The revision guard removes the same wasted work without interrupting anything.
- **Wait for a quiet period before deploying a stage.** Rejected: it delays feedback on every revision to save work on some, and an agent that pushes once waits for a timer that bought nothing.
- **Path filters on the workflow's `on:` block.** Rejected: a filtered-out run reports no check at all, so a reviewer cannot tell "not needed" from "not reported", and a required check that never reports blocks a merge.
- **Skip the canary sweep on `main` by diffing the pushed range.** Rejected for now: the payload of a `workflow_run` event does not say how many commits the push carried, so a diff of the tip alone can miss a Submission-path change earlier in the same push. The privacy invariants are release blockers (SPEC §7), so this one keeps running the full proof.
- **Shard the unit suite.** Rejected on measurement, not principle: the suite is 82 test files and finishes in 18 s locally (62 s on a hosted runner), so a second runner's setup costs more than the shard saves. Revisit only if one file's runtime starts to dominate; `packages/cloudflare/src/Organization.test.ts` (12.9 s) is the file to watch.
- **Affected-test selection for the unit suite.** Rejected on the same measurement: with the whole suite inside a minute, a selector's own runtime, its rules and its failure mode are a poorer trade than running everything. Path selection pays where the per-run cost is minutes, which is the stage, not the suite.

## How the decision was checked

The gates were replayed against the repository's own history before they were trusted, and the result corrected the assumption that started the work:

- **The revision guard.** Replaying the last 100 preview runs (37 branches) skipped 2 runs, for 1.3 runner-minutes forgone. The saving is not in that number: pushes here are usually five or more minutes apart, and a run holds its concurrency group for about four and a half minutes, so a queued revision is rarely already stale when it starts. The guard pays when three or more pushes land inside one run's wall time, which is what an agent loop does and what this history shows twice. It costs one API read and no checkout, so it stays as insurance rather than as a saving.
- **The stage gate.** Of the last 100 preview runs (227.8 runner-minutes across 37 branches), 2 belonged to pull requests whose diff was prose only: 8.9 runner-minutes, about 4% of the preview workflow's compute in that window, and each of those pull requests now reaches its answer in about thirty seconds instead of waiting roughly five minutes for a stage it does not need. A wider sample of the last 100 pull requests puts the rate at 7 in 100, so the share grows with documentation work.
- **The baseline.** `node scripts/ci/runner-minutes.mjs --days 7` measured 918 runner-minutes over 7 days, 131 per day and about $31 per 30 days at `$0.008` per minute, split CI 312, Preview 363, Deploy 243. The team is on GitHub-hosted `ubuntu-latest` runners, so the reduction available here is a few dollars a month, not the order of magnitude that a sponsored-runner fleet can show. What is worth protecting is feedback time and the habit of not starting work that nobody needs.

## Consequences

- A pull request that only touches prose finishes without a stage. Its privacy read-back, canary sweep, Lighthouse gate and end-to-end suite report nothing to review, because there is no stage to review. The `destroy` job still runs when that pull request closes: it plans deletion from persisted Alchemy state, so a stage that was never created leaves it nothing to delete, and skipping it would risk an orphaned stage from an earlier revision that did deploy.
- A superseded revision reports the `deploy` job as a success in about ten seconds and leaves the stage work to its successor. The GitHub environment record for that revision still exists, because the job starts before it decides; it names the stage URL that the newer run deploys.
- A shell step in a workflow cannot be unit-tested; the classification now lives in `scripts/ci/select.mjs` with `select.test.ts` beside it, and the workflow only reads its `true`/`false` output. Run `pnpm test scripts/ci/select.test.ts` before changing a path rule.
- The two path rules that predate this decision are unchanged; `select.test.ts` locks them, so a future edit has to fail a test rather than drift quietly.
- Re-measure with `node scripts/ci/runner-minutes.mjs --days 7` after a change, and read cost beside feedback time, because a cheaper run that reports later is not a saving.

