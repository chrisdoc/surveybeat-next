# Can `vercel/chat` run on Cloudflare Workers with Alchemy and Effect 4 for Slack and Microsoft Teams?

Research for issue #297 (map #295, blocks #298). This is throwaway research and will not be merged.
Context: SPEC.md §5.1 and §5.7 (Slack and Teams Channels), §6 (Cloudflare only: Workers, Durable Objects, D1; no external store or relay), ADR 0005 (the Invitation token travels in the URL fragment and reaches only the Submission Worker), ADR 0007 (a rating link only preselects), ADR 0008 (Effect and Alchemy stay in `packages/cloudflare`; answer entry has a tight budget). Pins checked in `pnpm-workspace.yaml` on `origin/main` at `32216f8c`: `effect` 4.1.4, `alchemy` 2.0.0-beta.87.

Researched 2026-11-20 against `chat`, `@chat-adapter/slack`, `@chat-adapter/teams` and `@chat-adapter/state-memory` **4.45.0** (published 2026-11-13), read from the npm tarballs. "Spike" below means a throwaway Worker I bundled with esbuild 0.28.2 and ran in local workerd 1.20261026.1 (`compatibilityDate = "2026-10-01"`, `nodejs_compat`). The spike code is not committed. Claims marked *(secondary)* come from a forum or Q&A thread, not vendor docs or source.

## TL;DR

1. **It runs, but heavily.** Both adapters load and work in workerd: Slack signature checks, a slash command handler, and outbound Slack Web API calls work, and so do Teams JWT checks against Microsoft's live JWKS and an MSAL token request to Entra ID. The cost is size. Core alone is 266 KiB minified (79 KiB gzip), with Slack 692 KiB (188 KiB), with Teams 2.33 MiB (617 KiB), and with both 2.66 MiB (727 KiB). Teams pulls in `express`, `@azure/msal-node`, `jsonwebtoken`, `jwks-rsa`, `axios`, `@microsoft/signalr` and a 372 KiB Graph endpoint table.
2. **It needs a state store, and the only fits are a Durable Object or an in-memory adapter.** `Chat` requires a `StateAdapter` ("**required**"). The official production adapters are Redis, ioredis and PostgreSQL, so none of them fits SPEC §6. A community `chat-state-cloudflare-do` (v0.2.0, one maintainer) exists, or we could write our own on the Organization DO. Multi-workspace Slack keeps bot tokens in that store, and both adapters cache personal data in it: Slack caches name, email and avatar for 8 days, Teams caches tenant, AAD object ID and service URL for 30 days.
3. **Its link button breaks ADR 0005 on Slack.** `LinkButton` renders as a Block Kit button with `url`, and Slack sends an interaction payload for every click. The default `action_id` is `link-${url.slice(0,200)}`, so the Invitation token (in the fragment) would arrive at MainWorker together with the clicking Person's Slack user ID. `CardLink` (a plain `<url|label>`) avoids this. We would then use the SDK only to post text, which a thin adapter does with one `fetch`.
4. **Our surface is small and outbound-first.** We need to post, edit and delete messages, take one slash command, verify two webhook signatures and run two install flows. A thin Effect adapter per platform should be roughly 5–15 KiB (an estimate, not measured) and decodes with Effect Schema. It keeps state in the Organization DO beside the Person and logs only what we choose. **Recommendation: thin Effect adapters, not `vercel/chat`.** Details and ADR constraints are at the end.
5. **Open, needs a live test:** whether Teams (Safe Links click-time check, desktop, mobile, web) keeps the `#t=…&v=…` fragment; whether a plain Slack mrkdwn link sends any event when clicked; whether a single-tenant Azure Bot can proactively message users in customer tenants.

## 1. Workerd compatibility and bundle footprint

### What the packages import

Read from `dist/*.js` in each tarball:

- `chat`: `async_hooks`, `crypto`, `unified`/`remark-*` (Markdown AST), `@workflow/serde`. `ai`, `zod` and `workflow` are optional peers (`npm view chat peerDependenciesMeta`).
- `@chat-adapter/slack`: `@slack/web-api` (axios, p-queue, form-data), and a **static** `import { SocketModeClient } from "@slack/socket-mode"` (pulls in `ws`), even though we only need webhook mode. It also imports `async_hooks` and `crypto`.
- `@chat-adapter/shared`: `dns/promises`, `https`, `net` (`BlockList`), `stream`, `zlib`, for the guarded file-download transport.
- `@chat-adapter/teams`: `@microsoft/teams.apps` 2.2.1, which depends on `express` 5, `cors`, `@azure/msal-node`, `jsonwebtoken`, `jwks-rsa`, `axios`, `@microsoft/signalr`, `@opentelemetry/api` and `reflect-metadata`. It also depends on `teams.api`, `teams.cards`, `teams.graph` and `teams.graph-endpoints` (from `npm view` of each package).

### Spike results

Measured with esbuild bundling for workerd (`--platform=node --conditions=workerd,worker,browser --minify`, Node built-ins external):

| Entry | Minified | gzip -9 |
| --- | ---: | ---: |
| `chat` + memory state, no adapter | 272,280 B | 80,544 B |
| + Slack adapter | 708,852 B | 192,782 B |
| + Teams adapter | 2,444,832 B | 632,256 B |
| + Slack and Teams | 2,786,720 B | 744,724 B |

The largest contributors to the combined bundle (esbuild metafile, bytes in output): `iconv-lite` 482 KiB, `@microsoft/teams.graph-endpoints` 372 KiB, `mime-db` 280 KiB, `@azure/msal-node` 188 KiB, `@microsoft/teams.apps` 162 KiB, `axios` 144 KiB, `@chat-adapter/slack` 103 KiB, `chat` 95 KiB.

Behaviour in workerd 1.20261026.1 with `nodejs_compat`:

- **Module load.** The first build failed at startup with `Dynamic require of "node:os" is not supported`, because the CommonJS dependencies `require()` Node built-ins inside an ESM bundle. A `createRequire` banner fixed it. Alchemy's bundler uses an unenv-based `nodejs-compat` rolldown plugin (`@alchemy.run/cloudflare-runtime/dist/rolldown/plugins/nodejs-compat.js`) that is meant to handle this. I did not build the spike through Alchemy, so **a real Alchemy build is still unverified**.
- **Slack inbound.** A bad signature returned `401 Invalid signature`. A timestamp 10 minutes old was rejected ("Slack timestamp is too old"). A correctly signed `/pulse` slash command returned `200` and ran the handler through `waitUntil`.
- **Slack outbound.** The first webhook triggered `auth.test` (adapter initialization), and the slash command handler called `users.info` for the invoking user. Both requests went through axios to a mock API. If the API is unreachable, `@slack/web-api` retries for minutes inside the request, which is a cold-start latency risk against Slack's 3-second acknowledgement window ([Slack: handling user interaction](https://docs.slack.dev/interactivity/handling-user-interaction)).
- **Teams inbound.** A missing `Authorization` header returned `401 Missing authorization header`. A forged JWT returned `401 JWT validation failed`, after `jwks-rsa` fetched Microsoft's live signing keys from workerd.
- **Teams outbound.** `openDM` ran MSAL's client-credentials flow from workerd and got a real Entra ID error back (`AADSTS700038 … is not a valid application identifier`). The token path works. Sending a message needs a real bot.
- **Logging.** `new Chat({ logger: "silent" })` did not silence the adapters. `[chat-sdk:slack] …` and `[ERROR] @teams/app/jwt-validator …` lines still reached the console, and the adapters' own default is `ConsoleLogger("info")` (Slack and Teams READMEs, `logger` option). MainWorker has Workers Logs on, so each adapter needs its own logger, and the Teams SDK's internal logger needs separate wiring.

Cloudflare limits are 64 MiB uncompressed, with no compressed limit. Startup has a 1-second limit to "parse and execute its global scope", and "Larger Worker bundles can impact startup time" ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). Adding 2.7 MiB fits the size limit, but it would make MainWorker's cold start larger. Our local timing was too noisy to report. An Alchemy deploy of a preview stage would give the real startup figure.

**Effect 4 fit.** The SDK is a Promise and class API with a mutable singleton (`new Chat`, `bot.onSlashCommand`, `bot.webhooks.slack(request, { waitUntil })`). It uses `AsyncLocalStorage` for per-call bot tokens (`withBotToken`, Slack README). It works behind `Effect.tryPromise`, but errors, retries and timeouts stay inside axios and p-retry instead of being typed, which goes against SPEC §6.1 ("Errors, dependencies, retries, and timeouts are typed").

## 2. Webhook signature verification and stateless handling in MainWorker

**Slack.** The signature is `v0=` plus the HMAC-SHA256 hex digest of `v0:{X-Slack-Request-Timestamp}:{raw body}`, keyed by the signing secret. Verify it over the raw body before parsing, with a constant-time compare. The documented example rejects timestamps more than 5 minutes off as a possible replay ([Verifying requests from Slack](https://docs.slack.dev/authentication/verifying-requests-from-slack)). The adapter does this (spike above). If you pass a custom `webhookVerifier`, "you are responsible for replay/timestamp protection" (Slack README). In Workers, the whole check is `crypto.subtle.importKey` + `sign` + compare, about 30 lines. Interactions and slash commands must be acknowledged within 3 seconds ([handling user interaction](https://docs.slack.dev/interactivity/handling-user-interaction)). Ack first, then run the work in `ctx.waitUntil` or a Queue.

**Teams (Bot Connector).** The bot must verify the inbound `Authorization: Bearer` JWT. The issuer must be `https://api.botframework.com`, the audience must be the bot's App ID, the token must be in date (5 min skew), the signature must use a key from `https://login.botframework.com/v1/.well-known/openidconfiguration` → `jwks_uri` (refresh at least every 24 h), and the `serviceUrl` claim must match the activity's `serviceUrl`. Channel endorsements are checked where required ([Bot Connector authentication](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication)). That is RS256 via `crypto.subtle.verify` plus a JWKS cache (a `caches.default` entry or a module-scope value with a TTL). Outbound calls use a client-credentials token from `login.microsoftonline.com/{tenant}/oauth2/v2.0/token` with scope `https://api.botframework.com/.default`, valid for 3600 s, which we should cache (same page).

**Stateless?** Signature checks need no state. The SDK still touches state on every webhook. It deduplicates Slack retries by `event_id` through the state adapter, takes a per-thread lock for message events, and caches user profiles (Slack README "Enterprise Grid"; `chat/docs/state-adapters.mdx`). With the memory adapter those are per-isolate and lost on eviction. For a slash-command-only inbound surface we don't need any of it: Slack slash commands are not retried as events, and the reply goes to `response_url` or an ephemeral message.

## 3. Is a Durable Object SQLite `StateAdapter` needed?

**Short answer:** with `vercel/chat`, yes, or we accept per-isolate memory state. With thin adapters, no separate adapter is needed. The few records we keep are ordinary rows in the Organization DO and D1.

- `ChatConfig.state` is **required** ("State adapter for subscriptions, locking, and dedup", `chat/README.md`). The `StateAdapter` interface has 19 methods: locks, `setIfNotExists`, lists, queues, subscriptions and key/value with TTL (`chat/dist/types-*.d.ts`).
- Official production adapters: Redis, ioredis, PostgreSQL. The docs point Vercel users to Upstash, Redis Cloud, Neon or Supabase ([state adapters doc](https://chat-sdk.dev/docs/state-adapters), mirrored at `chat/docs/state-adapters.mdx`). **All are third-party stores and break SPEC §6.** "In production, use Redis, ioredis, or PostgreSQL."
- **What lands in state:**
  - Slack multi-workspace mode stores each installation (bot token, optionally AES-GCM encrypted with `SLACK_ENCRYPTION_KEY`) under `slack:installation:{teamId}`. An `installationProvider` can make token reads come from our own store, but `handleOAuthCallback`, `setInstallation` and `deleteInstallation` still write to the state adapter (Slack README).
  - Slack `getUser` caches `{displayName, realName, email, avatarUrl}` for 8 days, plus a name→ID reverse index (`USER_CACHE_TTL_MS`, `@chat-adapter/slack/dist/index.js` ~L2380).
  - Teams caches `teams:serviceUrl:`, `teams:tenantId:` and `teams:aadObjectId:` per user for 30 days (`CACHE_TTL_MS`, `@chat-adapter/teams/dist/index.js` L2082, L2351). `openDM` throws "User must interact with the bot first … to cache their tenant ID" when the tenant isn't cached (L3480).
- An existing Cloudflare option is `chat-state-cloudflare-do` 0.2.0 (MIT, 54 stars, last push 2026-07-02). It is a SQLite-backed DO with its own class and binding ([repo](https://github.com/dcartertwo/chat-state-cloudflare-do)). It would be a second DO namespace outside the Organization DO, holding personal data and bot tokens that GDPR export and erasure (#306, #307) would have to cover separately.
- Our surface (outbound Invitations, Reminders and Shared Results; one slash command; install callbacks) needs **none** of subscriptions, thread locks, message queues or history. What it does need is durable and belongs to the Organization (§5 and §9 below).

## 4. Card rendering fidelity

**What we post** (SPEC §5.1, #298 decisions on #295): an Invitation with a title, the anonymity line, five 1-tap rating links and "Open check-in"; a Reminder; a Shared Results summary (no comments, counts or Discussion guide). Unfurls must be off. Messages are edited later to remove answer links.

**Slack (Block Kit).**
- A `section` with mrkdwn text and `<url|label>` links renders all of this. A plain link is not an interactive component. The documented interaction payloads are `block_actions`, `shortcut`/`message_actions`, `view_submission` and `view_closed` ([handling user interaction](https://docs.slack.dev/interactivity/handling-user-interaction)). None of them is a hyperlink in text. The docs don't say outright that a plain link sends nothing, so this needs a live test (§7).
- **URL buttons do send a payload.** The button element docs say: "If you're using url, you'll still receive an interaction payload and will need to send an acknowledgement response" ([button element](https://docs.slack.dev/reference/block-kit/block-elements/button-element)). The `block_actions` payload carries `user.id`, `team.id`, `action_id` and the `message` the block is in ([block_actions payload](https://docs.slack.dev/reference/interaction-payloads/block_actions-payload)), and that message contains the button URL with our fragment token. **So the Invitation must use text links, not buttons**, or the token and the Person's identity reach MainWorker on every tap.
- Unfurling: "By default, we unfurl all links in messages posted by users and Slack apps", and "Slack crawls the URL". Set `unfurl_links: false` and `unfurl_media: false` ([unfurling links](https://docs.slack.dev/messaging/unfurling-links-in-messages)). A crawler GET never carries the fragment, so even a missed unfurl leaks no token (ADR 0005). The Chat SDK adapter already sets both flags to `false` on every `chat.postMessage` (`index.js` L4623, L4651).
- `vercel/chat` mapping: `CardLink` → `<url|label>` (fine). `LinkButton` → ``{type:"button", url, action_id: button.id ?? `link-${button.url.slice(0,200)}`}`` (`@chat-adapter/slack/dist/index.js` L288–300), which puts the token in `action_id` as well. `Table` → Slack data table. No other element covers something we can't write by hand.

**Teams (Adaptive Cards).**
- `TextBlock`s plus an `ActionSet` of `Action.OpenUrl` render the Invitation. `Action.OpenUrl` "opens a specified URL in the user's browser". Only `Action.Execute`/`Action.Submit` send an `adaptiveCard/action` invoke to the bot ([card actions](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions)). Unlike Slack, a Teams link button does not call us. The target domain must be in the manifest's `validDomains`, or Teams shows "URL may lead to untrusted content" (same page). The Microsoft examples use card `version: "1.5"`.
- `vercel/chat` maps `LinkButton` → `Action.OpenUrl` (`@chat-adapter/teams/dist/cards.js` L233). But if a card contains any input, it appends an automatic `__auto_submit` action (L214), which is an `Action.Submit` path we would not want.
- Editing the message later uses `PUT {serviceUrl}/v3/conversations/{conversationId}/activities/{activityId}`, so we must keep the activity ID returned by the post ([proactive messages](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages)).

**Verdict on fidelity.** The SDK's lowest-common-denominator JSX produces acceptable Block Kit and Adaptive Cards, but its interactive defaults work against us (Slack link buttons, Teams auto-submit). Our three message types are short, fixed templates. Hand-written JSON built from Effect Schema types, with strings from the messages catalog, gives full control and can be snapshot-tested.

## 5. Teams proactive messages: what an unprompted Invitation needs

From [Send proactive messages](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages) (updated 2026-11-15) and [Proactively install your bot with Graph](https://learn.microsoft.com/en-us/microsoftteams/platform/graph-api/proactive-bots-and-messages/graph-proactive-bots-and-messages) (updated 2026-08-03):

- **The app must be installed for the user.** "For a user to receive proactive messages, install the app for the user or make the user a part of a team in which the app is installed." Sending by `aadObjectId` without a personal install returns `403 ForbiddenOperationException`.
- **Email cannot address a user:** "Email addresses and User Principal Names (UPNs) can't be used to address proactive messages in any scope." We need the Person's Entra object ID: from the install or `conversationUpdate` activity, or from Graph `GET /users/{upn}`, which needs the application permission `User.Read.All` ([Get user](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0)).
- **Proactive install** needs the application permission `TeamsAppInstallation.ReadWriteSelfForUser.All`, a `webApplicationInfo` entry in the manifest, and **explicit admin consent in the customer's tenant**. "Microsoft Graph can only install apps published to your organization's app store or the Microsoft Teams Store."
- **Create the conversation once and store it.** You need `aadObjectId` or `userId`, `tenantId` and `serviceUrl`, then call `POST {serviceUrl}/v3/conversations`. "Create the conversation only once, and store the resulting `conversationId` for future proactive messages." Use the `serviceUrl` from an incoming activity. `https://smba.trafficmanager.net/teams/` is the public fallback. A blocked or uninstalled bot gets `403` with `subCode: MessageWritesBlocked`, which we can map to "fall back to Email".
- **Azure Bot registration.** "Multi-tenant bot creation will be deprecated after July 31, 2025." New bots are single-tenant or user-assigned managed identity ([Create an Azure Bot resource](https://learn.microsoft.com/en-us/azure/bot-service/abs-quickstart)). Managed identity needs an Azure-hosted token endpoint, which a Worker can't use, so **a single-tenant bot with a client secret (or certificate)** is the realistic choice. Microsoft documents no official path for a single-tenant bot reaching users in other tenants. Q&A threads say Teams Store publication makes it work, and others report cross-tenant auth failures *(secondary)* ([Q&A](https://learn.microsoft.com/en-us/answers/questions/5645637/how-to-enable-a-multi-tenant-one-on-one-bot-in-mic), [Tech Community](https://techcommunity.microsoft.com/discussions/teamsdeveloper/questions-about-alternatives-to-multi-tenant-bots-after-july-31-2025-deprecation/4423676)). Neither SDK changes this.
- **Where the reference lives.**
  - Per Person: `{tenantId, aadObjectId, conversationId, serviceUrl}`. It is personal data that belongs to one Person in one Organization and must go with GDPR export and erasure (#306, #307). It belongs in the **Organization DO**, next to the Person's preferred Channel.
  - The posted `activityId` per Invitation (for the later edit) is also stored there.
  - D1 holds only the lookup that must happen before the Organization is known: `teams tenantId → OrganizationId` and `slack team_id/enterprise_id → OrganizationId`, as SPEC §6.2 already lists ("Slack and Teams workspace to organization").

## 6. App registration and OAuth installation per Organization

**Slack.**
- One SurveyBeat Slack app. Each Organization installs it into its workspace through OAuth v2. Redirect to `slack.com/oauth/v2/authorize` with a `state`, the `code` expires after 10 minutes, then call `oauth.v2.access` and get a bot token plus `team.id` (or `enterprise.id` with `is_enterprise_install`). "OAuth tokens do not expire" unless token rotation is turned on ([Installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth)).
- Installing outside the owning workspace needs public distribution (`invalid_team_for_non_distributed_app` otherwise).
- Scopes for our surface: `chat:write`, `im:write` (open DMs), `commands`, and `users:read.email` for `users.lookupByEmail` (Tier 3) to map a Person's email to a Slack user ([users.lookupByEmail](https://docs.slack.dev/reference/methods/users.lookupByEmail)).
- Marketplace: since 2025-05-29, unlisted commercially distributed apps get 1 request/min on `conversations.history`/`replies`. Slack says "the Slack Marketplace is the only appropriate channel for commercially distributing apps" ([changelog](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps)). We don't call those methods, but Marketplace review is a business and legal step before customers outside our own workspace.

**Microsoft Teams.**
- One Entra app registration plus one Azure Bot resource (single-tenant, see §5), and one Teams app package (manifest with `bots`, `validDomains`, `webApplicationInfo`).
- Each customer gets it through their org catalog (the Teams admin approves an upload) or the Teams Store (Microsoft validation) ([Publish overview](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-publish-overview)). Their Entra admin then grants consent for `TeamsAppInstallation.ReadWriteSelfForUser.All` and `User.Read.All`.
- There is no per-install bot token as in Slack. The bot's own credential works in every tenant, and the per-Organization state is the tenant ID and conversation references.
- Infra: the Azure resources live outside Alchemy's Cloudflare provider. They are created once by hand or with the Teams CLI (`teams app create`, Teams README) and recorded in `docs/infra.md`. Only the App ID, secret and tenant ID enter Alchemy as Worker secrets.

## 7. The two link questions

### Microsoft Teams Safe Links and the `#t=…&v=…` fragment — not settled

What the docs say ([Safe Links overview](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about), updated 2026-10-29):

- "URLs in Teams are checked against a list of known malicious links when the protected user clicks the link (time-of-click protection). **URLs aren't rewritten.**"
- "the intermediary page that does Safe Links validation redirects to the target page, which is treated as a cross-site request". So a Safe Links page sits between the click and our page.
- Built-in protection applies Safe Links in Teams to every user in a tenant with at least one Defender for Office 365 license, and the "Do not rewrite" list is not honoured by Teams.

What that implies, and why it is not settled:

- An HTTP 3xx keeps the original fragment when `Location` has none (RFC 9110 §10.2.2), and a time-of-click lookup on the server never sees the fragment.
- If the intermediary passes our URL as a query parameter, or navigates with script, whether `#t=…&v=…` survives depends on Microsoft's implementation, which is not documented.
- Teams desktop, web and mobile also open links through different shells.
- I found no primary source either way.

Test that settles it: in an M365 tenant with a Defender for Office 365 P1 trial, Safe Links for Teams on, and a sideloaded test bot, post an Adaptive Card with `Action.OpenUrl` and a plain Markdown link to `https://<preview>/a#t=TEST&v=3`. Click each on Teams desktop (Windows and macOS), web and iOS/Android. Use a test `answer.html` that renders `location.hash`. If any client drops it, Teams Invitations offer only "Open check-in" (the Teams fallback named in #295). Even if the fragment is lost, the token never reaches a server, because a dropped fragment is simply gone.

### Slack plain links send no event — documented by omission, test to confirm

- The documented interaction payload types (§4) are all triggered by interactive components, shortcuts or modals. `link_shared` fires only for an app's registered App Unfurl Domains (needs `links:read`), and "is not dispatched for messages posted by an app" ([unfurling links](https://docs.slack.dev/messaging/unfurling-links-in-messages)). So a plain `<url|label>` in a message the app posted, with no unfurl domain registered, has no documented path to our request URL. A URL **button** does send a `block_actions` payload (§4).
- Test that settles it: in a test workspace, have the app post a message with a mrkdwn link and a URL button, Interactivity and Event Subscriptions on, and the request URL pointing at a logging endpoint. Click both on desktop, web and mobile, and confirm that only the button produces a request.

## 8. Recommendation

**Build thin Effect adapters for Slack and Microsoft Teams behind the `ChannelSender` port. Do not adopt `vercel/chat`.**

Why:

- **Fit to the surface.** We need post, edit and delete for three fixed templates, one slash command, two signature checks and two install flows. `vercel/chat` is built for conversational bots (subscriptions, thread locks, streaming, AI SDK, history), and those features are why it requires a state store.
- **Cloudflare-only.** Its only official production stores are Redis and Postgres. Using it means writing or adopting a DO `StateAdapter` (19 methods) that holds bot tokens and cached personal data outside the Organization DO.
- **Privacy defaults.** The Slack `LinkButton` routes the Invitation token and the clicker's identity to MainWorker. The adapters cache emails and names for 8–30 days. Adapter loggers ignore `logger: "silent"`. Each needs a workaround, and each workaround is a place for a regression in a release-blocking invariant (SPEC §7).
- **Footprint and toolchain.** It adds about 2.7 MiB minified to MainWorker, with Express, MSAL and axios inside a Worker, Promise-typed errors, and retries we don't control. The thin adapters use `fetch`, `crypto.subtle` and Effect Schema, the same pattern as `CloudflareEmailSender`.
- **What we give up.** Ready-made OAuth callback handling, Slack Enterprise Grid quirks (shared channels, `enterprise_id` keys), and a cross-platform card DSL. The first two are worth copying from the adapter source as a reference. The third we don't need.

Revisit `vercel/chat` only if a later release adds two-way conversational features (for example "Ask your results" in chat, R5). Even then, put it in a separate Worker, so that MainWorker and the answer path stay small.

## 9. Constraints for the Channel delivery ADR

1. **No answers through chat.** Chat messages carry only links to `answer.html` (`/a#t=<token>&v=<n>`). No Slack Block Kit `button` (URL buttons send `block_actions`), no Teams `Action.Submit`/`Action.Execute`, no modals for answering. Inbound interaction endpoints accept only the slash command and install and uninstall events. Any other payload type gets `200` with no processing and no logging of its body.
2. **The Invitation token stays in the fragment** (ADR 0005), and the Channel adapter never logs a message body, URL or recipient ID. Adapters run in MainWorker or a Queue consumer, never in SubmissionWorker.
3. **Unfurls off.** Slack posts set `unfurl_links:false, unfurl_media:false`. Our domain is registered as no App Unfurl Domain. Teams uses Adaptive Cards (no link preview).
4. **Signature checks before parsing.**
   - Slack: HMAC-SHA256 over the raw body, constant-time compare, reject a timestamp older than 300 s.
   - Teams: RS256 JWT, `iss=https://api.botframework.com`, `aud=<AppId>`, 5-minute skew, `serviceUrl` claim equal to the activity's, JWKS from the Bot Framework OpenID document refreshed at least every 24 h.
   - Both run with `crypto.subtle`, with no Node crypto, Express or MSAL.
5. **Acknowledge within 3 s.** Slack slash commands answer at once and do the work in `waitUntil` or a Queue. Outbound sends go through the existing Queue with retries and a DLQ (SPEC §6.2), and every step is idempotent per (Invitation, Channel).
6. **Storage split.**
   - **D1:** only `slack team_id|enterprise_id → OrganizationId` and `teams tenantId → OrganizationId`.
   - **Organization DO:** the Slack installation (bot token encrypted with a Worker secret), each Person's Channel identity (Slack user ID, or Teams `aadObjectId` + `conversationId` + `serviceUrl`), and per-Invitation message handles (Slack `channel`+`ts`, Teams `activityId`) for the later edit.
   - No separate chat state store. GDPR export and erasure (#306, #307) cover these rows.
7. **No cached profiles.** Store only the IDs needed to deliver. Never store Slack or Teams display names, emails or avatars. Map email → platform ID once, when a Person picks the Channel (`users.lookupByEmail`, or Graph `GET /users/{upn}`), and keep only the ID.
8. **Edit-after-answer has no timing signal.** Remove answer links at Round close or in a periodic batch, not on each Submission. Otherwise the platform records a per-Person edit time that sits next to "answered" (ADR 0005 stores no time for Participation).
9. **App-level secrets via Alchemy** (Slack signing secret, client ID and secret; Teams App ID, secret, tenant ID; token-encryption key). The Azure Bot, Entra app and Teams package are set up outside Alchemy, by hand or with the Teams CLI, and documented in `docs/infra.md`.
10. **Teams prerequisites are explicit in the product.** The customer's Teams admin must make the app available (org catalog or Store), and their Entra admin must consent to `TeamsAppInstallation.ReadWriteSelfForUser.All` and `User.Read.All`. Until both are true for a Person, that Person's Invitations go by Email. A `403 MessageWritesBlocked` falls back to Email.
11. **Teams one-tap depends on the Safe Links test (§7).** If any supported Teams client drops the fragment, Teams Invitations carry only "Open check-in".
12. **Slack ships first** (map #295). Before external customers, decide on Marketplace listing, and on whether Slack and Microsoft are sub-processors (#305).
13. **Size budget.** The Slack and Teams adapters together add at most ~50 KB minified to MainWorker. A dependency that pulls in `express`, `axios`, `@azure/msal-node` or `ws` needs an ADR.

## Sources

Package source (npm tarballs, version 4.45.0): `chat/README.md`, `chat/docs/state-adapters.mdx`, `chat/docs/cards.mdx`, `chat/dist/types-*.d.ts`, `@chat-adapter/slack/README.md` and `dist/index.js`, `@chat-adapter/teams/README.md`, `dist/index.js` and `dist/cards.js`, `@chat-adapter/shared/dist/index.js`. Repository: [vercel/chat](https://github.com/vercel/chat). Community DO adapter: [dcartertwo/chat-state-cloudflare-do](https://github.com/dcartertwo/chat-state-cloudflare-do).

Slack: [verifying requests](https://docs.slack.dev/authentication/verifying-requests-from-slack), [handling user interaction](https://docs.slack.dev/interactivity/handling-user-interaction), [button element](https://docs.slack.dev/reference/block-kit/block-elements/button-element), [block_actions payload](https://docs.slack.dev/reference/interaction-payloads/block_actions-payload), [unfurling links](https://docs.slack.dev/messaging/unfurling-links-in-messages), [installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth), [users.lookupByEmail](https://docs.slack.dev/reference/methods/users.lookupByEmail), [non-Marketplace rate limits changelog](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps).

Microsoft: [send proactive messages](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages), [proactive install with Graph](https://learn.microsoft.com/en-us/microsoftteams/platform/graph-api/proactive-bots-and-messages/graph-proactive-bots-and-messages), [Adaptive Card actions](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions), [Bot Connector authentication](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication), [create an Azure Bot resource](https://learn.microsoft.com/en-us/azure/bot-service/abs-quickstart), [Graph get user](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0), [publish overview](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-publish-overview), [Safe Links overview](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about).

Cloudflare: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
