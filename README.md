# SurveyBeat

## Development

Requires Node 24 (`.node-version`) and pnpm (pinned in `package.json`).

```sh
pnpm install            # install the workspace
pnpm typecheck          # tsc -b with project references
pnpm typecheck:effect   # the same, with @effect/tsgo diagnostics (runs in CI)
pnpm lint               # oxlint, type-aware
pnpm format             # oxfmt; use format:check to verify
pnpm test               # Vitest, all projects
pnpm test:privacy       # only the *.privacy.test.ts files
pnpm --filter @surveybeat/web build   # Vite build of both web entries
```
