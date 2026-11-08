# Workspace layout and toolchain: pnpm, TypeScript 7, oxc tools, and Alchemy v2's Effect runtime kept inside the adapters

**Workspace.** pnpm workspaces with a `catalog:` of exact pins, on Node 24 LTS (`.node-version`). Pinned at: `effect` and all `@effect/*` 4.1.2, `alchemy` and `@alchemy.run/*` 2.0.0-beta.85, `typescript` 7.0.2, and exact `oxlint`, `oxlint-tsgolint`, and `oxfmt` versions. The Effect and Alchemy pins move only together, in a PR of their own, because both are marked unstable or beta.

**Packages.**

| Package | Holds | May depend on |
| --- | --- | --- |
| `packages/domain` | Schemas and services by concept (`people/`, `pulses/`, `rounds/`, `answering/`, `results/`, `actions/`, `privacy/`), schedule and Result calculations | `effect` only |
| `packages/api` | The HttpApi declaration shared by server and client | `domain` |
| `packages/cloudflare` | Adapters (Organization DO, D1, Queue consumer, `EmailSender`, alarm scheduler) and the two Worker entries: the main Worker and the Submission Worker | `domain`, `api`, `emails` (the Queue consumer renders email), Alchemy runtime |
| `apps/web` | One Vite 8 project with two entries: the app (Foldkit, @foldkit/ui, typed router) and the answer page (plain TypeScript, no framework, no HttpApi client: plain `fetch` plus shared Schemas) | `api`, `domain` (Schemas) |
| `packages/emails` | Email templates | `domain` |
| `infra` | The Alchemy stack and stages (`pr-<n>`, `staging`, `production`) | everything |

**Cloudflare runtime.** Workers, the Durable Object, the Queue consumer, and Cron are defined with Alchemy v2's Effect runtime, but only in `packages/cloudflare`. If the beta fails us, replacing it with a hand-written bridge of about 100 lines touches only that package.

**Tooling.**
- TypeScript 7.0.2 (the native compiler) with `tsc -b` and project references. Settings: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`.
- `@effect/tsgo` provides Effect diagnostics.
- oxfmt formats. oxlint lints, with type-aware rules from `oxlint-tsgolint`.
- A local `jsPlugins` package, `tools/oxlint-plugin-surveybeat`, bans `cloudflare:*` and Alchemy imports in `domain` and `api`, bans `foldkit` in `domain`, `api`, and `answer`, and holds the privacy query lint (no `rowid`, no unordered reads of anonymous tables, no joins between anonymous tables and Participation or Invitation).
- The boundary is also enforced by dependencies: `domain` declares only `effect` and uses `types: []`.

**Tests.** Vitest with `@effect/vitest` everywhere:
- domain and API tests in plain Node with in-memory layers and `HttpApiTest`;
- app tests using Foldkit Story (update + Command.resolve) and Scene (role and label locators) suites in Vitest;
- adapter tests through `@alchemy.run/test` `Test.make({ dev: true })` on local workerd;
- smoke tests with `Test.make()` on the PR stage;
- Playwright end-to-end tests on the PR stage.

`vitest-pool-workers` is not used, and there is no hand-edited wrangler config.

**Answer entry (measured in the answer-page prototype, 2026-11-07).** The answer entry is prerendered static HTML with inline CSS and a small plain TypeScript controller, with no React, Preact, Base UI, or Foldkit. Measured with Lighthouse mobile (slow 4G, 4× CPU), the time until the Question text appears was 1.12 s with this approach, 1.35 s with Preact, 1.61 s with React, and 1.90 s with React plus Base UI. Foldkit static prerender + hydration (Variant F) measured at 304.8 KB raw / 97.3 KB gzip (compared to Variant A plain TS at 25.0 KB gz with Schema / 1.5 KB without Schema; and React at 90.8 KB gz). Because Variant F far exceeds the ≤ 10 KB gzip budget of ADR 0008, the answer page stays plain TypeScript. The token request starts from an inline script in `<head>`, and Effect Schema (23.5 KB gzip) loads after first paint. Budget: JS ≤ 10 KB gzip on the critical path, CSS ≤ 2 KB inline, HTML ≤ 8 KB, 1 request before first paint and 2 before the Question text. A Lighthouse CI gate checks FCP ≤ 800 ms, LCP ≤ 1.3 s, and TBT ≤ 50 ms.

## Considered Options

- **Foldkit for the app (R1 06b).** Accepted. Foldkit and `@foldkit/ui` replace React and Base UI for `apps/web`. Foldkit models application state using the Elm architecture (Model as an Effect Schema, Messages, pure `update`, `Command.define`, and declarative `view`) and typed bidirectional routing. Foldkit's pre-1.0 status is an accepted risk: the core Elm architecture and schema-first design are stable, story and scene tests execute without browser overhead in Vitest, and the Vite plugin provides state-preserving live reload. React remains exclusively in `packages/emails`.
- **TypeScript 5.9 or 6.** Rejected: 7.0.2 is npm `latest`, Effect recommends it, and Alchemy is built against it. 6.0 is the end of the JavaScript-based compiler line. Our tools (oxc, Vite/rolldown, Vitest) don't depend on the old compiler API.
- **Biome, or ESLint with Prettier.** Rejected in favour of oxlint and oxfmt. oxlint's `jsPlugins` let the boundary and privacy rules be ordinary lint rules, and `oxlint-tsgolint` gives type-aware rules on TypeScript 7.
- **A hand-written Effect bridge from day one.** Deferred: Alchemy's runtime removes the bridge code. Keeping it in one package makes the switch cheap if we need it.

## Consequences

A spike on a preview stage verifies this before the walking skeleton is built. It checks the Organization DO with `SqliteClient`, transactions, migrations, and an alarm, a Queue consumer with a dead-letter queue, the Submission Worker with every log setting off, the deployed cold start, and `tsc -b` with project references on TypeScript 7.0.2.
