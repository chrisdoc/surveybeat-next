# OpenRouter with `meta/muse-ember` for comment processing

Research for issue #87 (map #85). Researched 2026-11-10 against openrouter.ai (docs, live APIs, model page, terms, DPA), Meta's Model API terms as linked from OpenRouter, and developers.cloudflare.com. No OpenRouter account or API key was used, so nothing below was confirmed by a real request.

**Why it matters.** The product owner chose OpenRouter with `meta/muse-ember` for the Release 2 AI pass over comments, replacing SPEC §10 question 4's default (Workers AI through AI Gateway, prompt logging off). ADR 0009 says raw comment text is never sent to a model, so only the already-redacted text can be sent. SPEC §7 makes the privacy rules release blockers. The ADR that follows this note has to record the provider, the request settings that enforce no retention, what is sent, and what members are told.

## TL;DR

1. **No zero data retention is possible.** `meta/muse-ember` has exactly one endpoint, served by Meta itself. OpenRouter lists it as `retainsPrompts: true`, `retentionDays: 30`, `training: false`, `is_zdr: false`. It is not in `/api/v1/endpoints/zdr`. With `provider.zdr: true`, or with ZDR enforced on the account or a guardrail, the model has no eligible endpoint and the request fails. No request body can make this model retention-free.
2. **US, not EU.** The model page says "Not currently available through EU in-region routing". The model is missing from both the EU and the US regional model lists. Meta's headquarters is listed as US. OpenRouter publishes no data centre location for Meta (`datacenters: null`, `provider_region: null`).
3. **JSON schema: yes.** The endpoint lists `response_format` and `structured_outputs`. Use `response_format: { type: "json_schema", json_schema: { strict: true, ... } }` on Chat Completions.
4. **Context length is 1,048,576 tokens.** The maximum completion is 943,718 tokens. Reasoning is mandatory (`effort: "none"` is rejected), and the default effort is `max`.
5. **Cost per Round: about $0.001 to $0.003.** Input costs $0.10 per million tokens and output $0.50 per million. One theming call over 20 comments of 300 characters is about 2,500 input and 1,500 to 4,500 output tokens, most of it reasoning. Reasoning tokens are billed as output, so set `reasoning.effort` low and cap `max_tokens`.
6. **A DPA exists and is part of OpenRouter's terms.** It includes Module 2 SCCs and an optional EU-only addendum (Exhibit A). The DPA does not stop Meta keeping prompts: OpenRouter's ZDR promise covers OpenRouter itself, and the provider's own terms govern the provider.
7. **Meta's terms leave a training gap.** Meta's terms split models into "Standard" models (no training) and "Contributor" models (Meta trains on content). Muse Ember was added to OpenRouter on 2026-11-09 and is not on Meta's designation list, which was last updated 2026-10-12. OpenRouter says `training: false`. Meta's own page is silent.
8. **Calling it from a Worker or Durable Object is simple.** Use `fetch` to `https://openrouter.ai/api/v1/chat/completions` with the key from a Worker secret, an `AbortSignal.timeout`, and retries on 408/429/502/503 that honour `Retry-After`. Waiting on `fetch` does not count as CPU time.

## 1. The model and its single endpoint

Sources: <https://openrouter.ai/api/v1/models/meta/muse-ember/endpoints>, the `meta/muse-ember` entry in <https://openrouter.ai/api/v1/models>, and the data embedded in <https://openrouter.ai/meta/muse-ember>. All three were read on 2026-11-10.

| Field | Value |
| - | - |
| Canonical slug | `meta/muse-ember-20261109` (created 2026-11-09) |
| Endpoints | **One**: "Meta \| meta/muse-ember-20261109", provider slug `meta`, upstream `https://api.meta.ai/v1` |
| Context length | 1,048,576 tokens. `max_completion_tokens` 943,718 |
| Input modalities | text, image, video, file, audio. Output: text |
| Pricing | prompt $0.0000001/token ($0.10/M), completion $0.0000005/token ($0.50/M), cache read $0.004/M, cache write $0.125/M, web search $0.0025 |
| Supported parameters | `reasoning`, `include_reasoning`, `reasoning_effort`, `max_tokens`, `temperature`, `top_p`, `top_k`, `repetition_penalty`, `tools`, `tool_choice` (only `auto`), `response_format`, `structured_outputs` |
| Reasoning | `mandatory: true`, `default_effort: "max"`, efforts `max`, `xhigh`, `high`, `medium`, `low`, `minimal` |
| Moderation | `is_moderated: true`, `moderationRequired: true` |
| Implicit caching | `supports_implicit_caching: false` |
| Quantization | `unknown` |
| Uptime | 100% over 5 min, 30 min and 1 day |

**Latency** (model page, 30-minute window, about 27,500 requests): p50 1.8 s, p75 2.5 s, p90 3.4 s, p95 4.1 s, p99 5.9 s. Throughput p50 157 tokens/s, p99 18 tokens/s. The page labels this metric `latency` without defining it. OpenRouter's [routing docs](https://openrouter.ai/docs/guides/routing/provider-selection.md#default-routing) measure time to first token, so read it as time to first token, not total time. A theming call with a few thousand reasoning tokens will take longer. The model is one day old, so these numbers are early.

**Missing parameters.** `stop`, `seed`, `logprobs` and `frequency_penalty` are not supported. `seed` is missing, so outputs cannot be made reproducible.

## 2. Structured outputs (JSON schema)

Source: <https://openrouter.ai/docs/guides/features/structured-outputs.md>

- On Chat Completions, send `response_format` with `type: "json_schema"` and a `json_schema` object holding `name`, `strict` and `schema`. "The model will respond with a JSON object that strictly follows your schema."
- "Support is determined per endpoint, not just per model." Meta's only endpoint lists both `response_format` and `structured_outputs`, so the schema is enforced on every route this model can take.
- `require_parameters: true` stops OpenRouter from routing to a provider that would silently ignore a parameter ([provider routing](https://openrouter.ai/docs/guides/routing/provider-selection.md#requiring-providers-to-support-all-parameters)). With one provider this changes nothing today. It still guards against a second provider being added later without schema support.
- Still decode the reply with Effect Schema. Strict mode limits what the model can emit, but the decode is the boundary check.

## 3. Cost per Round

Assumptions: 20 comments × 300 characters = 6,000 characters, one theming call, a system prompt plus schema of about 800 tokens. The tokenizer is listed only as "Other", so 3 to 4 characters per token is an estimate. German text uses more tokens than English.

| Part | Tokens | Cost |
| - | - | - |
| Input: comments | 1,500 to 2,000 | |
| Input: prompt and schema | about 800 | |
| **Input total** | **about 2,500** | **$0.00025** |
| Output: JSON themes | about 500 | |
| Output: reasoning at `low` or `minimal` effort | about 1,000 to 4,000 (not measured) | |
| **Output total** | **about 1,500 to 4,500** | **$0.00075 to $0.00225** |
| **Per Round** | | **about $0.001 to $0.0025** |

- Reasoning tokens "are considered output tokens and charged accordingly", and on Chat Completions they share the `max_tokens` budget ([reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens.md)). If the budget runs out during reasoning, the reply has `finish_reason: "length"`, empty `content`, and the reasoning is still billed. Treat that as a failure and do not retry it with the same budget.
- The default effort is `max`, "approximately 95% of the limit". **Always send `reasoning.effort`** (`low` or `minimal`) and a `max_tokens` cap. Otherwise one call can produce tens of thousands of output tokens. Even 20,000 tokens is only about $0.01, so the risk is latency and failed calls more than money.
- `reasoning.exclude: true` drops the reasoning text from the reply (Chat Completions only). It is still billed. It keeps model-generated reasoning about member comments out of the response body, so less text needs handling.
- The reasoning token count above is a guess. A spike with an API key should measure it.

## 4. Data policy: Meta, as OpenRouter lists it

Source: the `data_policy` object embedded in <https://openrouter.ai/meta/muse-ember> (identical in the endpoint and provider records), and <https://openrouter.ai/api/v1/providers>.

```json
{
  "training": false,
  "trainingOpenRouter": false,
  "retainsPrompts": true,
  "retentionDays": 30,
  "canPublish": false,
  "safetyRetention": false,
  "termsOfServiceURL": "https://ai.developer.meta.com/legal/terms-of-service",
  "privacyPolicyURL": "https://www.facebook.com/privacy/policy/",
  "requiresUserIDs": true
}
```

The model page's endpoint stats also carry `"is_zdr": false`.

- **Retention: 30 days.** Meta's endpoint is not in the "Safety Retention" tier (`safetyRetention: false`), so "Allow Safety Retention" (`allow_safety_retention_other`) does not make it eligible either. It falls in the third tier, which the [ZDR guide](https://openrouter.ai/docs/guides/features/zdr.md#data-policy-tiers) describes as "data may be stored and used for training under the applicable provider policy", here with training off.
- **ZDR list.** <https://openrouter.ai/api/v1/endpoints/zdr> held 1,109 endpoints on 2026-11-10. None is `meta/muse-ember`. The Meta-family models on the list are `meta/muse-spark-open` (Makora, Modal, Together, Nebius, BaseTen) and `meta/muse-glimmer-30b` (DeepInfra), all hosted by third parties, not by Meta.
- **`requiresUserIDs: true`.** OpenRouter does not define this flag in its docs. The Chat Completions [`user` field](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion.md) says: "When a provider requires a user identity, OpenRouter folds it into the hashed identity sent upstream and never forwards it raw. If omitted, requests use an account-level identity." So Meta receives a hashed identity on every request. Omitting `user` means that identity is the SurveyBeat account, not a Person.
- **Moderation.** The endpoint is moderated. A flagged input returns `403` with `error.metadata.flagged_input`, "the text segment that was flagged, limited to 100 characters" ([errors](https://openrouter.ai/docs/api_reference/errors-and-debugging.md#moderation-errors)). **An error body can therefore contain comment text.** It must never be logged or stored.
- **How reliable the flags are.** OpenRouter calls the Data Policy tag "not a definitive source of third party data policies, but represents our best knowledge" ([provider routing](https://openrouter.ai/docs/guides/routing/provider-selection.md#requiring-providers-to-comply-with-data-policies)). The DPA says the ZDR list "does not constitute OpenRouter's guarantee of AI Model Provider compliance".

## 5. Data policy: Meta's own terms

Source: Meta Model API Terms of Service, last updated 2026-10-09, <https://ai.developer.meta.com/legal/terms-of-service>, and the Model Designation and Geographic Use Policy, last updated 2026-10-12, <https://ai.developer.meta.com/legal/geographic-use-policy>.

- **Two tiers.** "Standard Services": Meta acts as "Service Provider" or "Processor" under the Meta Global Processor Terms (MGPT) and "will not use Content submitted in a request to the Standard Services to train Meta Models" (§5.1). "Contributor Services": "Meta may use your Content to train, develop, evaluate, and improve Meta's artificial intelligence models", and "You must not submit sensitive, confidential, or personal information to the Contributor Services" (§6.1, §6.2).
- **Muse Ember is on neither list.** The designation policy lists Standard Models (Muse Image, Muse Spark 1.1 to 1.3, Muse Voice Transcribe, SAM 3.1, Muse Wonder, Muse Wonder Full) and Contributor Models (Muse Spark 1.2 and 1.3 Contributor). Muse Ember is not listed. The terms also say "the system may route you to a Contributor Model, and you are responsible for ensuring that you are accessing and using a Standard or Contributor Model as you intend." Only OpenRouter's `training: false` flag says Ember is not trained on, and OpenRouter does not say which tier its traffic uses or whether it has a separate agreement with Meta. Its [ZDR guide](https://openrouter.ai/docs/guides/features/zdr.md#how-openrouter-manages-data-policies) says it "in some cases creates special agreements with providers".
- **Retention for safety, in both tiers.** §4.1: "You instruct Meta to retain and process Content as necessary to detect, prevent, and respond to violations of our Model API AUP … or these Terms and to develop, evaluate, and improve systems for the safety and the security of Meta products and services." §4.4 lists retention "as needed", including "when our systems flag data for a potential policy violation" and "for security, safety, abuse, and policy review and improvements". Meta's terms state no number of days. The 30 days comes only from OpenRouter's flag.
- **Usage Data** (request metadata, timestamps, token counts, latency) may be used by Meta "to test, support, develop, evaluate, and improve" its products (§4.2).
- **Contracting entity.** The terms are with Meta Platforms Ireland Limited for users in the "European Region", otherwise Meta Platforms, Inc. **Where processing happens is not stated.** Through OpenRouter, the contract is with OpenRouter (which accepts the Model Terms on the customer's behalf, see §7), not directly with Meta. Exhibit C ("Hosted Platform") excludes Meta from receiving content only on authorized third-party cloud platforms. OpenRouter's Meta endpoint calls `api.meta.ai` directly, so Exhibit C does not apply.
- The MGPT and Meta's subprocessor list (`forwork.meta.com/legal/mfw-subprocessor-list/`) are linked from the terms. They were not read for this note.

## 6. OpenRouter's own retention and CSAM screening

Sources: <https://openrouter.ai/docs/guides/privacy/data-collection.md>, <https://openrouter.ai/docs/guides/features/zdr.md#openrouters-retention-policy>, <https://openrouter.ai/blog/announcements/csam-screening> (2026-10-27).

- "OpenRouter does not store your prompts or responses, *unless* you opt in" to **Private Input & Output Logging** or **OpenRouter Use of Inputs/Outputs** (the 1% discount), "or content is flagged as potential CSAM". Both opt-ins are off by default. Keep them off, and check both settings in every workspace.
- **Metadata is always stored**: token counts, latency and similar, "not … the content of your prompts or responses".
- **Anonymous Input Categorization.** "OpenRouter samples a small number of prompts for categorization … stored completely anonymously and never associated with your account". The categorization runs "by model with a zero-data-retention policy". The docs offer no opt-out. This is content leaving the request path, even if anonymised.
- **CSAM screening** (planned from 2026-10-27, now in the data-collection page): "OpenRouter will screen all inference requests for child sexual abuse material (CSAM) … in flight", "including ZDR traffic". Flagged content "may be retained for human review, reporting, and preservation where required by law". Reported material is preserved for one year under 18 U.S.C. § 2258A. For text-only comment theming this is unlikely to trigger, but it is one more documented reason prompts can be kept.
- **DPA §2.4(a).** "Except where required by law or as necessary to address malicious use … OpenRouter will delete Inputs and Outputs promptly following generation of the relevant Output. OpenRouter may apply automated risk classification to Inputs and Outputs prior to deletion."

## 7. Routing controls and the exact request body

Sources: [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection.md), [ZDR guide](https://openrouter.ai/docs/guides/features/zdr.md), [guardrails](https://openrouter.ai/docs/guides/features/guardrails.md), [errors](https://openrouter.ai/docs/api_reference/errors-and-debugging.md).

| Control | What it does here |
| - | - |
| `provider.zdr: true` | "the request will only be routed to ZDR endpoints". Muse Ember has none, so the call fails. The 503 meaning, "no available model provider that meets your routing requirements", fits, but the docs do not state the status for this case. ZDR is an OR across request, account and guardrail, so a request cannot turn off ZDR the account enforces. |
| `enforce_zdr_other` (guardrail) / "All other models" toggle (account) | Same effect for every non-Anthropic/OpenAI/Google/SpaceXAI model, Meta included. Enforcing it blocks Muse Ember. |
| `allow_safety_retention_other` | Lets ZDR-enforced requests use Safety Retention endpoints. Meta's endpoint is not Safety Retention, so this does not help. |
| `data_collection: "deny"` | "use only providers which do not collect user data". The field is described as controlling "whether to use providers that may store data", but the bullets talk about training. **The docs do not say whether a 30-day, non-training provider counts as "collecting".** If it does, the call fails like `zdr: true`. Only a real request can tell. |
| `only: ["meta"]` + `allow_fallbacks: false` | Pins the request to Meta's endpoint. With fallbacks off, the request "fails if [the provider] fails" instead of moving to another provider. Today there is no other provider, so this guards against a future one, for example a Contributor or third-party host, being added silently. |
| `require_parameters: true` | Only providers that support every parameter sent, here `response_format` and `reasoning`. |
| No `models` array | A `models` list turns on [model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks.md) to other models with other policies. Never send one. |

**Request body.** It enforces no training, no fallback and no OpenRouter-side storage. **It cannot enforce no retention**, because Meta keeps prompts for 30 days on the only endpoint:

```json
{
  "model": "meta/muse-ember",
  "messages": [
    { "role": "system", "content": "<theming instructions; no Organization, Pulse or Round names>" },
    { "role": "user", "content": "<JSON array of already-redacted comment strings, shuffled, no ids>" }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": { "name": "themes", "strict": true, "schema": { "...": "..." } }
  },
  "reasoning": { "effort": "low", "exclude": true },
  "max_tokens": 8000,
  "temperature": 0.2,
  "stream": false,
  "provider": {
    "only": ["meta"],
    "allow_fallbacks": false,
    "require_parameters": true,
    "data_collection": "deny"
  }
}
```

- Leave out `user`, `session_id`, `metadata`, `trace` and the `x-session-id` header. Each one sends an identifier upstream or into OpenRouter's observability.
- If the spike shows `data_collection: "deny"` rejects Meta, drop it and rely on the account-level "no training" privacy setting plus `only` and `allow_fallbacks: false`. Record that in the ADR.
- If the ADR requires real no-retention, add `"zdr": true`. The call will fail with this model, so the ADR then needs another model.
- Account settings to set and record: Input & Output Logging off, "OpenRouter Use of Inputs/Outputs" off, training providers excluded for paid models. Use a dedicated API key with a guardrail that allows only `meta/muse-ember` and has a small budget.

## 8. In-region routing

Sources: <https://openrouter.ai/docs/guides/features/in-region-routing.md>, <https://openrouter.ai/docs/guides/features/sovereign-ai.md>, the model page.

- EU in-region routing (`https://eu.openrouter.ai`) is on Business and Enterprise plans. The request is "routed only to shared provider endpoints in that region", and "If no endpoint eligible for the region … can serve the request, it errors instead of leaving the region".
- Muse Ember: "Not currently available through EU in-region routing" (model page). `GET /api/v1/models?region=eu` returned 69 models, none of them Muse. `?region=us` returned 134, with `meta/muse-glimmer-30b` but not Muse Ember. **Muse Ember has no regional guarantee in either region.**
- Even on `eu.openrouter.ai`, "Account and operational records" and "Abuse-monitoring metadata" may be stored or processed in the US.

## 9. DPA

Sources: <https://openrouter.ai/data-processing-agreement> (last updated 2026-08-26), <https://openrouter.ai/terms> §10.2.

- **Yes, and it applies by default.** Terms §10.2: for organizations or commercial use, "The DPA is incorporated by reference into, and made a part of, these Terms." No separate signature is needed.
- The customer is Controller and OpenRouter is Processor (§2.1). EEA transfers use Module 2 SCCs, Irish law and Dublin courts (§13.2). There is a UK Addendum and Swiss terms. Breach notice within 72 hours. Deletion of Customer Data on request within 30 business days.
- §2.2: "Customer is responsible for reviewing the data handling terms set forth in AI Model Terms and configuring Customer's account accordingly." **Meta's retention is the customer's problem under the DPA, not OpenRouter's.**
- §5.2: subprocessor-change notices exclude "processing by AI Model Providers". Model providers can change without the 30-day notice.
- **Exhibit A (EU-only processing)** applies only when elected in an Order Form or other written agreement, and only for traffic through the EU API, which routes only to EU Model Providers. It cannot cover Muse Ember, which has no EU endpoint.
- Schedule 1 says "No processing of Sensitive Data or any special categories is intended". Survey comments about a workplace can contain special-category data (health, union membership), and redaction does not remove it.

## 10. Calling from a Worker or Durable Object

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/), OpenRouter [errors](https://openrouter.ai/docs/api_reference/errors-and-debugging.md) and [limits](https://openrouter.ai/docs/api_reference/limits.md).

- **Transport.** Plain `fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body })`. No SDK is needed. The optional `HTTP-Referer` and `X-Title` headers are for attribution only and should be left out.
- **Secret.** Store `OPENROUTER_API_KEY` as a Worker secret, declared in `infra/alchemy.run.ts` like the WorkOS key, and read it from `env`. Only the Worker or Durable Object that runs the theming job gets the binding, never the Submission Worker.
- **CPU and duration.** "Waiting on network requests (such as `fetch()` calls …) does **not** count toward CPU time". Paid CPU defaults to 30 s per request. "There is no hard limit on duration for HTTP-triggered Workers" while the client stays connected. Alarms have 15 min of wall time (see `durable-objects-workflows-limits.md`). Run the call from a Durable Object alarm or a Workflow step, not from the Lead's HTTP request.
- **Timeouts.** OpenRouter documents no server-side request timeout beyond the `408` code. Set your own: `signal: AbortSignal.timeout(60_000)` is generous against a p99 of 5.9 s to first token plus a few thousand reasoning tokens at p99 throughput (18 tokens/s, so about 4 minutes in the worst case). Measure in the spike. Note `isAbortable: false` on Meta's provider record: an aborted request may still run, and may still be billed, upstream.
- **Errors.** A request error has an HTTP status equal to `error.code`. Errors after the model starts can arrive with HTTP **200** and an `error` in the body, so always check the body. Retry `408`, `429`, `502` and `503` with exponential backoff and jitter, honouring `Retry-After` on 429/503. Do not retry `400`, `401`, `402` or `403` (`403` covers moderation flags and budget blocks). Do not retry `finish_reason: "length"` with the same budget. A Workflow step's built-in `retries` (5, exponential) fits.
- **Rate limits.** OpenRouter's published request caps are for `:free` models and key management only. Paid model capacity is "govern[ed] … globally". One call per Round is far below any of them.
- **Logging.** The theming code must not log request bodies, response bodies or error bodies (moderation errors echo up to 100 characters of input). Log the status code, `error.code`, token counts from `usage`, and duration only.

## 11. Where the sources are silent

- Which Meta tier (Standard or Contributor) Muse Ember traffic from OpenRouter uses, and whether OpenRouter has a separate agreement with Meta.
- Where Meta processes requests (country or data centre).
- Whether the 30 days is a fixed deletion deadline, and whether flagged content is kept longer. Meta's terms state no period.
- Whether `data_collection: "deny"` excludes a provider that keeps prompts without training.
- What `requiresUserIDs` sends to Meta beyond "hashed identity".
- The HTTP status for a request that no endpoint can serve under `zdr: true`.
- Real reasoning token counts and total latency for a theming call. These need an API key.

## 12. Open risks for the ADR

1. **This model cannot meet "no retention".** Meta keeps redacted comments for 30 days on its only endpoint, under terms that also allow safety retention for an unstated period. The ADR must either accept retention by a US provider, and say so to members, or choose a ZDR endpoint. Candidates in the ZDR list are `meta/muse-spark-open` on Together, Nebius or Modal, which keeps the Meta model family but uses a third-party host. That choice contradicts SPEC §10 question 4's data-residency default, so it needs its own ADR, not a silent override.
2. **Training is not settled in Meta's own documents.** OpenRouter says `training: false`. Meta's designation policy does not list Muse Ember, and Meta's terms warn that traffic may be routed to Contributor models. Before launch, get written confirmation (from OpenRouter support or a Meta designation update) that Ember is a Standard model, and re-check the designation page in the ADR's review step.
3. **Redaction is rule-based and imperfect** (ADR 0009). Nicknames, names outside the roster and identifying phrases survive. Whatever survives goes to Meta and stays for 30 days. A 20-comment Round from a small team is easy to re-identify. The minimum group size (ADR 0004) should gate the AI pass too: do not send a Round's comments while fewer than that many Submissions exist.
4. **What may be sent:** only the redacted comment text, as a shuffled JSON array of strings, plus a fixed instruction prompt. **Never send** Person names or ids, emails, Invitation tokens, Edit keys or hashes, Submission or Answer keys, Round ids, Pulse ids or titles, Organization names or ids, timestamps, the order comments arrived in, or attributed/anonymous flags. Do not send `user`, `session_id`, `metadata` or `trace`. Map themes back to comments by array index inside the Durable Object. For anonymous Rounds, ADR 0005's "no time" rule means the call must not reveal submission order, so shuffle before sending.
5. **What members must be told,** on the answer page and the privacy page, before they write: that comments are sent, after the listed redaction, to Meta through OpenRouter (both US companies) to group them into themes; that Meta keeps them for up to 30 days and may keep flagged content longer; that neither uses them for training (subject to risk 2); that processing is not limited to the EU; and that OpenRouter screens requests for CSAM. The current answer-page sentence "Your name is never stored with your answers" stays true, but it is no longer the whole story for comments.
6. **Error bodies carry text.** Moderation `403`s echo up to 100 characters of the flagged input. The theming path needs the same "error codes only" logging rule as the Submission Worker, plus a privacy test that drives a moderation error and asserts that nothing from the body is logged or stored.
7. **The provider can change without notice.** The DPA does not require notice of AI Model Provider changes, and Meta can update its terms and designations at any time. `only` + `allow_fallbacks: false` + `require_parameters: true` stop a new provider being used silently. A scheduled check that `GET /api/v1/models/meta/muse-ember/endpoints` still shows one `meta` endpoint with `training: false` would catch a policy change.
8. **Special-category data.** OpenRouter's DPA says no Sensitive Data processing is intended. Workplace comments can contain it. The ADR should state the lawful basis and whether a DPIA is needed.
