# Workspace layout and toolchain: pnpm, TypeScript 7, oxc tools, and Alchemy v2's Effect runtime kept inside the adapters

> Partly superseded by ADR 0011 (the app entry uses Foldkit, not React and Base UI), ADR 0012 (`packages/cloudflare` depends on `packages/emails`), and ADR 0013 (domain folder layout). The rest stands.

**Workspace.** pnpm workspaces with a `catalog:` of exact pins, on Node 24 LTS (`.node-version`). Pinned at: `effect` and all `@effect/*` 4.1.2, `alchemy` and `@alchemy.run/*` 2.0.0-beta.85, `typescript` 7.0.2, and exact `oxlint`, `oxlint-tsgolint`, and `oxfmt` versions. The Effect and Alchemy pins move only together, in a PR of their own, because both are marked unstable or beta.

**Packages.**

| Package | Holds | May depend on |
| --- | --- | --- |
| `packages/domain` | Schemas and services by concept (`people/`, `pulses/`, `rounds/`, `answering/`, `results/`, `actions/`, `privacy/`), schedule and Result calculations | `effect` only |
| `packages/api` | The HttpApi declaration shared by server and client | `domain` |
| `packages/cloudflare` | Adapters (Organization DO, D1, Queue consumer, `EmailSender`, alarm scheduler) and the two Worker entries: the main Worker and the Submission Worker | `domain`, `api`, Alchemy runtime |
| `apps/web` | One Vite 8 project with two entries: the app (React, TanStack Router, Base UI) and the answer page (no React, no HttpApi client: plain `fetch` plus shared Schemas) | `api`, `domain` (Schemas) |
| `packages/emails` | Email templates | `domain` |
| `infra` | The Alchemy stack and stages (`pr-<n>`, `staging`, `production`) | everything |

**Cloudflare runtime.** Workers, the Durable Object, the Queue consumer, and Cron are defined with Alchemy v2's Effect runtime, but only in `packages/cloudflare`. If the beta fails us, replacing it with a hand-written bridge of about 100 lines touches only that package.

**Tooling.**
- TypeScript 7.0.2 (the native compiler) with `tsc -b` and project references. Settings: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`.
- `@effect/tsgo` provides Effect diagnostics.
- oxfmt formats. oxlint lints, with type-aware rules from `oxlint-tsgolint`.
- A local `jsPlugins` package, `tools/oxlint-plugin-surveybeat`, bans `cloudflare:*` and Alchemy imports in `domain` and `api`, and holds the privacy query lint (no `rowid`, no unordered reads of anonymous tables, no joins between anonymous tables and Participation or Invitation).
- The boundary is also enforced by dependencies: `domain` declares only `effect` and uses `types: []`.

**Tests.** Vitest with `@effect/vitest` everywhere:
- domain and API tests in plain Node with in-memory layers and `HttpApiTest`;
- adapter tests through `@alchemy.run/test` `Test.make({ dev: true })` on local workerd;
- smoke tests with `Test.make()` on the PR stage;
- Playwright end-to-end tests on the PR stage.

`vitest-pool-workers` is not used, and there is no hand-edited wrangler config.

**Answer entry (measured in the answer-page prototype, 2026-11-07).** The answer entry is prerendered static HTML with inline CSS and a small plain TypeScript controller, with no React, Preact, or Base UI. Measured with Lighthouse mobile (slow 4G, 4× CPU), the time until the Question text appears was 1.12 s with this approach, 1.35 s with Preact, 1.61 s with React, and 1.90 s with React plus Base UI. The token request starts from an inline script in `<head>`, and Effect Schema (23.5 KB gzip) loads after first paint. Budget: JS ≤ 10 KB gzip on the critical path, CSS ≤ 2 KB inline, HTML ≤ 8 KB, 1 request before first paint and 2 before the Question text. A Lighthouse CI gate checks FCP ≤ 800 ms, LCP ≤ 1.3 s, and TBT ≤ 50 ms.

## Considered Options

- **TypeScript 5.9 or 6.** Rejected: 7.0.2 is npm `latest`, Effect recommends it, and Alchemy is built against it. 6.0 is the end of the JavaScript-based compiler line. Our tools (oxc, Vite/rolldown, Vitest) don't depend on the old compiler API.
- **Biome, or ESLint with Prettier.** Rejected in favour of oxlint and oxfmt. oxlint's `jsPlugins` let the boundary and privacy rules be ordinary lint rules, and `oxlint-tsgolint` gives type-aware rules on TypeScript 7.
- **A hand-written Effect bridge from day one.** Deferred: Alchemy's runtime removes the bridge code. Keeping it in one package makes the switch cheap if we need it.

## Consequences

A spike on a preview stage verifies this before the walking skeleton is built. It checks the Organization DO with `SqliteClient`, transactions, migrations, and an alarm, a Queue consumer with a dead-letter queue, the Submission Worker with every log setting off, the deployed cold start, and `tsc -b` with project references on TypeScript 7.0.2.
