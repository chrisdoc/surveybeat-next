# What Cloudflare logs about a Worker request by default

Research for issue #10 (map #1). Throwaway branch, not for merging. Researched 2026-11-07 against developers.cloudflare.com and cloudflare.com.

**Why it matters.** SPEC §5.3 says request logs for the Submission endpoint must not contain the Invitation token, the Person, or the IP address together with the Submission. SPEC §6.4 sends errors and traces to Workers Logs and Workers Observability. SPEC §7 makes "logs from the submission path contain no identifiers" a release-blocking test. (The ticket also names GLOSSARY.md, but that file does not exist on `origin/main` yet.)

## TL;DR

1. **The default is on.** New Workers have `observability.enabled = true`, and `head_sampling_rate` defaults to 1. Every request gets an *invocation log*, labelled `Fetch <METHOD> <URL>`, with the full URL including the query string. The log also holds request and response metadata that Cloudflare does not fully document. Paid plans keep these logs for 7 days, the Free plan for 3.
2. **Traces are opt-in** (`observability.traces.enabled`). Once on, the inbound span records `url.full`, the full user agent, `cloudflare.ray_id`, ASN, and geo down to city. D1 and Durable Object SQL spans record `db.query.text`. The docs list no client IP attribute on spans.
3. **Tail Workers, `wrangler tail` and Logpush trace events carry `event.request.url` and `headers`.** Cloudflare's docs describe redaction only for the `tail()` handler. There it covers a fixed list of header names and ID-shaped substrings of the URL. `cf-connecting-ip` and `x-forwarded-for` are **not** on that list, and `getUnredacted()` bypasses all of it.
4. **The edge always writes an HTTP request log line**, with `ClientIP`, `ClientRequestURI` (path plus query) and `RayID`. A customer cannot stop the edge from writing it. A customer can only choose not to retain it (Logpull, off by default, 3 to 7 days) or not to push it (Logpush). Cloudflare publishes no fixed retention period for its own internal copy.
5. **Analytics Engine records only what `writeDataPoint` writes**, and keeps it 3 months. AI Gateway logs prompts and responses **by default**. Turnstile processes the client IP, TLS fingerprint and user agent.
6. **Design consequence.** Never put the Invitation token in the Submission URL. Send it in the POST body, or better, exchange it in an earlier request for a short-lived, unlinkable submission credential. Serve the Submission endpoint from its own Worker with `invocation_logs = false`, traces off, no `tail_consumers` and `logpush = false`. Sampling is per Worker or per environment, not per route. Test the result empirically, because Cloudflare does not publish the full field list of an invocation log.

## 1. Workers Logs (persisted logs)

Source: <https://developers.cloudflare.com/workers/observability/logs/workers-logs/>

- **Default on.** "Newly created Workers have it on by default." The `observability.enabled` key is shorthand for `logs.enabled`, "defaults to `true` for all new Workers", and makes the logs persist ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)).
- **Invocation log.** "Each Workers invocation returns a single invocation log that contains details such as the Request, Response, and related metadata". These logs are identified by `$cloudflare.$metadata.type = "cf-worker-event"`. Each one is "enriched with information available to Cloudflare in the context of the invocation". A fetch invocation is shown as `Fetch <Method> <URL>`, so **the URL, query string included, is in the log**.
- **Request ID and Ray ID.** The Observability API schema defines `rayId` as the "Cloudflare Ray ID from the cf-ray header of the request that triggered the invocation", and `requestId` as the ID "that ties all logs from a single invocation together" ([API reference](https://developers.cloudflare.com/api/resources/workers/subresources/observability/)). Each event also carries timestamps and duration (`$metadata.endTime` and `duration`), plus the account and service.
- **Not documented.** Cloudflare does not publish the complete field list of an invocation log. In particular, it does not say whether request headers or the `cf` object are stored, or whether redaction applies. Treat both as **unknown until verified** (see section 9).
- **Custom logs.** Every `console.log` line is stored and linked to the invocation by `requestId` and `rayId`. So any value logged on the Submission path ends up in the same log group as the URL and the Ray ID.
- **Turning it off or down:**
  ```toml
  [observability]
  enabled = true          # false = do not persist logs for this Worker
  head_sampling_rate = 1  # 0..1, per Worker, default 1

  [observability.logs]
  invocation_logs = false # keep console.log output, drop the automatic invocation log
  ```
  Per-environment overrides go under `[env.<name>.observability]`, and `observability` is an inheritable key. **There is no per-route setting.** Sampling is head-based per request: "When a request is sampled, all logs for that request are kept." Above the daily limit, Cloudflare applies a 1% head sample for the rest of the day.
- **Retention.** 3 days on Free, 7 days on Paid ("the stated maximum"). The maximum log size is 256 KB, and larger logs are truncated with `$cloudflare.truncated = true`.

## 2. Workers Observability: traces

Sources: <https://developers.cloudflare.com/workers/observability/traces/>, <https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/>

- **Opt-in.** Turn traces on with `[observability.traces] enabled = true`. The docs say that `observability.enabled = true` "currently enables logs only, not traces". `head_sampling_rate` takes 0 to 1 and defaults to 1 once traces are on. Logs and traces can use different sampling rates. Traces are kept for 7 days.
- **Inbound fetch handler span:** `http.request.method`, `url.full`, `url.path`, `network.protocol.name`, `http.request.header.accept`, `accept-encoding`, `accept-language`, `user_agent.original` plus parsed browser, OS and device fields, `cloudflare.asn`, `cloudflare.verified_bot_category`, `geo.timezone`, `geo.continent.code`, `geo.country.code`, `geo.locality.name`, `geo.locality.region`. The root span also gets `cloudflare.ray_id`, and all spans get `cloudflare.colo`.
- **No IP attribute is listed** on any span.
- **Outbound fetch spans** record `url.full`, `url.query`, `server.address`, a few content headers, and the body sizes.
- **Binding spans.** D1 and Durable Object SQL spans record **`db.query.text`**. If the SQL is parameterized, the text holds `?` placeholders, but string-interpolated values would end up in the trace. KV spans record the keys (`cloudflare.kv.query.keys`). A token used as a KV or D1 lookup key would therefore show up in the trace of the lookup request. Durable Object spans record `cloudflare.durable_object.id`.
- **Privacy reading.** Even without an IP, the combination of `url.full`, the full user agent, ASN, city, Ray ID and timestamp is close to identifying for a small team. In the Submission Worker, turn traces off.

## 3. Real-time logs (`wrangler tail`, dashboard Live view)

Source: <https://developers.cloudflare.com/workers/observability/logs/real-time-logs/>

- Real-time logs exist only while someone is tailing: "Real-time logs does not store Workers Logs." Each event is JSON with `outcome`, `scriptName`, `exceptions`, `logs`, `eventTimestamp`, and `event.request.{url, method, headers, cf}`.
- Anyone with access to the account can tail any Worker at any time, so this is an access-control concern rather than a retention one. The page does not say whether `wrangler tail` applies the redaction from section 4.

## 4. Tail Workers

Sources: <https://developers.cloudflare.com/workers/observability/logs/tail-workers/>, <https://developers.cloudflare.com/workers/runtime-apis/handlers/tail/>

- **Opt-in** per producer, through `tail_consumers`. That key is not inheritable, so each environment declares its own.
- A Tail Worker receives the same shape of event: request `url`, `method`, `headers` and `cf` (`IncomingRequestCfProperties`), plus logs, exceptions and diagnostics-channel events.
- **Default redaction**, as documented for the `tail()` handler's `TailRequest`:
  - **Headers.** A header's value becomes `"REDACTED"` when its name is `cookie` or `set-cookie`, or contains `auth`, `key`, `secret`, `token` or `jwt`, matched case-insensitively. **`cf-connecting-ip`, `x-forwarded-for` and `x-real-ip` do not match**, so the client IP passes through in the headers.
  - **URL.** Each greedily matched run of `[A-Za-z0-9+\-_]` is replaced when it is a hex ID (32 or more hex digits) or a base-64 ID (21 or more characters with at least 2 uppercase letters, 2 lowercase letters and 2 digits). A token shorter than that, or one without the right mix of characters (for example lowercase base32), is **not** redacted.
  - `getUnredacted()` returns the raw values. Redaction is a convenience, not a guarantee.

## 5. Logpush

Sources: <https://developers.cloudflare.com/logs/logpush/>, <https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/workers_trace_events/>, <https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/http_requests/>, <https://developers.cloudflare.com/logs/faq/worker-subrequests/>

- **Workers Trace Events** (account dataset). Pushing this dataset needs Workers Paid, a Logpush job, and **`logpush = true` in the Worker's config, which defaults to `false`**. The fields are `Event`, `EventTimestampMs`, `EventType`, `Logs`, `Exceptions`, `Outcome`, `ScriptName`, `ScriptTags`, `ScriptVersion`, `Entrypoint`, `DispatchNamespace`, `CPUTimeMs` and `WallTimeMs`. The docs do not specify what is inside `Event`. Assume it holds the same request shape as a tail event (URL, method, response status, possibly headers) until verified.
- **HTTP requests** (zone dataset). The Logpush overview says Logpush is now available on all plans, but which datasets you get depends on your products. The fields include **`ClientIP`**, **`ClientRequestURI`** ("includes the full path and query string"), `ClientRequestPath` (without the query string), `ClientRequestHost`, `ClientRequestUserAgent`, `ClientRequestReferer`, `RayID`, `ParentRayID`, `EdgeStartTimestamp`, `WorkerScriptName` and `WorkerSubrequest`. `RequestHeaders` and `Cookies` are populated only when custom fields are configured.
- **Both datasets are opt-in exports.** But the HTTP request record behind them exists either way (section 7). If you configure an HTTP requests job, either leave out `ClientIP` and `ClientRequestURI`, or filter out the Submission host.

## 6. AI Gateway and Analytics Engine

- **AI Gateway** (<https://developers.cloudflare.com/ai-gateway/observability/logging/>). "Logs are enabled by default for each gateway". A log holds "the prompt, response, provider, timestamp, status, token usage, cost, duration, and user agent". You can turn logging off per gateway in Settings, or per request with `cf-aig-collect-log: false`. The header `cf-aig-collect-log-payload: false` keeps the metadata but drops the prompt and response bodies. Gateways created on or after 2026-09-24 follow the Workers Logs retention rules. This matters for comment redaction (§5.3, §6.1): **turn payload logging off on the gateway used for raw comments**, through Alchemy if it supports that, and send the header on every call as a second layer of protection.
- **Workers Analytics Engine** (<https://developers.cloudflare.com/analytics/analytics-engine/>, [limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/), [sampling](https://developers.cloudflare.com/analytics/analytics-engine/sampling/)). It is a write API: nothing is captured automatically. The docs describe no implicit IP or URL capture. Data is kept for **3 months**, and is sampled at write time and query time (`_sample_interval`). The only risk is what we write ourselves: never write a Person ID, a token or a Submission ID, and keep its index coarser than one team below N.

## 7. What Cloudflare keeps that a customer cannot turn off

- **The edge HTTP request log.** Every proxied request produces a log line in Cloudflare's log pipeline, with default fields including "client IP, request host and method, URI, edge timestamps, response bytes and status, and a Ray ID" ([Logpull basics](https://developers.cloudflare.com/logs/logpull/understanding-the-basics/)). A customer controls two things:
  - **Logpull retention**: "By default, your HTTP request logs are not retained." When it is turned on, logs can be queried "at least 3 days and up to 7 days" back. You turn it off with `POST /logs/control/retention/flag {"flag": false}`, and existing logs remain until they expire ([enabling log retention](https://developers.cloudflare.com/logs/logpull/enabling-log-retention/)).
  - **Logpush** exports.
- **Cloudflare's own processing.** The [privacy policy](https://www.cloudflare.com/privacypolicy/) says that for End Users, Cloudflare "processes data on behalf of its Customers", including "IP addresses, traffic routing data". Personal data is stored "for a period of time that is consistent with the business purposes", with **no fixed number** for edge logs. Separately, "Network Data" is used to identify and block malicious activity. The often-quoted "25 hours" applies only to the 1.1.1.1 resolver, not to Workers or zones. The [GDPR FAQ](https://www.cloudflare.com/trust-hub/gdpr/) says log metadata contains limited personal data, "most often in the form of IP addresses".
- **What follows for us.** We cannot prevent Cloudflare from seeing IP plus URL plus time for the Submission request. That is inherent to using a reverse proxy, and Cloudflare is our processor under the DPA. What we control is (a) **what the URL contains**, (b) **which logs we persist or export**, and (c) **whether the Submission request carries anything that links it to a Person**. The privacy page should say plainly that Cloudflare processes IP addresses as our processor for transport and security.

## 8. Turnstile

Sources: [Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/), <https://developers.cloudflare.com/turnstile/>, [server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

- **Signals processed**: "client IP address, TLS Fingerprint, User-Agent Header and Sitekey and associated origin."
- **Cloudflare's role.** It is a **processor** when it protects our site, and a **controller** when it uses the signals to improve bot detection, under legitimate interest.
- **Retention.** The addendum gives no retention period.
- **What it does not read.** "Turnstile does not access, store, or transmit user communications, form entries, or other page inputs."
- **`siteverify`.** The parameters are `secret`, `response`, an optional `remoteip` and an optional `idempotency_key`. The response holds `hostname`, `challenge_ts`, `action`, `cdata` and `metadata.ephemeral_id` (Enterprise only), and contains no IP. Tokens are single-use and valid for 300 seconds.
- **For us:**
  - **Do not send `remoteip`.**
  - **Do not put anything that identifies a Person or Invitation in `cdata` or `action`.**
  - Turnstile protects only the public-link answer page (§6.2). It is not needed on the invitation path.

## 9. Recommendations for SurveyBeat

1. **Token out of the URL.** Email links can carry the token to the answer page, but that page load is a separate request from the Submission request. Better still, the answer page swaps the token (via `POST` body) for a short-lived, single-use submission credential that is not linked to the Person in any stored form. The Submission request then carries only that credential and the answers, in the body. The URL of the Submission request becomes a constant such as `POST /s`. This is the "separate requests" option in §5.3.
2. **A separate Submission Worker is the cleaner boundary.** All of these settings work per Worker or per environment, never per route: `observability.enabled`, `logs.invocation_logs`, `head_sampling_rate`, `traces.enabled`, `tail_consumers` and `logpush`. A dedicated Worker on its own route or host lets us set, in Alchemy:
   - `observability.logs.invocation_logs = false`
   - traces off
   - no `tail_consumers`
   - `logpush = false`
   - custom logging limited to an allowlisted structured logger, with no request object, no headers and no IP.

   This fits §6.1's rule to "add more Workers only when a job needs a different runtime profile". The main Worker can keep full observability. If we keep one Worker, the only lever is to turn invocation logs off for **everything**.
3. **IP never paired with a Submission in our own code.** Never read `cf-connecting-ip` on the Submission path. Do not pass it to Turnstile's `remoteip`. Do not write it to Analytics Engine.
4. **SQL and KV hygiene.** Use parameterized statements only, so that `db.query.text` holds placeholders. Never use a token as a KV key on a traced path. Hash it, or keep traces off.
5. **Edge log exports.** If Logpush for HTTP requests is ever configured, leave out `ClientIP` and `ClientRequestURI` for the Submission host, or filter that host out. Keep Logpull retention off, which is the default, and assert this in infrastructure code.
6. **AI Gateway.** Turn payload logging off on the redaction gateway, and send `cf-aig-collect-log-payload: false` with each call.
7. **Privacy test (§7), two layers:**
   - **Unit layer.** Make the Submission handler's logger an Effect service. Feed in a request carrying a token, a Person-like value and an IP. Assert that nothing captured contains them.
   - **Preview-stage layer.** Deploy, send one Submission, then query the Observability API (`/workers/observability/telemetry/query`) for that `rayId` or `scriptName`. Assert that there are no invocation logs and that no stored event contains the token, the IP or the Person ID.

   The preview-stage check also covers the gap in section 1: Cloudflare does not document whether invocation logs store headers. **This test is the authority, not this document.**

## Open points and caveats

- Invocation logs: the full field list (headers? `cf`? redaction?) is undocumented. Settle it with the probe in recommendation 7 before implementation.
- Whether `wrangler tail` and Workers Logs apply the `TailRequest` redaction is undocumented.
- The Logpush overview says Logpush is available on all plans. Older docs limited zone HTTP requests to Enterprise. Check this for our plan if it matters.
- Cloudflare publishes no internal retention period for edge logs, and the Turnstile addendum gives none for its signals. If a fixed number is needed for the privacy page, it has to come from Cloudflare's DPA or support, not from the public docs.
