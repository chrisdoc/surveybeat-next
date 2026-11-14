# Comment debt plan

rat-stack bans prose comments in code (`lore/no-comments`). The reason is mechanical: agents copy comments, and a comment that explains a workaround spreads the workaround. A reason belongs in a name, a type, a test, a commit message, or a decision record — places the compiler, the suite, or review can enforce or reveal.

SurveyBeat currently carries about **500 `//` comments and 880 `/** */` blocks** outside tests. The debt is real but the content is mostly good: ADR citations, invariants, and the reasons behind unusual shapes. Deleting it would lose knowledge. Relocating it keeps the knowledge and removes the copyable prose.

## What each kind becomes

| Kind of comment | Current example | Where it goes |
| --- | --- | --- |
| Invariant of a computation | `Results.ts`: minimum group size and unlinkability rules | A test name that states the rule, plus a branded type where the value is carried |
| ADR citation | `PrivacyRegistry.ts`: "ADR 0004, Rule R9" | The ADR keeps the reasoning; the code keeps a type or test name that fails when the rule breaks |
| Why a shape is unusual | `MainWorker.ts`: why the HttpPlatform stub exists | The port's name (`HttpPlatformStub`) and a test asserting the stub's behaviour |
| Workaround for a provider | `SubmissionRoutes.ts`: credentials only in the body | A test that refuses query credentials, plus the error type it returns |
| Roadmap or history | "slice 13", "R2 04" | The commit subject and the issue, never the code |

The rule of thumb: if removing the comment would let a future change silently break something, it is an invariant and needs a test. If it only explains taste or history, it belongs in the commit or the ADR.

## Order of work

1. **Stop the inflow.** Add a `no-comments` lint rule (rat-stack's `scripts/oxlint-plugin-no-comments.ts` is the reference) in report-only mode, and count hits per package so the number is visible and can only shrink.
2. **Test names first.** `Results.ts`, `Results.privacy.test.ts`, and `Redaction.ts` carry the privacy invariants. Move each rule into a named test or a brand, then delete the comment. This is the highest-value batch because these are release blockers.
3. **Types second.** Values whose meaning lives in a comment become branded schemas or named constructors (`EffectiveMinimumGroupSize`, `StoredMinimumGroupSize`), so the compiler carries the distinction.
4. **Ports and stubs third.** `MainWorker.ts`, `HttpPlatformStub`, `WorkosIdentityProvider.ts`: replace explanatory comments with names and the tests that pin the behaviour.
5. **Switch the rule to `error`.** Only after the count reaches zero. rat-stack's standard is that a new lint rule ships with a fixture test that runs real Oxlint, and that the debt count only shrinks.

## Acceptance

- Every deleted comment has its reason in a test name, a type name, a commit subject, or an ADR. A batch that deletes without relocating is a regression.
- `pnpm lint` reports the `no-comments` rule at `error` with zero hits.
- The privacy suite still passes, and no privacy invariant lives only in prose.
- No `//` directive appears without a reason after `--`; no type assertion appears without a one-line `SAFETY:` statement.

## Where the rule lives

- `tools/oxlint-plugin-surveybeat/no-comments.js` is the plugin: `no-comments/no-comments` reports prose, `no-comments/directive-reason` reports a directive without `-- <why>`. Directives with a reason, a one-line `SAFETY:` comment, and JSDoc made only of type tags are allowed. Fixtures in `tools/oxlint-plugin-surveybeat/fixtures/packages/comments/` are linted through real oxlint by the plugin's own test.
- `scripts/ledger/comment-debt.mjs` runs those two rules over the non-test files and compares each package's count with `scripts/ledger/comment-debt.json`. `pnpm check:comments` fails when a count rises or when the ledger is stale, and `pnpm check:comments --update` records a batch that shrank it. CI and the commit gate both run it.
- Baseline on 2026-11-14: **1,420 prose comments, none of them directives without a reason** — `packages/domain` 569, `packages/cloudflare` 402, `apps/web` 339, `packages/emails` 32, `packages/api` 26, `packages/testing` 22, `infra` 21, `scripts` 6, the oxlint plugin 3. Step 2 (the privacy invariants in `Results` and `Redaction`) took it to **1,375**: `packages/domain` 569 -> 524, every other kind unchanged. Step 3 took it to **973**: the privacy storage path in `packages/cloudflare` (`SqlRounds`, `SubmissionRoutes`, `SubmissionWorker`) went first, 402 -> 377, then the rest of the package, 377 -> 0. The batch's homes were audited before step 4: `Organization.ts`, the `/__test/*` route harnesses and the handler modules are driven by `Organization.test.ts`, `Email.test.ts` and the per-feature API suites, whose test names state each rule; the email and storage paths by `EmailDelivery.test.ts`, `CloudflareEmailSender.test.ts`, `Email.test.ts` and the `Sql*` tests; hostnames, cron paging, server pages and the AI client by their own tests; and the declarative wiring (what D1 holds, queue names and retries, the site Worker's `/app` redirect and asset directories) by `EmailConfig.test.ts` and `docs/infra.md`. Citations that were only history (`slice 13`, `R2 04`) live in the commit subject. The package keeps only directives with a reason. Step 4 (the ports and stubs in the same package: `MainWorker.ts`, `WorkosIdentityProvider.ts`) gave those reasons names, tests and sections: `WorkerWiring.ts` and its test carry the SPA fallback, the Worker-first routes, the test-stage gating, the absolute asset directory, the 32-hex id width and the filesystem-free `HttpPlatform` stub; `auth/ProviderFailure.ts` and its test carry the refusal-versus-unreachable split; `docs/infra.md` carries the wiring, session-failure and queue-retry rules.
- Step 5 took the rest to zero in one batch: `packages/domain` 524 -> 0, `apps/web` 339 -> 0, `packages/emails` 32 -> 0, `packages/api` 26 -> 0, `packages/testing` 22 -> 0, `infra` 21 -> 0, `scripts` 6 -> 0 and the oxlint plugin 3 -> 0, leaving every package at zero. The homes were audited per package before the deletion. 128 of the comments cited an ADR (0002-0021, every record present), so their reasoning stays in the record they pointed at; the rest restated a symbol, a field, or a stored shape, which the name or the schema now carries (`SignInPorts.Directory`, `Pulse.MAX_QUESTIONS`, `Email.testId`, `SendState`, `LinkableDump`, `RenderableEmail`). What used to be prose is stated in test names, one suite per module: `Results.privacy.test.ts` (R1-R9, P1-P5), `Themes.privacy.test.ts` (T1-T4, G1-G4), `Lifecycle.test.ts` (`skips reminders when close is less than 2 hours away`), `Directory.test.ts` (a Team keeps a Lead, an Organization keeps an admin, a returning Person joins as a member), `render.test.ts` (`keeps the subject on one line`), `budget.test.ts` (the answer page's modulepreloads and bundle byte budget), `keptAnswers.test.ts` (`never throws when storage throws`), and the per-module suites `Editor`, `Pulse`, `Team`, `SignIn`, `SendState`, `FailedEmails`, `EmailTemplates`, `TestInvitation`, `results`, `overview`, `charts`, `locale` and `messages`. The six `scripts/` hits were shebangs rather than prose: every entry point runs as `node <path>` from `package.json` and `.githooks/`, so the shebang was dead and went with the batch. Both rules now run at `error` in `.oxlintrc.json`, and a planted prose comment plus a planted reasonless directive each fail `pnpm lint` with exit 1.

## Not in scope

Generated files, `infra/tests/**` fixtures, and plain JavaScript JSDoc blocks made only of type tags. rat-stack keeps those.
