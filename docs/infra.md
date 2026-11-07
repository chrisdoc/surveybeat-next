# Infrastructure: Alchemy stack and preview stages

The stack is `infra/alchemy.run.ts` (stack name `Surveybeat`). Run Alchemy from the repository root, because the Durable Object's SQL migrations are found relative to the working directory.

| Stage | Hostnames |
| --- | --- |
| `pr-<n>` | `pr-<n>.app.surveybeat.app`, `pr-<n>.submit.surveybeat.app` |
| `production` | `app.surveybeat.app`, `submit.surveybeat.app` |
| any other (personal dev, tests) | workers.dev |

A new custom hostname takes about a minute to get its certificate, so the first requests fail the TLS handshake. `infra/scripts/smoke.ts` retries.

## Commands

```sh
pnpm --filter @surveybeat/web build        # the Main Worker serves apps/web/dist
pnpm infra:deploy --stage dev-yourname     # `alchemy deploy infra/alchemy.run.ts`
pnpm infra:destroy --stage dev-yourname
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... pnpm check:observability --stage dev-yourname
```

## Preview stages in CI

`.github/workflows/preview.yml` deploys `pr-<number>` on every push to a pull request, reads back the Submission Worker's settings, smoke tests the stage, and destroys it when the pull request closes. It needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Fork pull requests are skipped.

## State store (one-time bootstrap)

Alchemy state lives in the `alchemy-state-store` Worker of the Cloudflare account. In CI (`CI=true`) a missing or outdated store fails the run on purpose, so provision or upgrade it from a laptop logged in with `alchemy profile`:

```sh
pnpm exec alchemy state bootstrap -c infra/alchemy.run.ts
```

Done on 2026-11-07: the existing store was v7 and was upgraded to v8.

## Deployed observability settings

Alchemy turns observability on when the prop is omitted, so the Submission Worker sets every channel off. `check-observability.ts` reads the settings back from the Cloudflare API and fails if `observability.enabled`, `logs.enabled`, `traces.enabled` or `logpush` is on, or a tail consumer is attached. `logs.invocation_logs` and `persist` always read `true` while their channel is off, and no API call changes that (tested with the script-settings and Workers PATCH endpoints), so they count only when their channel is on.
