# SurveyBeat

## Development

Requires Node 24 (`.node-version`) and pnpm (pinned in `package.json`).

```sh
pnpm install            # install the workspace
pnpm typecheck          # effect-tsgo tsc -b: Effect diagnostics fail the build (runs in CI)
pnpm typecheck:tsc      # plain tsc -b, for a second opinion
pnpm typecheck:effect   # alias of typecheck, kept for existing callers
pnpm check:ledger       # counts lint disables and Effect diagnostic overrides; it only shrinks
pnpm lint               # oxlint, type-aware
pnpm format             # oxfmt; use format:check to verify
pnpm test               # Vitest, all projects
pnpm test:privacy       # only the *.privacy.test.ts files
pnpm --filter @surveybeat/web build   # Vite build of both web entries
```
