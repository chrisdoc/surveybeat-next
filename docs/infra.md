# Infrastructure: Alchemy stack and preview stages

The stack is `infra/alchemy.run.ts` (stack name `Surveybeat`). Run Alchemy from the repository root, because the Durable Object's SQL migrations are found relative to the working directory.

| Stage | Hostnames |
| --- | --- |
| `pr-<n>` | `pr-<n>.dashboard.surveybeat.app`, `pr-<n>.submit.surveybeat.app` |
| `staging` | `staging.dashboard.surveybeat.app`, `staging.submit.surveybeat.app` |
| `production` | `dashboard.surveybeat.app`, `submit.surveybeat.app` (with `app.surveybeat.app` redirecting to `dashboard`) |
| any other (personal dev, tests) | workers.dev |

A new custom hostname takes about a minute to get its certificate, so the first requests fail the TLS handshake. `infra/scripts/smoke.ts` retries.

The landing page (`SiteWorker`, ADR 0020) uses the stage's own name without `app` or `submit`: `pr-<n>.surveybeat.app` and `staging.surveybeat.app`. `production` serves it on workers.dev until the apex cutover below, and every other stage stays on workers.dev. On a stage without an `app` hostname (personal `dev-*` stages), the page's sign-in links (`/app`) cannot know the app's workers.dev URL and lead back to the landing page; open `mainUrl` from the deploy output instead.

## Apex cutover (landing page)

`surveybeat.app` and `www.surveybeat.app` still point at the old app on Vercel, and production deploys on every merge to main. Do these steps in this order, or the production deploy collides with the old records:

1. Remove the Vercel records for `surveybeat.app` and `www.surveybeat.app` from the Cloudflare zone. This is a one-time manual change, made by the owner.
2. Set `APEX_SERVED_BY_SITE` to `true` in `packages/cloudflare/src/Hostnames.ts`. Production then serves `surveybeat.app` from the Site Worker, and `www.surveybeat.app` redirects to it.
3. Merge to main. The production deploy claims the apex.

## Commands

```sh
pnpm --filter @surveybeat/web build        # the Main Worker serves apps/web/dist
pnpm infra:deploy --stage dev-yourname     # `alchemy deploy infra/alchemy.run.ts`
pnpm infra:destroy --stage dev-yourname
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... pnpm check:observability --stage dev-yourname
CLOUDFLARE_API_TOKEN=... pnpm check:compliance -- --stage production
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... pnpm test:preview-privacy --stage dev-yourname <main-url> <submission-url>
pnpm test:e2e                              # local stage: builds the app, runs `alchemy dev` on infra/tests/e2e/stack.ts
E2E_BASE_URL=<main-url> pnpm test:e2e      # the same specs against a deployed stage
                                           # once: pnpm --filter @surveybeat/infra exec playwright install chromium
```

Values for those commands come from `.env.schema`, which declares every variable the deploy, the e2e suite and the stage scripts read and is committed. Real values go in `.env.local`, which is not; `pnpm env:check` validates both. `pnpm infra:deploy` and `pnpm test:e2e` run under `varlock run`, so a missing or malformed value fails before Alchemy or Playwright starts.

## Preview stages in CI

`.github/workflows/preview.yml` deploys `pr-<number>` for a push to a pull request, smoke tests the stage, and destroys it when the pull request closes. It needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, (no sign-in secret beyond `ORG_CREATION_ALLOWLIST`, which `infra/alchemy.run.ts` reads). Fork pull requests are skipped. The decision and its backtest are in ADR 0026.

The first job, `select`, decides what the revision needs before any stage work starts:

- A revision that is no longer the head of its pull request stops there, and the newer revision owns the stage. If the read of the pull request fails, the revision keeps its stage.
- `scripts/ci/select.mjs` classifies the PR's changed files, read from the compare endpoint `base...head` by commit SHA. It matches the old `git diff BASE...HEAD` and includes the old name of a rename. `scripts/ci/select.test.ts` locks its rules. It sets three gates:
  - `stage` is off only when every changed file is prose or agent tooling: under `docs/`, any `*.md`, the agent instruction directories, `.githooks/`, `skills-lock.json`, or the root `scripts/`. An empty list, a mixed list or any other path deploys a stage.
  - `canary` is on when the PR touches `packages/cloudflare`, `infra`, `scripts/ci`, the answer entry (`apps/web/answer.html`, `src/answer`, `src/messages`, `vite.config.ts`), the dependency pins or this workflow.
  - `lighthouse` is on when the PR touches the answer entry, `infra/scripts/lighthouse` or `infra/package.json`.
- If the changed files cannot be read, or the compare endpoint returns 300 files (its cap; the file list is not paginated), all three gates are on.

After the deploy, two jobs run against the stage. Both are skipped when `stage` is off:

- `preview-privacy` reads back the Submission Worker's settings (below) on every stage. It runs the canary sweep (`infra/tests/privacy/canary-sweep.ts`) only when `canary` is on.
- `e2e` runs the Playwright tests in `infra/tests/e2e/`, including the SPEC §7 flow (local stage only, see AGENTS.md). It builds the web app and runs the Lighthouse gate only when `lighthouse` is on. The gate (`infra/scripts/lighthouse-gate.ts`) serves the built answer page locally and takes the median of 9 runs against ADR 0008's budgets. It also fails when Lighthouse reports any render-blocking request, which is ADR 0008's "1 request before first paint". The local server holds every subresource body back 100 ms but sends its headers at once. On localhost the module script would otherwise arrive before first paint in some runs, and Lantern would then count it as render-blocking, adding ~300 ms of simulated FCP (#285). Sending headers at once keeps Lantern's per-origin server-time estimate unchanged. A second step reruns the gate with `LIGHTHOUSE_PLANT_RENDER_BLOCKING=1`, which injects a stylesheet into `<head>`; that step passes only when the gate flags it.

## Sign-in (Better Auth, email codes)

The Main Worker serves `/auth/login`, `/auth/email-code`, `/auth/email-code/verify`, `/auth/logout`, `/auth/session`, `/auth/organization` and `/auth/organization/choose` (`packages/cloudflare/src/auth/`; the flow is `packages/domain/src/people/SignInFlow.ts`), and forwards every other `/auth/*` path to the Better Auth instance mounted at `/auth` (ADR 0022, ADR 0023). `authInstance.fetch` is built once per isolate in `MainWorker.ts`; the D1 index is built per request.

**Signing in.** `/auth/login` redirects to the app's own form. The form posts the email to `/auth/email-code`, which hands it to Better Auth's verification-code endpoint, and Better Auth mails a six-digit code through the same `EmailSender` the invitations use. `/auth/email-code/verify` exchanges the code for a session: Better Auth writes the `auth_session` row, and its `Set-Cookie` value is put on our response as `__Host-surveybeat-session`. There is no callback route and no state cookie, because nothing redirects off-site, and there is no hosted logout page: sign-out deletes the session row and answers 303 to the app.

**Session failure rules.** `BetterAuthIdentityProvider` reads the session for the cookie: no row or an unknown token is `Unauthenticated`, so the cookie is dropped and the request answers 401; a throw from Better Auth is `AuthUnavailable`, so the cookie is kept and the request answers 503 and can be retried. Only `Unauthenticated` from `authenticate` expires the cookie. Revoking a session that is already gone succeeds: the refusal is the desired end state.

| Binding | Source |
| --- | --- |
| `ORG_CREATION_ALLOWLIST` | `infra/org-creation-allowlist.yaml`, the emails that may create an Organization, keyed by stage with `default` for any stage not listed. `infra/alchemy.run.ts` reads it at deploy time and it wins over the shell; a missing file, an empty list, or a malformed email fails the deploy. Bound as a Worker secret, comma-separated. Emails match case-insensitively and only when Better Auth verified them. A change takes effect at the stage's next deploy. |
| `INVITATION_TOKEN_KEY` | Generated per stage by Alchemy (`Random`, 32 bytes as hex) and kept in its state. Destroying a stage discards it. |
| `OPENROUTER_API_KEY` | Optional. The deploying environment's `OPENROUTER_API_KEY` (a GitHub secret in CI), bound as a Worker secret; empty when unset. AI features fail closed (`AiNotConfigured`) without it. Account settings and the EU-only routing are per ADR 0015. |

`BETTER_AUTH_SECRET` comes from `packages/auth`'s `authOptions`; it is not a stage secret. Better Auth's own tables live in D1 (`packages/cloudflare/d1-migrations/0008_better_auth.sql`) and are migrated by the normal deploy.

**Plugins.** `packages/auth/src/options.ts` enables Better Auth's `magicLink`, `admin`, `organization` and `passkey` plugins beside the email code (ADR 0024). A magic link is mailed through the same `EmailSender`, expires after 5 minutes and works once. The admin plugin's `role` is the auth plane's own, not the Organization admin (ADR 0003), and Organization creation stays the allowlisted flow, so the plugin's `auth_organization`, `auth_member` and `auth_invitation` rows are not the tenant. The passkey relying party comes from the stage's base URL. Plugin tables and columns are `d1-migrations/0009_better_auth_plugins.sql`.

**Session cookie.** `__Host-surveybeat-session` holds Better Auth's session token: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`. Better Auth sets it with a 30-day lifetime and refreshes it on use. POSTs with an `Origin` other than the stage's own are refused (`requireSameOrigin`), and Better Auth's own endpoints check `trustedOrigins`.

**Per-request check.** The cookie is read against `auth_session`; then the Person linked to that user must be active in the chosen Organization's Durable Object (ADR 0010, ADR 0023). The Organization the session is working in is stored beside the session in `auth_session_organization`, so one session spans Organizations and `/auth/organization/choose` writes nothing about the organization into the cookie. Sign-out deletes the session row, which takes that choice with it through the foreign key.

**Organization admins** are held in the Organization's Durable Object (`person.organization_admin`) and nowhere else (ADR 0003). There is no outward role to keep in step: the auth layer knows who signed in, the Organization knows what they may do.

**Teams and People** (`/api/*`, `packages/cloudflare/src/DirectoryHandlers.ts`, rules in `packages/domain/src/people/Directory.ts`, permissions in `Permissions.ts`). The Durable Object authorizes and commits each change in one transaction, and records each new email in its outbox; the Worker then puts the D1 index in step, and the outbox puts the email on the email queue. Removing a Person marks them removed in the Durable Object (the per-request check denies them at once), sets `person_index.removed_at` so sign-in stops offering that Organization while an access export can still find it, and ends their Memberships, with history kept.

**D1 index** (`d1-migrations/0003_people_index.sql`): `organization_index` (Organization name), `person_index` (auth user → Persons; email → Organizations for Persons not yet linked; emails normalised; `removed_at` hides a removed Person from sign-in and keeps the row for an access export), and `organization_claim` (one created Organization per auth user, which makes creation idempotent).

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

## Cloudflare compliance (Steampipe + Powerpipe)

`infra/compliance/` defines a Powerpipe mod (`surveybeat_cloudflare_compliance`) backed by Steampipe's `turbot/cloudflare` plugin, with `gdpr`, `soc2`, and `all_compliance` benchmarks covering TLS/HSTS, WAF, DNSSEC/CAA/SPF/DMARC, account 2FA, API token expiry, Access policies, notification policies, audit logs, Logpush hygiene, and Submission Worker log isolation (`logpush = false`, empty `tail_consumers`).

Because `turbot/cloudflare` does not expose Workers Observability (`observability.logs` / `traces` / `invocation_logs`), D1, Durable Objects, AI Gateway, or Email Sending, pass `--stage <stage>` to `pnpm check:compliance` (or run `pnpm check:observability --stage <stage>` alongside it) to cover the full privacy boundary.

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

**The `send_email` binding is named `SendEmail`.** Binding names share one namespace per Worker. Until #147 it was named `Email`, like the Email queue's producer binding; the deploy kept only the queue, so production queued each rendered email instead of sending it and every send failed as `unknown`. Read the deployed bindings back with `cf workers versions get <version> --worker-id <main worker>` when email stops arriving.

**Send states.** `pending → sending → sent | failed(reason)`. A delivery takes a two-minute lease before calling the provider, and the call times out after 30 seconds. A clear rejection (`E_RATE_LIMIT_EXCEEDED` and other coded errors) returns the send to `pending` and the message is retried after 30 s, 60 s, and 120 s; the fourth rejection fails it. Permanent rejections (`E_RECIPIENT_SUPPRESSED`, sender and header errors) fail at once. An error without a code, a timeout, or a lease that expired with no outcome fails the send as `unknown`, and it is never resent automatically. A message the queue dead-letters fails its send too (`abandoned`, or `rejected` after earlier rejections).

**Resend.** An Organization admin can resend a failed send from the Failed emails list in Organization settings (`POST /api/organization/failed-emails/:sendId/resend`, #159). The same send goes back to `pending` under its id, with its stored content and recipient, and is queued again; the consumer renders it as on the first delivery. A complained-about send is never resent, and an Invitation, reminder, or test email only while its link is still live (Invitation not revoked or re-sent since, test send still kept). Repeating the request sends it once.

**Bounces and complaints.** Alchemy's `Cloudflare.Queues.Subscription` with the `email.sending` source subscribes the `EmailEvents` queue to `message.bounced`, `message.complained`, `message.rejected`, and `message.failed` for the sending subdomain. The consumer finds the send through the D1 table `email_message` (provider message id → Organization and send) and fails it with the event's reason.

**Fallback.** Postmark would be a second `EmailSender` adapter in `packages/cloudflare`, with its webhooks parsed into the same delivery events (`docs/research/cloudflare-email-sending.md` §9). It is not built.

## Main Worker wiring

`MainWorker` serves the API (the `@surveybeat/api` declaration over the Organization Durable Object) and the static assets built from `apps/web`; the landing page is `SiteWorker` (ADR 0020), and the answer page's submission path is `SubmissionWorker`. The wiring lives in `WorkerWiring.ts` so its rules are testable, and `WorkerWiring.test.ts` pins them:

- **Client-routed app.** `mainWorkerAssets` sets `notFoundHandling: "single-page-application"`, so an unmatched path serves `index.html` and the app renders it: a bookmark or a refresh on `/history`, `/settings` or `/teams/<id>` must not answer 404. `/auth/*`, `/api/*`, `/delivery` and `/delivery/*` reach the Worker before any asset, and the `/__test/*` routes join them only on a `test_*` stage.
- **Absolute assets.** `assetsDirectory` is resolved from the module URL, so Alchemy can start from any working directory.
- **No filesystem in an isolate.** `httpPlatformStub` binds `HttpPlatform` with `platform: "web"`, no compression algorithms, and file responses that die, because a Worker isolate has neither a filesystem nor gzip.
- **Origins.** `APP_ORIGIN` is bound only when the stage has a custom hostname, since the Organization Durable Object builds email links from it. A stage on workers.dev leaves it unset and falls back to a reserved `.invalid` origin; those stages never send real email (see Email above).
- **One Organization namespace.** The Main Worker hosts the Organization Durable Object (`OrganizationLive`, provided in `MainWorker.ts`). `SubmissionWorker` binds that same namespace with `Organization.from(...)`, so an Invitation's token resolves to the Organization that holds its Round. A bare `yield* Organization` in a second Worker would host a second, empty namespace whose setup needs `INVITATION_TOKEN_KEY`, which that Worker does not have: every exchange answered 500 (#231). `Organization.test.ts` deploys both Workers and exchanges a real test Invitation's token. Moving a class off the Worker that hosts it takes two deploys (Alchemy's `DurableObjectTransferRequired`): the first drops the private binding, the second adds the cross-script one.
- **Queues.** Production sends through Cloudflare Email Sending while every other stage records the messages in D1 and binds no `send_email`. Cloudflare does not drain or alert on a dead-letter queue, so its consumer logs the code only, never the message body. The email queue's 10 attempts cover leases held by another delivery and rejections waiting for their next attempt; a failed enqueue leaves the send pending, and repeating the request queues it again. Bounces and complaints arrive from the event subscription on the sending subdomain (`infra/alchemy.run.ts`).
- **Cron.** The daily job repairs missing alarms across all Organizations (ADR 0006), one page of `organization_index` per run, so the read and the Durable Object calls stay bounded as Organizations are added (`repairWindow`, `CronSweep.test.ts`).

## Storage and queues

- **D1 holds the index, never survey content.** `Database` (`packages/cloudflare/src/Database.ts`) carries the global index from SPEC §6.2: sign-in lookups, the session deny list, invitation routing, and the email bookkeeping (`captured_email`, `email_message`, `test_send`). Rounds, Pulses, Submissions, Results and comments live in the Organization Durable Object. D1 migrations are `packages/cloudflare/d1-migrations`; the Durable Object's are `packages/cloudflare/migrations`, named relative to the repository root because Alchemy runs there. Every resource is declared in `infra/alchemy.run.ts`.
- **Queues.** `Jobs`/`JobsDlq` carry the Organization's scheduled work, `Email`/`EmailDlq` the transactional sends, and `EmailEvents` the bounce and complaint subscription (production only). Cloudflare neither drains nor alerts on a dead-letter queue, which is why each has its own consumer, and the email queue keeps 10 attempts.
- **Email retention.** The sending subdomain is declared with `previewEnabled: false`, so Cloudflare does not keep each message, invitation links included, for about a week. Only `production` binds `send_email`; every other stage records into `captured_email`.

## The site Worker

`SiteWorker` serves the prerendered landing page and the legal pages `/privacy`, `/terms`, `/dpa` and `/subprocessors` (issue #305) from `apps/web/dist-site` (ADR 0020) with `htmlHandling: "auto-trailing-slash"`. `/app` and `/app/` answer a 302 to the app origin on a GET, and anything the assets do not match answers 404. Production serves the apex only while `APEX_SERVED_BY_SITE` is on, with `www` redirecting to it; staging and PR stages get `<stage>.surveybeat.app`. `EmailConfig.test.ts` pins the redirect rule and both asset directories.

## Compliance documentation

GDPR governance records live under `docs/compliance/`:

- [Record of Processing Activities (`docs/compliance/ropa.md`)](compliance/ropa.md) — Art. 30 controller/processor table mapped to exact D1 and Organization Durable Object schemas, retention (`Policy.ts`), and the Recital 26 analysis of anonymity and residual identifiability for `submission` and `answer` rows.
- [Data Protection Impact Assessment (`docs/compliance/dpia.md`)](compliance/dpia.md) — Art. 35 necessity/proportionality and risk register tied to ADRs 0003, 0004, 0005, 0009, and 0015.
- [Breach Response Runbook (`docs/compliance/breach-response-runbook.md`)](compliance/breach-response-runbook.md) — Art. 33–34 detection channels (`check:observability`, `canary-sweep.ts`, `[OPERATOR_ALERT]` logs, sub-processor advisories), 72-hour timeline, and notification templates.
- [Vendor DPA Register & LIA Template (`docs/compliance/vendor-dpa-register.md`)](compliance/vendor-dpa-register.md) — Art. 28 sub-processor register (Cloudflare, OpenRouter, Google Cloud Vertex EU, AWS Bedrock `eu-west-1`) and reusable customer Legitimate Interest Assessment template.

Whenever a SQL migration (`packages/cloudflare/migrations/`, `packages/cloudflare/d1-migrations/`), `Policy.ts` retention constant, or sub-processor/AI-routing configuration changes, update `docs/compliance/ropa.md` (and `dpia.md` / `vendor-dpa-register.md` as applicable) in the same change.
