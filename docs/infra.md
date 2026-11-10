# Infrastructure: Alchemy stack and preview stages

The stack is `infra/alchemy.run.ts` (stack name `Surveybeat`). Run Alchemy from the repository root, because the Durable Object's SQL migrations are found relative to the working directory.

| Stage | Hostnames |
| --- | --- |
| `pr-<n>` | `pr-<n>.app.surveybeat.app`, `pr-<n>.submit.surveybeat.app` |
| `staging` | `staging.app.surveybeat.app`, `staging.submit.surveybeat.app` |
| `production` | `app.surveybeat.app`, `submit.surveybeat.app` |
| any other (personal dev, tests) | workers.dev |

A new custom hostname takes about a minute to get its certificate, so the first requests fail the TLS handshake. `infra/scripts/smoke.ts` retries.

## Commands

```sh
pnpm --filter @surveybeat/web build        # the Main Worker serves apps/web/dist
# Sign-in secrets, read at deploy (and destroy) time. Use the WorkOS SurveyBeat Staging values.
export WORKOS_API_KEY=sk_test_... WORKOS_CLIENT_ID=client_...
pnpm infra:deploy --stage dev-yourname     # `alchemy deploy infra/alchemy.run.ts`
pnpm infra:destroy --stage dev-yourname
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... pnpm check:observability --stage dev-yourname
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... pnpm test:preview-privacy --stage dev-yourname <main-url> <submission-url>
E2E_BASE_URL=<main-url> pnpm test:e2e      # once: pnpm --filter @surveybeat/infra exec playwright install chromium
```

## Preview stages in CI

`.github/workflows/preview.yml` deploys `pr-<number>` on every push to a pull request, smoke tests the stage, and destroys it when the pull request closes. It needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, plus the sign-in secrets `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` (below). Fork pull requests are skipped. After the deploy, two jobs run against the stage:

- `preview-privacy` reads back the Submission Worker's settings (below) on every PR. When the PR touches `packages/cloudflare`, `infra`, the answer entry (`apps/web/answer.html`, `src/answer`, `src/messages`, `vite.config.ts`), the dependency pins or this workflow, it also runs the canary sweep (`infra/tests/privacy/canary-sweep.ts`).
- `e2e` runs the Playwright tests in `infra/tests/e2e/` (the SPEC §7 flow, which grows with the slices).

## Sign-in (WorkOS AuthKit)

The Main Worker handles `/auth/login`, `/auth/callback`, and `/auth/logout` with `@workos-inc/node`'s workerd build, and the app calls `/auth/session`, `/auth/organization`, and `/auth/organization/choose` (`packages/cloudflare/src/auth/`, flow in `packages/domain/src/people/SignInFlow.ts`).

| Binding | Source |
| --- | --- |
| `WORKOS_API_KEY`, `WORKOS_CLIENT_ID` | The deploying shell's environment, bound as Worker secrets. In CI they are GitHub secrets: the `production` environment holds the SurveyBeat Production values, and every other stage falls back to the repository secrets, which hold the Staging values. |
| `ORG_CREATION_ALLOWLIST` | `infra/org-creation-allowlist.yaml`, the emails that may create an Organization, keyed by stage with `default` for any stage not listed. `infra/alchemy.run.ts` reads it at deploy time and it wins over the shell; a missing file, an empty list, or a malformed email fails the deploy. Bound as a Worker secret, comma-separated. Emails match case-insensitively and only when WorkOS verified them. A change takes effect at the stage's next deploy. |
| `WORKOS_COOKIE_PASSWORD` | Generated per stage by Alchemy (`Random`, 32 bytes as hex) and kept in its state. Destroying a stage discards it. |
| `OPENROUTER_API_KEY` | Optional. The deploying environment's `OPENROUTER_API_KEY` (a GitHub secret in CI), bound as a Worker secret; empty when unset. AI features fail closed (`AiNotConfigured`) without it. Account settings and the EU-only routing are per ADR 0015. |

**WorkOS environments.** `pr-*` and personal stages use **SurveyBeat Staging** (`environment_01M6TXKPTEY2HWYAEFC0XMMVB2`, AuthKit domain `straightforward-mouse-82-staging.authkit.app`). Production is **SurveyBeat Production** (`environment_01M6TXKQ8G5Q9ASGGJCQE1FAFH`). Staging has:

- redirect URIs `https://pr-*.app.surveybeat.app/auth/callback`, `https://staging.app.surveybeat.app/auth/callback`, `https://*.chrisdoc.workers.dev/auth/callback`, `http://localhost:5173/auth/callback`. Wildcards work: WorkOS sends `pr-52` to the hosted page and a host outside the list to `/redirect-uri-invalid` (checked on 2026-11-07);
- logout URIs `https://pr-*.app.surveybeat.app/` (default), `https://staging.app.surveybeat.app/`, `https://*.chrisdoc.workers.dev/`, `http://localhost:5173/`, set with `workos authkit logout-uris set --environment-id environment_01M6TXKPTEY2HWYAEFC0XMMVB2`;
- the roles `member` (default) and `admin` (Organization admin, created with `workos role create`).

Production has:

- sign-in methods enabled in the dashboard (a new environment allows only SSO, which shows "This account is not authorized to sign in");
- redirect URI `https://app.surveybeat.app/auth/callback`;
- logout URI `https://app.surveybeat.app/`;
- the roles `member` (default) and `admin` (Organization admin).

The smoke test checks that WorkOS accepts the stage's authorization URL and that `WORKOS_API_KEY` belongs to the client's environment: a key from another environment deploys fine and only fails at the first real sign-in.

**Session cookie.** `__Host-surveybeat-session` holds the WorkOS sealed session: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`, 30 days. `__Host-surveybeat-auth-state` holds the OAuth `state` for 10 minutes. POSTs with an `Origin` other than the stage's own are refused.

**Per-request check.** The access token is verified locally (JWKS cached per isolate) and refreshed when it expired. Then the session must not be in D1's `revoked_session`, and when the token is scoped to an Organization, the Person linked to the WorkOS user must be active in its Durable Object (ADR 0010). Sign-out writes `revoked_session` before redirecting to WorkOS's logout, so a copied cookie stops working at once.

**Organization admins** are held in the Organization's Durable Object (`person.organization_admin`), not read from the token's role claim, which can be minutes old. The WorkOS `admin` role is kept in step when an admin is granted or revoked, and set at each sign-in from the Durable Object.

**Teams and People** (`/api/*`, `packages/cloudflare/src/DirectoryHandlers.ts`, rules in `packages/domain/src/people/Directory.ts`, permissions in `Permissions.ts`). The Durable Object authorizes and commits each change in one transaction, then the Worker puts the D1 index, WorkOS, and the email queue in step. Removing a Person marks them removed in the Durable Object (the per-request check denies them at once), deletes their `person_index` row, then deactivates their WorkOS organization membership. If WorkOS cannot be reached the call answers 503 and repeating it finishes the removal.

**D1 index** (`d1-migrations/0003_people_index.sql`): `organization_index` (Organization ↔ WorkOS organization, name), `person_index` (WorkOS user → Persons; email → Organizations for Persons not yet linked; emails normalised), `organization_claim` (one created Organization per WorkOS user, which makes creation idempotent), and `revoked_session`.

## Workers Logs are sampled at 1%

The account's Workers Logs are rate limited: `GET /accounts/{id}/observability/usage/limit` (`cf observability usage-limit get`) reports `status: "limited"` and `sample_rate: 0.01`, so Cloudflare keeps a 1% head-based sample of every Worker's events (the documented behaviour once an account passes its daily limit; `resets_at` is null, so do not count on it ending). A single request has a 99% chance of leaving no event. This is why the spike's Main Worker, with logs on and about 25 requests, never showed up.

The canary sweep therefore sends its canary 1000 times to each Worker (all lost with probability 0.99^1000 ≈ 4·10⁻⁵). It polls for up to 10 minutes until the Main Worker's canary is found (the positive control), then asserts that the Submission Worker produced zero events and that its canary is in no event. If logging were on, about 10 of its 1000 requests would be kept, so zero is meaningful. Checked on 2026-11-07 on a workers.dev stage: the sweep passed in 90 seconds (12 Main events found), and with the Submission Worker's logs switched on it failed (7 events, canary found).

## State store (one-time bootstrap)

Alchemy state lives in the `alchemy-state-store` Worker of the Cloudflare account. In CI (`CI=true`) a missing or outdated store fails the run on purpose, so provision or upgrade it from a laptop logged in with `alchemy profile`:

```sh
pnpm exec alchemy state bootstrap -c infra/alchemy.run.ts
```

Done on 2026-11-07: the existing store was v7 and was upgraded to v8.

## Deployed observability settings

Alchemy turns observability on when the prop is omitted, so the Submission Worker sets every channel off. `check-observability.ts` reads the settings back from the Cloudflare API and fails if `observability.enabled`, `logs.enabled`, `traces.enabled` or `logpush` is on, or a tail consumer is attached. `logs.invocation_logs` and `persist` always read `true` while their channel is off, and no API call changes that (tested with the script-settings and Workers PATCH endpoints), so they count only when their channel is on.

## Email

Transactional email goes through one Queue consumer on the Main Worker (`packages/cloudflare/src/EmailDelivery.ts`). Each send's state lives in its Organization's Durable Object (`email_send`), and the transitions are in `packages/domain/src/email` (ADR 0006).

| Stage | What a send does | Provisioned |
| --- | --- | --- |
| `production` | Sends through Cloudflare Email Sending from `team@notify.surveybeat.app` | The `notify.surveybeat.app` sending subdomain, the `send_email` binding, the `EmailEvents` queue, and its event subscription |
| `pr-<n>`, personal, `test_*` | Renders the message and records it in the stage's D1 table `captured_email`. Sends nothing. | No sending subdomain, no `send_email` binding, no event subscription |

The sending subdomain makes Cloudflare create its DKIM, SPF, DMARC, MX, and bounce records under `notify.surveybeat.app`. Nothing at the apex changes: its SPF, DMARC, MX, and mail-server records belong to the existing mail setup and are not managed by Alchemy. Message previews in the Cloudflare activity log are off (`previewEnabled: false`), because messages will carry Invitation links.

Read what a PR stage would have sent (the database id is the stack output `databaseId`):

```sh
cf d1 query <databaseId> --sql "SELECT recipient, subject, text FROM captured_email ORDER BY captured_at DESC LIMIT 10"
```

No stage other than `production` can send real mail. To try real sending elsewhere, change `sendsRealEmail` in `packages/cloudflare/src/Email.ts` on a throwaway branch and deploy a personal stage. That stage then also claims `notify.surveybeat.app` and its event subscription, so destroy it before production is deployed.

**Send states.** `pending → sending → sent | failed(reason)`. A delivery takes a two-minute lease before calling the provider, and the call times out after 30 seconds. A clear rejection (`E_RATE_LIMIT_EXCEEDED` and other coded errors) returns the send to `pending` and the message is retried after 30 s, 60 s, and 120 s; the fourth rejection fails it. Permanent rejections (`E_RECIPIENT_SUPPRESSED`, sender and header errors) fail at once. An error without a code, a timeout, or a lease that expired with no outcome fails the send as `unknown`, and it is never resent automatically. A message the queue dead-letters fails its send too (`abandoned`, or `rejected` after earlier rejections).

**Bounces and complaints.** Alchemy's `Cloudflare.Queues.Subscription` with the `email.sending` source subscribes the `EmailEvents` queue to `message.bounced`, `message.complained`, `message.rejected`, and `message.failed` for the sending subdomain. The consumer finds the send through the D1 table `email_message` (provider message id → Organization and send) and fails it with the event's reason.

**Fallback.** Postmark would be a second `EmailSender` adapter in `packages/cloudflare`, with its webhooks parsed into the same delivery events (`docs/research/cloudflare-email-sending.md` §9). It is not built.
