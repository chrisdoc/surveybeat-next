# Comment themes use Claude Haiku 5.5 through OpenRouter, with zero data retention, in the EU, switched on per Organization

Release 2's AI features (comment themes and the AI part of the discussion guide) call `anthropic/claude-haiku-5.5` through OpenRouter. Every request sets `provider.zdr: true`, is pinned to the two zero-data-retention endpoints that run in the EU (`google-vertex/europe`, then `amazon-bedrock/eu-west-1`), and allows no fallback. If neither endpoint can serve the request, it fails and is retried later; it never leaves the EU or goes to an endpoint that keeps data. This replaces SPEC §10 question 4's default (Workers AI only), chosen by the product owner on 2026-11-10 (map #85).

**What is sent:** only comment text that rule-based redaction has already processed (ADR 0009), and the Question text. Never a name, a Person id, a Membership, a Round id, a Team or Organization name, a time, or anything that links a comment to a Submission (ADR 0005). The Organization Durable Object makes the call with a key held as a Worker secret, a timeout, and retries that honour `Retry-After`. Response and error bodies are never logged, because a provider's moderation error can echo comment text.

**Off by default.** An Organization admin turns AI processing on for the Organization. While it is off, nothing is sent and the AI features do not appear. While it is on, the answer page and the Invitation say plainly that redacted comments are processed by an AI service in the EU that keeps nothing.

**Request shape** (Chat Completions):

```json
{
  "model": "anthropic/claude-haiku-5.5",
  "provider": {
    "zdr": true,
    "only": ["google-vertex/europe", "amazon-bedrock/eu-west-1"],
    "order": ["google-vertex/europe", "amazon-bedrock/eu-west-1"],
    "allow_fallbacks": false,
    "data_collection": "deny"
  },
  "response_format": { "type": "json_schema", "json_schema": { "strict": true } },
  "max_tokens": 2000
}
```

The OpenRouter account also has prompt and output logging off, "use of inputs/outputs" off, and a dedicated key whose guardrail allows only this model, enforces ZDR, and caps spend.

## Considered options

- **`meta/muse-ember`** (the first choice): no zero-retention endpoint exists. Meta, its only host, keeps prompts for 30 days, is not on EU routing, and its own terms don't say whether this model is trained on. Rejected: members' words would sit with a US provider for 30 days ([research note](../research/openrouter-muse-ember.md)).
- **`openai/gpt-6-luna`:** same price, zero retention only through Azure. Viable, but Haiku 5.5 has EU zero-retention endpoints with strict JSON-schema output.
- **`meta/muse-spark-open`:** zero retention on several hosts, but about 9× the price, with no advantage over Haiku 5.5.
- **Workers AI** (SPEC's default): keeps everything inside Cloudflare, but the product owner chose OpenRouter.

## Consequences

- Cost is about $0.0015 per Round ($0.10 per million input and $0.50 per million output tokens; one call of about 2,000 input and 2,500 output tokens), an estimate until a real call measures it.
- OpenRouter is a sub-processor (its DPA is part of its terms), and so are Google Cloud or AWS for the model call. Customer-facing privacy pages must name them.
- OpenRouter's account and abuse-monitoring metadata may be processed in the US even when the model call runs in the EU. Comment text is not part of that metadata under ZDR.
- If either EU endpoint drops ZDR or leaves OpenRouter, requests fail closed rather than going elsewhere. A test asserts the request body above.
