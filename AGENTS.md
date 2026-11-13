# SurveyBeat

Cloudflare-only Effect app. One Durable Object per Organization is the system of record; D1 holds only the global index and auth/email bookkeeping, never survey content. Three Workers serve the app/API (`MainWorker`), the answer page's submission path (`SubmissionWorker`), and the static landing page (`SiteWorker`, ADR 0020).

Read `SPEC.md` (authoritative spec), `GLOSSARY.md` (domain vocabulary), and `docs/adr/` (binding decisions) before changing behavior. `docs/infra.md` covers stages, WorkOS sign-in, email, and observability. For Effect, Alchemy, Foldkit, XState, a new lint rule, or a Cloudflare resource, start at the [ratstack agent guide](https://ratstack.sh/llms.txt) and follow the Ratstack section.

## Ground rules

- Use glossary terms exactly: Pulse (not Survey), Person (not User), Round (not instance), Submission (not Response). Do not drift to the "avoid" synonyms.
- If a change contradicts an ADR, say so and add a new ADR under `docs/adr/`; never silently override one.
- Issues and specs live in GitHub issues (`gh`); conventions are in `docs/agents/issue-tracker.md`. Commit subjects name the release slice, e.g. `R1 03: ...`.
- Privacy invariants are release blockers (SPEC §7): anonymous Submissions store no Person and no time (ADR 0005), comments are redacted at store time (ADR 0009), and every shown aggregate obeys the minimum group size (ADR 0004).

## Ratstack

SurveyBeat keeps its own packages, commands, and deploy steps in this file. The [ratstack agent guide](https://ratstack.sh/llms.txt) is the reference for Effect, Alchemy, Foldkit, and XState. The template's package list and deploy steps describe the reference repo at [joelhooks/rat-stack](https://github.com/joelhooks/rat-stack).

When the installed `effect` package contains `AGENTS.md`, read that file first. It matches the pin. Then search the guide before you change Effect, Alchemy, Foldkit, XState, a lint rule, or a Cloudflare resource. Read the page the search returns, including the rule or skill that owns the change.

Use `search`, then `read`. One program can do both through `POST https://ratstack.sh/api/execute`, as `tools.search({ query, limit })` and `tools.read({ id })`. That program cannot import, export, or call `fetch`. An MCP client uses the same tools at `https://ratstack.sh/mcp`.

This repo has the floor from that guide. Strict TypeScript, oxlint, `oxfmt --check`, Vitest with `@effect/vitest`, and the fence below are in place. Alchemy and Foldkit are in use. ADR 0008 and ADR 0011 record that choice. Add another template package only when an ADR names it.

The fence is `.githooks/` and `scripts/fence/`. `pnpm install` sets `core.hooksPath` to `.githooks`. The pre-commit hook runs `pnpm check` and then `pnpm test`, and refuses the commit when a step fails. Fix the failure and commit again so the hook runs. Claude Code denies a `git` command that passes `--no-verify` or sets `core.hooksPath`, through `scripts/fence/vcs-command-policy.mjs`. The post-commit hook reports a commit that skipped the gate. CI also runs the privacy suite and the web build. The hook stops after `pnpm test`.

Put a reason in a name, a type, a test, a commit message, or an ADR. `docs/agents/comment-debt-plan.md` tracks the comments already in the tree. The `no-comments` lint rule is not enabled yet.

## Commands (from the repo root)

Node 24 (`.node-version`) and pnpm 12.18.0 are pinned.

```sh
pnpm install
pnpm typecheck          # tsc -b with project references
pnpm typecheck:effect   # @effect/tsgo diagnostics; CI runs this first
pnpm lint               # oxlint --type-aware
pnpm format             # oxfmt; CI runs format:check
pnpm test               # Vitest "unit" project only
pnpm test:privacy       # Vitest "privacy" project only; NOT part of pnpm test
pnpm test <path>        # one file, e.g. pnpm test packages/domain/src/people/SignIn.test.ts
pnpm --filter @surveybeat/web build
```

CI runs `typecheck:effect`, `typecheck`, `format:check`, `lint`, `test`, then the web build; the privacy suite is a separate required job. There is no root `dev` script: `pnpm --filter @surveybeat/web dev` serves the UI only, and the app calls the API at `window.location.origin`. Exercise sign-in and end-to-end flows on a deployed stage.

## Layout and boundaries

- `packages/domain` — Effect schemas and services by concept (`people/`, `email/`); depends only on `effect`.
- `packages/api` — the `HttpApi` declaration shared by the Worker and the typed web client; depends on `domain`.
- `packages/cloudflare` — all Cloudflare adapters plus the `MainWorker` and `SubmissionWorker` entries; the only package that touches the Alchemy runtime.
- `apps/web` — one Vite project with two entries, the Foldkit app (`index.html`) and the plain-TypeScript answer page (`answer.html`), plus a separate build (`vite.site.config.ts`) that prerenders the landing page (`site.html`, `src/site/`) into `dist-site`.
- `packages/emails` — React Email templates and rendering. `packages/testing` — privacy harness. `infra` — Alchemy stack, scripts, Playwright e2e, privacy sweep. `tools/oxlint-plugin-surveybeat` — local lint rules.

## Toolchain traps

- Effect is 4.1.2, not 3.x. Import from `effect/Effect`, `effect/Schema`, `effect/http-api`, `effect/http/...`; there is no `@effect/platform` v3-style API here. Copy the import style from neighboring files.
- TypeScript 7 (native compiler) with `tsc -b`. A new package needs its own `tsconfig.json` and an entry in the root `tsconfig.json` references.
- Stricter than defaults: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (use `import type`), and relative imports carry explicit `.ts`/`.tsx` extensions.
- Lint bans `any` and type assertions (`as Foo`) outside `*.test.ts` (`consistent-type-assertions: never`). Decode with Effect Schema or use typed helpers instead.
- All user-facing text comes from `apps/web/src/messages/catalog.ts` or `packages/emails/src/messages/catalog.ts`; `no-literal-ui-text` fails otherwise. HTML shells must hold no visible text and an empty `<title>` (asserted in `messages.test.ts`). Plurals use `<base>.one`/`.other`.
- The lint plugin enforces the boundaries: `domain`/`api` may not import `cloudflare:*`, Alchemy, or Foldkit, and `apps/web/src/answer/**` may not import React, Base UI, Foldkit, or the HttpApi client.
- Keep the answer entry plain TypeScript within its budget (JS ≤ 10 KB gzip critical path, CSS ≤ 2 KB inline, HTML ≤ 8 KB); no framework, per ADR 0008.

## Tests

- Tests are colocated `*.test.ts`. A privacy test must be named `*.privacy.test.ts` or CI never runs it.
- Use `@effect/vitest` (`it.effect` for Effect programs). Prefer a property or a model for a domain rule, and keep an example test for a seam. Make a new property fail on a planted bug, then remove that bug, before you trust the test.
- Adapter tests use `@alchemy.run/test`'s `Test.make({ dev: true })` against local workerd and are slow (deploy timeouts up to 240 s); run the single file you need.
- A new API endpoint must be classified in `packages/api/src/PrivacyRegistry.ts` or the package will not typecheck; `registry.privacy.test.ts` checks the runtime declaration too.
- End-to-end tests run only against a deployed stage: `E2E_BASE_URL=https://pr-<n>.app.surveybeat.app pnpm test:e2e` (install Chromium once with `pnpm --filter @surveybeat/infra exec playwright install chromium`).

## Infra

- Every Cloudflare resource is declared in `infra/alchemy.run.ts`; no dashboard edits, no wrangler config.
- Run Alchemy from the repo root: the Organization DO migrations path (`packages/cloudflare/migrations`) is relative to the working directory. Build the web app first; the Main Worker serves `apps/web/dist`.
- `pnpm infra:deploy --stage dev-<name>` needs `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` in the environment. Who may create an Organization is `infra/org-creation-allowlist.yaml`, per stage.
- Non-production stages never send real email; sends are recorded in D1's `captured_email`. Only `production` sends.
- The Submission Worker must keep every observability channel off. `pnpm check:observability --stage <stage>` reads the deployed settings back; the canary sweep proves no logs are kept. Stage scripts need `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- New SQL migrations: numbered files in `packages/cloudflare/migrations` (Durable Object) or `packages/cloudflare/d1-migrations` (D1).
