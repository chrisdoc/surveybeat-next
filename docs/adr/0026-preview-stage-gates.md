# Preview stages are gated by what the revision changes

The preview workflow was the largest single CI cost, and it decided most of its work only after it had started. Every push deployed a stage, smoke tested it, read back its privacy settings and ran the end-to-end suite. That happened even when the pull request had already moved on, and even when the diff could not change a deployed byte.

## Context

Baseline from `node scripts/ci/runner-minutes.mjs --days 7`, over the seven days to 2026-11-17:

| Workflow | Runs | Runner minutes | Per job |
| --- | --- | --- | --- |
| CI | 153 | 312 | check 1.6m, privacy 0.4m |
| Preview | 118 | 363 | deploy 1.2m, e2e 1.9m, preview-privacy 1.7m, destroy 0.7m |
| Deploy | 60 | 243 | staging deploy 0.8m, staging-e2e 1.0m, staging-privacy 1.9m, production 0.9m |
| All | | 918 (131 per day, about $31 per 30 days at $0.008 a minute) | |

A pull request's required answer arrives in about 90 seconds. The preview stage adds about 4.8 runner minutes and about five minutes of wall time per revision. The runners are GitHub-hosted `ubuntu-latest`, so the money at stake is small. Feedback time and work nobody needs are the point.

The whole test suite is 82 test files and finishes in 18 seconds locally. At this size, sharding and dependency-based test selection would cost more than they save. What transfers is the order: decide before paying for setup, and make the decision inspectable and tested.

Backtest against this repository's last 100 preview runs:

- The superseded-revision guard would have skipped 2 of them (1.3 runner minutes). It pays when three or more pushes land inside one run's ~4.5 minutes, which is an agent loop rather than today's cadence.
- The prose-only gate covers 2 of them (8.9 runner minutes, about 4% of preview compute) and 7 of the last 100 pull requests. Documentation work is a real share of this repository's changes.

## Decision

The preview workflow starts with a `select` job. It runs before checkout and before any install, and it sets four outputs: `head`, `stage`, `canary` and `lighthouse`.

- **Superseded guard.** The first step reads the pull request's current head SHA. If the revision is no longer the head, `head` is false and every later job in the run is skipped. A newer revision owns the stage. If the read fails, `head` is true: being unsure is a reason to run.
- **Path rules in tested code.** `scripts/ci/select.mjs` classifies the changed files, and `scripts/ci/select.test.ts` locks every rule. The canary rule (the Submission path) and the Lighthouse rule (the answer entry) are the regular expressions the workflow already used, moved verbatim. The canary also covers `scripts/ci/`, because a pull request that changes the gates must run them.
- **Changed files.** The list comes from the compare endpoint, addressed by the base and head SHAs of the pull request. It matches the old `git diff BASE...HEAD` and includes the old name of a rename, so a rename away from a gated path stays gated. The endpoint returns at most 300 changed files, and only on the first page. Pagination walks commits, not files. A response of 300 files keeps every gate, because that response is also what a longer diff looks like.
- **Prose-only gate.** `stage` is false only when the list is non-empty and every file is prose or tooling that cannot reach a deployed stage: under `docs/`, any `*.md` file, the agent instruction directories, `.githooks/`, `skills-lock.json`, or the root `scripts/` (not `infra/scripts/` and not `scripts/ci/`). An empty list, a mixed list or any other path deploys. A canary or Lighthouse path always keeps the stage, even when it is markdown.
- **Jobs.** `deploy` runs when `head` and `stage` are on. `preview-privacy` and `e2e` need `deploy`, so they skip with it. The canary sweep runs only when `canary` is on. The Lighthouse gate and its app build run only when `lighthouse` is on.
- **Failure modes.** A failed read of the pull request keeps the stage. A failed read of the changed files turns on all three gates.

`ci.yml` and `deploy.yml` do not change. Every pull request still runs the check job and the privacy job, and every merge to `main` still deploys staging and production.

## Considered options

- **Gating the Deploy workflow by changed paths.** Rejected. A `workflow_run` payload does not say how many commits a push carried, so the tip's diff can miss a Submission-path change earlier in the same push. A privacy invariant is a release blocker (SPEC §7). Revisit only with a reliable push range, for example by diffing against the last deployed SHA.
- **`cancel-in-progress: true` on the preview group.** Rejected. It interrupts a half-applied Alchemy deploy or destroy. The revision guard removes the same waste without interrupting anything.
- **Workflow-level `paths:` filters.** Rejected. A filtered run reports no check at all, so a reviewer cannot tell "not needed" from "not reported".
- **Caching Playwright browsers in the `e2e` job.** Rejected for now. It is worth about 30 seconds per run. Measure it before adding a cache key.
- **Splitting the `check` job.** Rejected. The suite is the dominant step (62 seconds on a runner) and runs in parallel with nothing today. Splitting would buy about 25 seconds of wall time and pay for a second setup.

## Consequences

- The path rules are code. A change to a rule fails `scripts/ci/select.test.ts` until the test is updated on purpose.
- The rules come from the revision under test, the same as the workflow file itself. A pull request that edits `scripts/ci/select.mjs` is classified by its own copy.
- A change to `scripts/ci/` always deploys and runs the canary sweep, because it changes the gates. Other root `scripts/` paths stay prose and do not deploy.
- The gate classifies the whole PR diff against its base, not the one push. So a stage deployed by an earlier revision stays until the PR closes, even if the diff later becomes prose-only. A prose-only revision does not tear it down.
- The effect on feedback time and compute is to be measured after a week of the new workflow, as the issue's step 6 says.
