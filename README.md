# SurveyBeat

SurveyBeat measures how a team is doing over time through short recurring check-ins, and helps the team act on what it learns. A pulse is one team's check-in. Members answer, the team reads the trend, and the team records actions for the next round.

This repository is the Cloudflare rebuild. Read these before you change behavior.

- [SPEC.md](SPEC.md) is the product specification.
- [GLOSSARY.md](GLOSSARY.md) is the vocabulary. Use those words in code, the API, and the UI.
- [docs/adr](docs/adr) holds the binding decisions.
- [AGENTS.md](AGENTS.md) is the guide for working in this tree.
- [docs/infra.md](docs/infra.md) covers stages, WorkOS sign-in, email, and observability.

## Requirements

You need Node 24. `.node-version` pins it. `package.json` pins pnpm at 12.18.0.

```sh
pnpm install            # install the workspace
pnpm typecheck          # effect-tsgo tsc -b: Effect diagnostics fail the build
pnpm typecheck:tsc      # plain tsc -b, for a second opinion
pnpm typecheck:effect   # alias of typecheck, kept for existing callers
pnpm check:ledger       # counts lint disables and Effect diagnostic overrides; it only shrinks
pnpm check:comments     # counts prose comments per package; it only shrinks
pnpm lint               # oxlint, type-aware
pnpm format             # oxfmt writes formatting. CI runs pnpm format:check
pnpm test               # the Vitest unit project
pnpm test:privacy       # the Vitest privacy project
pnpm check              # typecheck:effect, typecheck, format:check, and lint
pnpm --filter @surveybeat/web build
```

That install sets `core.hooksPath` to `.githooks`.

CI runs `typecheck:effect`, then `typecheck`, `format:check`, `lint`, `test`, and the web build. The privacy suite is a separate required job.

To run one unit file, pass its path.

```sh
pnpm test packages/domain/src/people/SignIn.test.ts
```

## Run the web UI

There is no root `dev` script. Vite serves the UI only. The app calls the API at `window.location.origin`, so sign-in and rounds need a deployed stage.

```sh
pnpm --filter @surveybeat/web dev
```

`pnpm --filter @surveybeat/web build` writes the app to `apps/web/dist` and the landing page to `apps/web/dist-site`. The Main Worker serves `apps/web/dist`. Build the web app before you deploy.

## Deploy a personal stage

Run Alchemy from the repository root. It finds Durable Object SQL migrations relative to the working directory. Export `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` first. A personal stage stays on `workers.dev` and records email in D1 instead of sending it. Hostnames, preview stages, and the observability check are in [docs/infra.md](docs/infra.md).

```sh
pnpm --filter @surveybeat/web build
pnpm infra:deploy --stage dev-yourname
```

## Where the code lives

The pnpm workspace is split so domain code cannot import Cloudflare.

| Path | Package | Holds |
| --- | --- | --- |
| `packages/domain` | `@surveybeat/domain` | Effect schemas and services. The package depends only on `effect`. |
| `packages/api` | `@surveybeat/api` | The HTTP API declaration shared by the Worker and the web client. |
| `packages/cloudflare` | `@surveybeat/cloudflare` | Cloudflare adapters, plus the Main Worker, the Submission Worker, and the Site Worker. |
| `packages/emails` | `@surveybeat/emails` | React Email templates. |
| `packages/testing` | `@surveybeat/testing` | Helpers for privacy tests. |
| `apps/web` | `@surveybeat/web` | The Vite app. Separate entries cover the signed-in app, the answer page, and the landing page. |
| `infra` | `@surveybeat/infra` | The Alchemy stack, Playwright tests, and the privacy sweep. |
| `tools/oxlint-plugin-surveybeat` | `oxlint-plugin-surveybeat` | Lint rules for package boundaries and anonymous-data queries. |

`MainWorker` serves the signed-in app and the API. `SubmissionWorker` accepts answers and keeps every observability channel off. `SiteWorker` serves the static landing page.

Each Organization has one Durable Object. That object is the system of record. D1 holds the global index and the bookkeeping for auth and email. Survey content stays out of D1.

## Rules that fail the build

[AGENTS.md](AGENTS.md) has the full list. Start with these.

- Effect here is 4.1.2. Import from `effect/Effect` and `effect/Schema`. Copy the import style from a neighboring file.
- Relative imports include the `.ts` extension.
- User-facing strings live in `apps/web/src/messages/catalog.ts` or `packages/emails/src/messages/catalog.ts`.
- Name a privacy test `*.privacy.test.ts`. `pnpm test` skips that project.
- Classify a new API endpoint in `packages/api/src/PrivacyRegistry.ts`, or the package fails to typecheck.
- The lint plugin rejects Cloudflare, Alchemy, and Foldkit imports from `packages/domain` and `packages/api`.
- The answer page in `apps/web/src/answer` stays plain TypeScript. It imports neither React, Base UI, Foldkit, nor the HTTP API client.

Anonymous submissions store no Person and no exact time. A shown aggregate has to meet the minimum group size. The rules are in [SPEC.md](SPEC.md) section 5.3 and in `docs/adr`.

## Test against a stage

End-to-end tests talk to a deployed stage. Install Chromium once, then point `E2E_BASE_URL` at that stage's app origin. A pull request stage serves the app at `https://pr-<n>.dashboard.surveybeat.app`.

```sh
pnpm --filter @surveybeat/infra exec playwright install chromium
E2E_BASE_URL=https://pr-12.dashboard.surveybeat.app pnpm test:e2e
```
