# Can vercel/chat run SurveyBeat's Slack and Microsoft Teams Channels?

Research for issue #297 (map #295, Release 3). Researched 2026-11-20 against `chat`, `@chat-adapter/slack` and `@chat-adapter/teams` **4.45.0** (published 2026-11-13). This note changes no code, adds no dependency and edits neither `SPEC.md` nor any ADR. The Channel ADR (numbers 0027+) takes its constraints from §4.

Claims marked *(secondary)* come from a forum or Q&A thread, not from vendor documentation. Claims marked *(measured)* come from the throwaway probes described in §2.1, which are not committed.

## 1. Recommendation

**Use thin custom Effect adapters for Slack and Microsoft Teams behind the domain `ChannelSender` port. Do not adopt the `Chat` runtime, its `StateAdapter`, or the full `@chat-adapter/*` packages.**

The `Chat` runtime is built for conversational bots (threads, subscriptions, locks, message dedupe), and R3's Channel work is outbound-first plus one slash command. The full adapters do run in workerd (*measured*), but the Teams adapter alone adds about 897 KiB gzip and spent 1.8 s of active startup CPU in the one local profile that finished, against a 1 s Worker startup limit; the `Chat` runtime also needs a `StateAdapter` that SurveyBeat has no Cloudflare-native, tenant-isolated implementation of.

What to build, in order:

1. **Slack first**, as #295 sequences it. About five endpoints are needed: signature verification (Web Crypto HMAC), `oauth.v2.access`, `chat.postMessage`, `chat.update`/`chat.delete`, and `users.lookupByEmail`. All are plain `fetch` calls validated with Effect Schema at the boundary.
2. **Teams second, behind a tenancy spike** (§3.6). The Azure Bot tenancy rules changed in 2025 and a single-tenant bot may not reach other customers' tenants. This is the largest unresolved risk in R3.
3. **No external store, no `StateAdapter`.** Everything an outbound-first Channel needs (installation token, Person-to-Channel binding, sent-message id for later edits) is Organization state and belongs in the Organization Durable Object beside the existing `SendStore`. Redis would break SPEC §6; the Durable Object SQLite `StateAdapter` that exists today ships in Cloudflare's `agents` package, not in `vercel/chat` (§3.3), and is not worth taking on for a surface this narrow.
4. **Treat `@chat-adapter/{slack,teams}` as reference and test vectors**, not as a dependency. Their stateless subpath modules (`/webhook`, `/api`, `/blocks`, `/cards`) are small, MIT, `fetch`-based and run in workerd with 13.1 KiB gzip (*measured*). Our code is smaller than the cost of tracking a package that shipped seven minor releases between 2026-08-14 and 2026-11-13. If the Channel ADR prefers to reuse them, it must name the package, as AGENTS.md requires, and pin an exact version.

**Revisit this if** a later release wants in-chat conversation (threads, "reply to answer", streaming). Then `chat` plus Cloudflare's `agents/chat-sdk` state adapter is the route to evaluate, and #295's exclusion of in-chat Answer submission would need its own ADR.

## 2. Answers to the issue's questions

| Question | Answer | Basis |
| --- | --- | --- |
| Does `vercel/chat` run on Workers with Alchemy and Effect 4.1.x (`nodejs_compat`)? | Yes, mechanically. `wrangler deploy --dry-run` bundles Slack, Teams and both together, and local workerd serves and rejects bad signatures. It is promise-based, so every call is wrapped in `Effect.tryPromise`. No Alchemy-specific obstacle was found, but I did not deploy through Alchemy. | §2.1, *measured* |
| Workerd compatibility and footprint? | Slack full: 277 KiB gz. Teams full: 897 KiB gz, 1.8 s active startup in the one local profile that finished (two others timed out at 10 s). Both: 996 KiB gz. Stateless subpaths: 13 KiB gz. Worker size limit is 64 MiB, so **startup time, not size, is the limiter.** | §2.1, *measured* |
| Signature verification and stateless handling in `MainWorker`? | Slack: HMAC-SHA256 with Web Crypto, 5-minute skew, no state. Teams: Microsoft's JWT check, which the stateless subpath does **not** implement; we write it. | §3.2 |
| Does it need Redis or another external store? | The `Chat` constructor requires a `StateAdapter`; official ones are Redis, ioredis, Postgres, memory. Redis and Postgres are third-party stores and break SPEC §6. A DO SQLite `StateAdapter` exists but is Cloudflare's `agents/chat-sdk`, not part of `vercel/chat`. With thin adapters, **no `StateAdapter` is required.** | §3.3 |
| Card fidelity? | Slack Block Kit and Teams Adaptive Cards both carry what R3 needs: rating links, a Reminder, a Result summary, and later edits. Plain-link Invitations are possible on both. | §3.4 |
| Slack app and Teams bot registration and per-Organization OAuth install? | Slack: standard distributed app plus OAuth v2 install per workspace. Teams: Entra app plus Azure Bot plus Teams app package; per-tenant admin install; tenancy model unresolved. | §3.5, §3.6 |
| Teams proactive messages, and where does the conversation reference live? | Needs the bot installed in the Person's personal scope, plus tenant id, user id and service URL. Store the per-Person reference in the **Organization Durable Object**; D1 holds only the tenant-to-Organization routing row. | §3.6 |
| Safe Links and the fragment `#t=…&v=…`? | **Not tested.** Microsoft documents that Teams links are checked at click time and not rewritten, and says nothing about fragments. Treat as unverified and gating for Teams. | §3.7 |
| Slack plain links and `block_actions`? | Slack documents `block_actions` as the payload for Block Kit interactive components, and a URL button still sends one. Plain `<url\|text>` links in message text are not interactive components. **Slack does not state "plain links send nothing" in so many words;** the conclusion follows from its payload list and is a one-click live check. | §3.8 |

### 2.1 How the footprint was measured

In a scratch directory outside the repository I installed the four 4.45.0 packages (plus `@chat-adapter/state-memory`) and wrote five tiny Worker entries. Each used `compatibility_date = 2026-11-01` and `nodejs_compat`, wrangler 4.165.0, Node 26.

| Entry | `wrangler deploy --dry-run` | Local `wrangler check startup`, active CPU |
| --- | --- | --- |
| Stateless subpaths only (`slack/webhook`, `slack/api`, `slack/blocks`, `teams/api`, `teams/cards`, `teams/webhook`) | 56.5 KiB / **13.1 KiB gz** | 19 / 99 / 59 ms |
| `Chat` + Slack adapter + memory state | 1,324 KiB / **277 KiB gz** | 232 / 93 / 63 ms |
| `Chat` + Teams adapter + memory state | 4,839 KiB / **897 KiB gz** | 1,795 ms; the other two runs timed out at 10 s |
| `Chat` + Slack + Teams + memory state | 5,332 KiB / **996 KiB gz** | 952 / 449 / 700 ms |
| For scale: Effect HttpApi Worker (`docs/research/effect-on-workers.md`) | about 86 KiB gz | 54–61 ms |

Caveats that matter:

- Startup numbers are **local workerd on a shared, noisy machine**, so they are indicative only. Cloudflare warns that production CPUs differ, and `docs/research/effect-on-workers.md` makes the same point. The Worker startup limit is 1 s ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). A Teams adapter that sometimes needs more than a second locally is not a safe thing to load into `MainWorker`.
- The Worker size limit on both plans is 64 MiB (same page), so 1 MiB gzip is not a size problem. It is a startup-parse and review-surface problem.
- Behaviour check in local workerd: `bot.webhooks.slack` returned `401 Invalid signature` for a bad signature, and `bot.webhooks.teams` returned `401` for a missing `Authorization` header. That proves the modules load and the rejection path works. **It does not prove a valid inbound activity or an outbound send**, which need real Slack and Azure credentials.
- Why the Teams adapter is so heavy: its dependencies are `@microsoft/teams.apps` (needs Node ≥ 22.12; depends on `express`, `axios`, `jsonwebtoken`, `jwks-rsa`, `@azure/msal-node`, `@microsoft/signalr`, `reflect-metadata`) plus `teams.api`, `teams.cards`, `teams.graph` and `teams.graph-endpoints` ([npm metadata](https://www.npmjs.com/package/@microsoft/teams.apps)). Slack's full adapter pulls `@slack/web-api` and `@slack/socket-mode`.

## 3. Evidence

### 3.1 What `vercel/chat` is

- Chat SDK is a TypeScript bot framework: a `Chat` instance holds platform adapters and one state adapter; handlers such as `bot.onNewMention` and `onSubscribedMessage` run for events from every adapter, and each adapter exposes `bot.webhooks.<name>` ([Vercel docs](https://vercel.com/docs/chat-sdk/adapters)). Repository: [vercel/chat](https://github.com/vercel/chat), MIT.
- The state adapter "share[s] subscriptions, locks, and cached data across requests" (same page). Core `Chat` calls it on every inbound message: `setIfNotExists` for `dedupe:<adapter>:<messageId>` and `acquireLock` per thread (read in `chat@4.45.0` `dist/index.js`).
- Release cadence is fast: 4.38.0 on 2026-08-14 to 4.45.0 on 2026-11-13. The docs warn that protected members of official adapters "can change in minor releases, so pin the adapter version" ([Vercel docs](https://vercel.com/docs/chat-sdk/adapters)).
- The repo already pins Effect and Alchemy together because both are unstable or beta (ADR 0008). A third fast-moving dependency in the send path is a cost, not a saving, for a surface of about five calls per platform.

### 3.2 Webhook verification and stateless handling in `MainWorker`

**Slack.** Requests carry `x-slack-request-timestamp` and `x-slack-signature`; the adapter verifies `v0=` + HMAC-SHA256 over `v0:<timestamp>:<body>` with `crypto.subtle`, and rejects a timestamp more than 300 s off (`@chat-adapter/slack@4.45.0`, `dist/chunk-KYABMAGK.js`). This is stateless and about 40 lines in Effect with Web Crypto. Slack must receive an acknowledgement within 3 seconds for interaction payloads ([handling user interaction](https://docs.slack.dev/interactivity/handling-user-interaction/)); a slash command should ack immediately and post the answer through `response_url`, which accepts up to 5 posts within 30 minutes (same page). `MainWorker` must read the raw body once and verify before parsing.

**Teams.** Microsoft requires the bot to verify a JWT on every inbound request: `Authorization: Bearer`, issuer `https://api.botframework.com`, audience equal to the bot's app id, within validity (5-minute skew), RS256 signature from the keys at `https://login.botframework.com/v1/.well-known/keys`, and a `serviceUrl` claim equal to the activity's `serviceUrl`. The page calls requirements 4 and 6 (signature and serviceUrl) "particularly" important ([Bot Connector authentication](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication)). The stateless `@chat-adapter/teams/webhook` subpath **only parses** activities; it contains no JWT, JWKS or OpenID code (grep of the 4.45.0 `dist`). JWT verification lives in the heavy `@microsoft/teams.apps` path. So the thin route has to write this check either way. It needs `crypto.subtle` RS256 verify, a cached JWKS fetch, and the `serviceUrl` claim match. The single-tenant variant (tenant-specific issuer and metadata) was not confirmed from documentation; see §5.

**Useful guard to copy from the Teams adapter:** it refuses to send a bot token to any `serviceUrl` outside an allowlist (`smba.trafficmanager.net` and the GCC, DoD and China hosts) or a loopback emulator (`dist/chunk-4NNW2LU4.js`). `serviceUrl` arrives in the inbound activity, so an unchecked value is a token-exfiltration path.

**Where it runs.** Both verifications are request-local and stateless, so they can sit in `MainWorker` beside the Better Auth routes, with each route's classification added to `packages/api/src/PrivacyRegistry.ts`. The Submission Worker stays untouched; no Channel traffic may reach it (ADR 0005).

### 3.3 State storage

- `Chat` takes `state` in its config and uses it for dedupe and locks (§3.1). The official state adapters are Redis, ioredis, PostgreSQL and memory; the docs tell Vercel deployments to use Redis, ioredis or PostgreSQL, because memory "loses state on restart and two instances can process the same thread at once" ([Vercel docs](https://vercel.com/docs/chat-sdk/adapters)). **Redis and Postgres are third-party stores and break SPEC §6, so `vercel/chat` cannot be used with its official state adapters.**
- A Durable Object SQLite adapter does exist, but it is not part of `vercel/chat`. Cloudflare's `agents` package exports `createChatSdkState()` and a `ChatSdkStateAgent` sub-agent that store subscriptions, locks, queues, dedupe keys, thread state and history in Durable Object SQLite ([Cloudflare docs](https://developers.cloudflare.com/agents/agent-class/communication-channels/chat-sdk/); listed as vendor-official in [vercel/chat#669](https://github.com/vercel/chat/issues/669)). Costs for SurveyBeat:
  - it requires the `agents` package (version 0.33.0 today; peer dependencies include `ai`, `zod`, `chat`, `react` and `vite`), a parent `Agent` Durable Object class, and the `ChatSdkStateAgent` class exported from the Worker entry. SurveyBeat's classes come from Alchemy's generated entry (AGENTS.md notes the same constraint for #247), so this is untested friction;
  - state shards are keyed by platform thread or channel id (`slack:C123`), not by Organization, so chat state would live **outside** the per-Organization Durable Object that SPEC §6.2 makes the system of record;
  - `vercel/chat` itself does not consider the adapter part of its CLI scaffold (`CLI_INCOMPATIBLE_ADAPTERS` in #669), so it is a supported-but-unusual combination.
- **Answer to "is a DO SQLite `StateAdapter` required?" No, if we do not run `Chat`.** The state an outbound-first Channel needs is: workspace installation (bot token), Person-to-Channel binding, and per-send message ids. Each is Organization data and fits the Organization Durable Object (§4, constraint 4). Slack's inbound dedupe (`X-Slack-Retry-Num`) matters only for the slash command and can use a short-lived row in the same object.
- Even with the Slack adapter's own OAuth, installations are stored in the state adapter; `installationProvider` can bypass that for reads only, while writes still go to state ([adapter README](https://www.npmjs.com/package/@chat-adapter/slack)). So adopting the adapter's install flow also drags in state.

### 3.4 Card fidelity

**What the Invitation needs** (from #295): plain links only, link previews off, five rating links that open `answer.html#t=<token>&v=<1–5>`, an "Open check-in" link, a Reminder in the same shape, an edit that removes answer links once the member answers or the Round closes (#298), and a Result summary posted only after the Result is shared, with no comments, counts or Discussion guide.

| Need | Slack (Block Kit) | Teams (Adaptive Card) |
| --- | --- | --- |
| Plain link | mrkdwn `<url\|text>` in a `section` or `context` block ([formatting text](https://docs.slack.dev/messaging/formatting-message-text/)). `chat.postMessage` takes `unfurl_links` and `unfurl_media` ([method](https://docs.slack.dev/reference/methods/chat.postMessage/)). | `TextBlock` with `[text](url)`. The Chat SDK's own `link` element renders exactly this (`@chat-adapter/teams` `cards.js`). |
| Button-style link | `button` with `url`. **Still sends `block_actions`** (§3.8), so we do not use it. | `Action.OpenUrl`; Teams requires the target domain in the manifest's `validDomains`, otherwise it shows "URL may lead to untrusted content" ([card actions](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions)). The docs do not describe a bot callback for it (unlike `Action.Submit`/`Action.Execute`); confirm in the spike. |
| Reminder | Same blocks in a new message. | Same card in a new message. |
| Edit/remove links later | `chat.update` and `chat.delete` by `channel` + `ts`. | `PUT`/`DELETE v3/conversations/{id}/activities/{activityId}` (present in `@chat-adapter/teams/api`). |
| Result summary | `section` with `fields`, plain text. | `TextBlock`/`FactSet`; the Chat SDK maps tables to the Adaptive Card `Table`. |
| Slash command (SPEC §5.7) | Supported; needs a Request URL. | The Chat SDK's feature matrix says "Slash commands: No" for Teams ([adapter README](https://www.npmjs.com/package/@chat-adapter/teams)). Team health in Teams needs a bot command or message extension, designed separately. |

Fidelity is not what separates the options: the Chat SDK's card model compiles to the same Block Kit and Adaptive Card JSON we would write by hand, and its `link` element is already the plain-link form. Two limits to check in the spike, neither verified here: the maximum number of actions per Adaptive Card in Teams (five rating `Action.OpenUrl` buttons plus "Open check-in" may hit it, in which case use markdown links in a `TextBlock`), and Teams link-preview behaviour for URLs in plain text messages (a preview fetch carries no fragment, so it is harmless to the token, but it would show a title).

**Why plain links are a privacy requirement, not just a style choice.** A Slack button click sends `block_actions` to `MainWorker`, with the clicking Slack user id and a timestamp. That is a Person-bound, timed event for "opened the rating link on Round R" at the moment of answering, delivered to the Worker that has logs, while ADR 0005 keeps all of that off the Submission path. A plain link produces no event.

### 3.5 Slack app and per-Organization install

- Slack apps are installed by the v2 OAuth flow. The app redirects to `https://slack.com/oauth/v2/authorize?scope=…&client_id=…&redirect_uri=…&state=…`; Slack redirects back to an HTTPS `redirect_uri` with a code, which the server exchanges at `oauth.v2.access`. The docs say to check the `state` parameter. The response gives `access_token` (bot `xoxb-…`), `bot_user_id`, `team.id` and, for Enterprise Grid org-wide installs, `is_enterprise_install` with a null `team` ([installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth/), [oauth.v2.access](https://docs.slack.dev/reference/methods/oauth.v2.access)).
- Distribution: a new app can be installed only in its development workspace until an OAuth redirect URL is set and distribution is enabled ([Slack Java SDK guide](https://docs.slack.dev/tools/java-slack-sdk/guides/app-distribution)). Apps can be distributed "in either listed or unlisted fashion" ([distribution](https://docs.slack.dev/app-management/distribution)). **Unlisted distribution needs no Marketplace review**; I found nothing that makes listing mandatory, but I did not read the review policy. Install by a Lead may be blocked by the workspace's app-approval setting, which only the workspace can change.
- Bot scopes for R3: `chat:write` for posting (DM by passing the user id as `channel`, per the `chat.postMessage` docs); `users:read.email` for `users.lookupByEmail` (Tier 3, 50+ per minute) to map a Person's email to a Slack user id ([method](https://docs.slack.dev/reference/methods/users.lookupByEmail/)); `commands` for the slash command. Whether DM-by-user-id also needs `im:write` was not confirmed.
- **Privacy note for the ADR:** `users:read.email` means SurveyBeat sends each Person's email address to Slack to find them. That is a new data flow to a third party and must be stated plainly to members (#295 notes). Look-ups should run once at binding time, not per send.
- Rate limit: about 1 message per second per channel, and "several hundred messages per minute" per workspace (`chat.postMessage` docs). Invitation fan-out for a large Team must go through the existing Queue with per-workspace pacing and retries.
- Per-Organization shape: the "Add to Slack" button is a `MainWorker` route that carries a signed `state` binding the install to the Lead's Organization; the callback stores the token in the Organization Durable Object and writes `slack:<team_id> → organizationId` to D1. One Slack workspace maps to one Organization (D1 key unique), because an inbound slash command carries only `team_id`.
- Slack's manifest has an opt-in `token_management_enabled` setting; with token rotation the `oauth.v2.access` example shows bot tokens that expire (`expires_in: 43200`, a 12-hour lifetime) and come with a `refresh_token`. The ADR should pick off for the first release unless the refresh path is built.

### 3.6 Teams registration, proactive messages, and the tenancy risk

**Registration pieces.** An Entra ID app registration, an Azure Bot resource whose messaging endpoint is a `MainWorker` route, the Teams channel enabled on the bot, and a Teams app package (manifest plus icons) that lists the bot, the personal scope and `validDomains`. Microsoft's Teams CLI can create the app, secret, bot registration and install link in one step (adapter README).

**Tenancy: the open problem.**

- Microsoft's registration page says multi-tenant bot creation "will be deprecated after July 31, 2025": existing multi-tenant bots keep working but new ones cannot be created; use single-tenant or user-assigned managed identity ([Register a bot](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-quickstart-registration)). The adapter's own default is `appType: "MultiTenant"`, which is a deprecated mode for a newly created bot.
- SurveyBeat must send to Persons in **many customers' tenants** from one bot. A Microsoft Q&A thread *(secondary)* from an ISV with about 100 tenants says the documented single-tenant model "does not provide the cross-tenant outbound capability" their SaaS needs; the answers (a Microsoft external-staff moderator and an MVP) point to a single-tenant bot distributed as a Teams app that other tenants install, user-assigned managed identity, or the newer Microsoft 365 Agents route, without stating that single-tenant outbound to other tenants works ([Q&A](https://learn.microsoft.com/en-us/answers/questions/5896006/request-for-exception-to-provision-new-multi-tenan)). Another thread *(secondary)* says publishing through AppSource is "strongly recommended" for external tenants with a single-tenant bot ([Q&A](https://learn.microsoft.com/en-us/answers/questions/5882874/clarification-on-multi-tenant-support-for-single-t)).
- **I found no Microsoft document that settles whether one single-tenant bot can mint a token and send proactive messages into customer tenants.** This must be resolved by a spike with two real tenants before the ADR commits to Teams; the fallbacks (a bot registration per customer tenant, or only Teams-installed-by-the-tenant scenarios) change the cost and the install story materially.

**Proactive messages.**

- The bot must be installed for the user in the personal scope; otherwise the create-conversation call fails with 403 `ForbiddenOperationException` ([proactive messages](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages)). The page offers two ways to install: proactively through Microsoft Graph, or a custom app policy that installs the app for the organization's users.
- To create the conversation the bot needs `tenantId`, the user's `aadObjectId` or `userId`, and the `serviceUrl`; after creation it posts to the returned `conversationId`. `userId` is unique per bot and user and cannot be reused between bots; `channelId` is global (same page).
- The page says to store the `tenantId` and either the `userId` or `channelId`. The adapter's stored shape is `{ conversationId, serviceUrl, tenantId, teamId?, channelId? }` (`extractTeamsContinuation`).
- For each Invitation the thin sender therefore needs a **conversation reference**: `tenantId`, `userId` (and `aadObjectId`), `serviceUrl`, `conversationId`, and per send an `activityId` for later edits.

**Where the reference lives.**

- **Organization Durable Object**, in a `channel_binding` table keyed by Person: `channel`, the platform ids above, and the Slack/Teams message ids of each send. Reasons: it identifies a Person, so it belongs with the Person rows (`people`, email) that already live there; deleting a Person then deletes their bindings in one place; the send path already runs through the Organization object (`SendStore`); and it keeps D1 small.
- **D1** holds only the routing key SPEC §6.2 already names, "Slack and Teams workspace to organization": `teams:<tenantId>` and `slack:<teamId>` → `organizationId`, needed because an inbound webhook knows its tenant before it knows the Organization. No Person, conversation id or message content goes to D1.
- If Teams `serviceUrl` can differ per conversation (the Connector's regional hosts), it must be stored per binding, not per tenant.

### 3.7 Teams Safe Links and the URL fragment

**I could not run this test, and I make no claim about a result.** It needs a Microsoft 365 tenant with a Defender for Office 365 licence, a registered Teams bot, and Teams desktop, web and mobile clients. None is available here.

What Microsoft documents ([Safe Links overview](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about), updated 2026-10):

- Safe Links covers "links in Teams conversations, group chats, or from channels", in Teams desktop, web and mobile.
- For Teams, "URLs in Teams are checked against a list of known malicious links when the protected user clicks the link (time-of-click protection). **URLs aren't rewritten.**" This differs from email, where URLs are rewritten to `*.safelinks.protection.outlook.com` (the existing note `docs/research/email-link-scanners.md`).
- The Built-in protection preset applies Safe Links protection in Teams to every recipient in a tenant with at least one Defender for Office 365 licence.
- "The intermediary page that does Safe Links validation redirects to the target page", which the page mentions when explaining why `SameSite=Strict` cookies may fail after opening a link from Teams.

What it does not say: whether the validation request includes the fragment, whether the intermediary redirect keeps it, or whether links inside a bot's Adaptive Card are treated like links in a typed message. A browser inherits the original fragment across an HTTP 3xx redirect when the `Location` header carries none (RFC 9110 §10.2.2), but the page does not say the intermediary uses a 3xx rather than a script redirect.

Two separate risks follow:

1. **The fragment is lost.** `#t=…` and `&v=…` share one fragment, so the likely failure is that both are lost, not just `&v=`. The issue's fallback ("Open check-in only") still needs the token. If the fragment does not survive, the Teams Invitation has no anonymous-safe handoff to `answer.html`. The Channel ADR must treat that as **blocking for Teams**, not as a degraded mode.
2. **The fragment reaches Microsoft.** If the click-time check sends the full URL to Microsoft's service, the Invitation token (ADR 0005 keeps it in the fragment so that no scanner or log ever sees it) is exposed to a third party. Email already has the same unknown; this note adds no evidence either way.

Test plan for the spike: in a Defender-licensed test tenant with Teams protection on, post a bot Adaptive Card whose link is `https://<preview-stage>/a#t=TEST&v=3`; click it from desktop, web and mobile; read `location.hash` on the answer page (it can log nothing but its own hash to the console for the test); repeat with the protection setting off as a control; and repeat with the link in a `TextBlock` and in `Action.OpenUrl`. Expected cost: half a day plus a tenant.

### 3.8 Slack: plain links and `block_actions`

- The Slack interaction docs list `block_actions` as the payload for a "Block Kit interactive component", alongside shortcuts, `view_submission` and `view_closed` ([handling user interaction](https://docs.slack.dev/interactivity/handling-user-interaction/)).
- A button that has a `url` is still an interactive component: "If you're using url, you'll still receive an interaction payload and will need to send an acknowledgement response" ([button element](https://docs.slack.dev/reference/block-kit/block-elements/button-element/)). **So link buttons do send `block_actions` to our Request URL; plain links do not need to be buttons.** The Chat SDK's `link-button` renders as a `button` with `url` and an `action_id` (`@chat-adapter/slack` `blocks.js`), so it would trigger this; its plain `link` element renders as a `section` with `<url|label>` and does not.
- The Events API `link_shared` event is sent "when a link — matching the registered URL domain your app is setup to track — is posted", not when it is clicked; it also requires a subscription and a registered domain, and apps do not receive it for their own messages ([link_shared](https://docs.slack.dev/reference/events/link_shared/)). SurveyBeat should register no unfurl domain and subscribe to no `link_shared`.
- **What is not stated.** Slack does not publish a sentence of the form "clicking a plain link sends nothing to the app". The conclusion rests on the payload list above. Unfurling is a separate matter: with `unfurl_links` left on, Slack's servers may fetch the URL (they send no fragment); set `unfurl_links` and `unfurl_media` to false as #295 requires. A live check costs a few minutes: post a message with five plain links to a dev workspace, subscribe the Request URL to a request log, click each, and confirm zero requests.

## 4. Constraints the Channel ADR must keep

1. **Port, not product.** `ChannelSender` stays in `packages/domain` with no Slack, Teams or Cloudflare imports; Slack and Teams senders live in `packages/cloudflare` (boundary rules, ADR 0008). The domain port speaks Invitation, Reminder and Result summary, not "message" or "thread".
2. **No third-party store, no `Chat` runtime in `MainWorker`.** If a later ADR adopts `chat`, it must also name the `StateAdapter` and show it is Cloudflare-only (the Cloudflare `agents` adapter, or one we write over the Organization Durable Object).
3. **Plain links only, previews off.** No Block Kit buttons (including `url` buttons) and no Adaptive Card `Action.Submit`/`Action.Execute`. Slack: `unfurl_links:false`, `unfurl_media:false`, no `link_shared` subscription. Teams: `Action.OpenUrl` or markdown links only. This keeps every chat click out of `MainWorker`, so no Channel click event carries a Person and a time (ADR 0005, ADR 0007).
4. **Where state lives.** The per-Person binding (Slack user id; Teams `tenantId`, `userId`, `serviceUrl`, `conversationId`), the workspace token (encrypted with a Worker secret, like `INVITATION_TOKEN_KEY`), and the sent-message ids for later edits live in the Organization Durable Object. D1 holds only `slack:<teamId>` and `teams:<tenantId>` → `organizationId`. Deleting a Person deletes their bindings. No survey content, Answer or Result in D1.
5. **Zero-Leakage Handoff stays.** Chat Channels deliver Invitations, Reminders and shared Result summaries only. Answers still confirm on `answer.html` through the Submission Worker. Nothing in the Channel path may carry both an Invitation token and an Edit key, and no Channel route is served by the Submission Worker.
6. **The token stays in the fragment, and Teams is gated on proof.** Link shape is unchanged: `…/a#t=<token>[&v=<1–5>]`. Teams ships only after the Safe Links spike (§3.7) shows the fragment survives and is not sent to Microsoft; otherwise the ADR must pick another handoff. ADR 0007's rule that the link only preselects and the answer saves on confirm applies unchanged.
7. **Verify before parse, on every inbound route.** Slack: HMAC-SHA256, 300 s skew, raw body. Teams: the Bot Framework JWT checks in §3.2, including the `serviceUrl` claim, and an allowlist of Connector hosts before any outbound call. Each route is classified in `PrivacyRegistry.ts`.
8. **Idempotent, queued sends.** Sends go through the existing Queue and `SendStore` pattern: one send id per Person and Round, retry-safe, with per-workspace pacing for Slack's rate limit and a visible failure state when a Person has no binding (not a silent fall back to a different Channel that the Person did not pick).
9. **Member-visible disclosure.** The ADR should require plain wording that sending an Invitation through Slack or Teams is a third-party data flow, and that Slack lookup uses the Person's email (`users:read.email`).
10. **Slack before Teams, Teams behind two spikes:** the tenancy spike (§3.6) and the Safe Links spike (§3.7). Slash command design for Teams (bot command or message extension) is a separate item.
11. **Edits remove links.** Both platforms support editing a sent message by stored id, which #298 relies on; the binding must therefore keep the Slack `channel` + `ts` and the Teams `conversationId` + `activityId` for each send.
12. **One workspace, one Organization.** Reject installing a Slack workspace or Teams tenant that is already bound to another Organization.

## 5. What I could not verify

- **Teams Safe Links and the fragment.** No tenant, no Defender licence. Only the documentation in §3.7 was read.
- **Teams tenancy.** Whether one single-tenant Azure Bot can send proactive messages into other customers' tenants. Microsoft documentation does not answer it; the evidence is two Q&A threads *(secondary)*.
- **Valid-path behaviour of any adapter.** No Slack workspace or Azure Bot was available. I verified bundling, loading and the 401 rejection paths in local workerd, not a verified inbound event or an outbound `postMessage`/`createConversation`.
- **Alchemy deployment.** I used `wrangler` for bundling and local workerd. I did not deploy any of these through Alchemy or run them inside the repository's `MainWorker`.
- **Production startup CPU.** Startup numbers are local, on a shared machine, and varied by up to 4× between runs. Re-measure on a deployed preview stage if the Channel ADR leans on them.
- **Slack:** the exact scope set for opening a DM (`im:write` versus `chat:write` alone); the Marketplace review policy for listing; behaviour of `users.lookupByEmail` for guests and Slack Connect users; and the live "no event on plain link click" check (§3.8).
- **Teams:** the per-card action limit; whether `Action.OpenUrl` triggers any bot activity; the Graph permission names needed to install the app proactively for a Person; and the single-tenant variants of the inbound JWT issuer and metadata.
- **`@chat-adapter/*` as a reference.** I read the 4.45.0 `dist` bundles, not the TypeScript source or tests in the repository.

## 6. Sources

- Chat SDK adapters and state adapters: <https://vercel.com/docs/chat-sdk/adapters>; repository <https://github.com/vercel/chat>; Cloudflare state adapter listing <https://github.com/vercel/chat/issues/669>.
- Cloudflare Agents `agents/chat-sdk`: <https://developers.cloudflare.com/agents/agent-class/communication-channels/chat-sdk/>. Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>.
- npm packages (4.45.0): `chat`, `@chat-adapter/slack`, `@chat-adapter/teams`, `@chat-adapter/shared`, `@chat-adapter/state-memory`, `@microsoft/teams.apps` 2.2.1, `agents` 0.33.0.
- Slack: <https://docs.slack.dev/interactivity/handling-user-interaction/>, <https://docs.slack.dev/reference/block-kit/block-elements/button-element/>, <https://docs.slack.dev/reference/events/link_shared/>, <https://docs.slack.dev/messaging/formatting-message-text/>, <https://docs.slack.dev/authentication/installing-with-oauth/>, <https://docs.slack.dev/reference/methods/oauth.v2.access>, <https://docs.slack.dev/app-management/distribution>, <https://docs.slack.dev/reference/methods/chat.postMessage/>, <https://docs.slack.dev/reference/methods/users.lookupByEmail/>.
- Microsoft: <https://learn.microsoft.com/en-us/defender-office-365/safe-links-about>, <https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages>, <https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions>, <https://learn.microsoft.com/en-us/azure/bot-service/bot-service-quickstart-registration>, <https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication>. Secondary: Microsoft Q&A threads 5896006 and 5882874.
- In this repository: `SPEC.md` §5.7 and §6, ADR 0005, 0007 and 0008, `docs/research/email-link-scanners.md`, `docs/research/effect-on-workers.md`, and the email path (`packages/domain/src/email/`, `packages/cloudflare/src/EmailDelivery.ts`, `packages/emails/src/Parts.tsx`).
