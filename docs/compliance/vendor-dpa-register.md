# Vendor DPA & Sub-processor Register (GDPR Art. 28) + Customer LIA Template

**Scope:** Active infrastructure and AI sub-processors used by SurveyBeat in `production`, plus a reusable **Legitimate Interest Assessment (LIA)** template for customer `Organization`s deploying SurveyBeat to EU `Team`s.  
**Vocabulary:** Domain terms follow [`GLOSSARY.md`](../../GLOSSARY.md).  
**Related Docs:** [`ropa.md`](./ropa.md), [`dpia.md`](./dpia.md), [`docs/infra.md`](../infra.md), [`0015-comment-ai-claude-haiku-via-openrouter-zdr-eu.md`](../adr/0015-comment-ai-claude-haiku-via-openrouter-zdr-eu.md).

---

## 1. Authorized Sub-processor Register (GDPR Art. 28)

SurveyBeat uses only the sub-processors listed below. Chat integrations (Slack, Microsoft Teams) and fallback email providers (Postmark) mentioned in [`SPEC.md`](../../SPEC.md) are **not built or active** in the current codebase (`docs/infra.md`) and are excluded from this active register until implemented.

| Sub-processor | Service & Role in SurveyBeat | Personal Data / Content Processed | Processing Location | DPA & Transfer Safeguards (Chapter V) | Repo & Configuration Safeguards | Verification Status |
| --- | --- | --- | --- | --- | --- | --- |
| **Cloudflare, Inc.** (101 Townsend St, San Francisco, CA 94107, USA / Cloudflare EMEA Ltd.) | Edge network, DNS/TLS, Workers (`MainWorker`, `SubmissionWorker`, `SiteWorker`), `Organization` Durable Objects (SQLite), `Database` (D1), Queues (`Jobs`, `Email`, `EmailEvents` + DLQs), Cron Triggers, and **Cloudflare Email Sending** (`notify.surveybeat.app`, `production` only). | **All application tables** in D1 & `Organization` DOs (`auth_user`, `auth_session`, `person`, `membership`, `round_member`, `invitation`, `email_send`, `participation`, `action`, `round_note`), plus transient HTTP traffic and transactional emails. Stored `submission` and `answer` rows have no `Person` column. A comment that identifies its author remains personal data (`ropa.md` §3). | Global edge network (Workers/DNS) & Cloudflare Durable Object / D1 regions. | Cloudflare Data Processing Addendum (incorporating **EU Standard Contractual Clauses** Module 2/3, UK Addendum, Swiss FADP) + **EU-US Data Privacy Framework (DPF)** certification. | `SubmissionWorker` disables all observability (`check-observability.ts`, `canary-sweep.ts`); `ProductionEmail` sets `previewEnabled: false` (`Email.ts`); 30-day encrypted PITR window (`Policy.backupRetentionDays`). | **Active** — verify executed Cloudflare DPA in account billing/legal portal prior to GA. |
| **OpenRouter, Inc.** (USA) | Optional AI API gateway (`https://openrouter.ai/api/v1/chat/completions`) for Release 2 `Comment theme`s and `Discussion guide`s (`OpenRouterAiClient.ts`, ADR 0015). **Inactive unless `Organization admin` turns `ai_processing = 1` on.** | Stored comment text (redacted at store time), each `Question`'s text, dimension, score, and change, `Dimension` scores and changes, and redacted titles of open `Action`s (`buildThemesInput`, `AiClient.ts`, ADR 0019). `Question` text is **not** redacted. The payload has no dedicated field for a `Person` ID, an email address, a `Team` name, an `Organization` name, or a timestamp. `QuestionText` does not reject those identifiers, so an email address or a name in a `Question` can reach OpenRouter. Name redaction uses email local parts of at least 2 characters; `person` has no display-name column (`ropa.md` §4). | API control plane & account/abuse metadata in **US**; inference traffic pinned exclusively to **EU** upstream endpoints below. | OpenRouter DPA (incorporated by reference in OpenRouter Terms §10.2; **EU SCCs Module 2**, Irish governing law, UK Addendum, Swiss terms; 72h breach notice). *Caveat:* DPA §5.2 excludes AI Model Providers from 30-day sub-processor change notices; US metadata & in-flight CSAM screening apply (`docs/research/openrouter-muse-ember.md` §6, §9). | `ai_processing = 0` by default (`0011_ai_processing.sql`); request enforces `zdr: true`, `only: ["google-vertex/europe", "amazon-bedrock/eu-west-1"]`, `allow_fallbacks: false`, `data_collection: "deny"` (`OpenRouterAiClient.test.ts`); account prompt/output logging & training opt-ins off; fail-closed without `OPENROUTER_API_KEY`; response/error bodies never logged. | **Active (Opt-in)** — confirm OpenRouter workspace logging/training toggles off & dedicated guarded key per environment. |
| **Google Cloud** (Google LLC / Google Cloud EMEA Ltd.) — **Vertex AI (`google-vertex/europe`)** | Primary pinned EU zero-data-retention (ZDR) inference host for `anthropic/claude-haiku-5.5` accessed via OpenRouter (`OpenRouterAiClient.ts` `EU_ENDPOINTS[0]`). | Same `AiInput` JSON payload as the OpenRouter row above. Upstream ZDR is the hosting claim. OpenRouter may still retain content it flags as potential CSAM, including ZDR traffic (`docs/research/openrouter-muse-ember.md` §6). | **EU** (`europe` multi-region endpoint). | Accessed as OpenRouter upstream AI Model Provider under OpenRouter ZDR routing; Google Cloud Data Processing Addendum (CDPA), **EU SCCs**, **EU-US DPF**, and EU regional endpoint pinning (`google-vertex/europe`). | Enforced via `provider.zdr: true`, `only`, `allow_fallbacks: false`, and `data_collection: "deny"`. Fails closed rather than falling back to non-EU or non-ZDR endpoints. | **Active (Opt-in via OpenRouter)** — re-verify ZDR & EU endpoint availability periodically. |
| **Amazon Web Services, Inc.** (AWS EMEA SARL, Luxembourg) — **AWS Bedrock (`amazon-bedrock/eu-west-1`)** | Secondary pinned EU zero-data-retention (ZDR) inference host for `anthropic/claude-haiku-5.5` accessed via OpenRouter (`OpenRouterAiClient.ts` `EU_ENDPOINTS[1]`). | Same `AiInput` JSON payload as the OpenRouter row above. Upstream ZDR is the hosting claim. OpenRouter may still retain content it flags as potential CSAM, including ZDR traffic (`docs/research/openrouter-muse-ember.md` §6). | **EU — Ireland (`eu-west-1`)**. | Accessed as OpenRouter upstream AI Model Provider under OpenRouter ZDR routing; AWS GDPR DPA (incorporating **EU SCCs**), **EU-US DPF**, CISPE Code of Conduct, and `eu-west-1` regional pinning. | Enforced via `provider.zdr: true`, `only`, `allow_fallbacks: false`, and `data_collection: "deny"`. Fails closed rather than falling back to non-EU or non-ZDR endpoints. | **Active (Opt-in via OpenRouter)** — re-verify ZDR & EU endpoint availability periodically. |

---

## 2. Sub-processor Governance & Change Protocol (Art. 28(2))

1. **Before onboarding or changing a sub-processor:**
   - Complete a transfer and security review (DPA, EU SCCs/DPF, regional pinning, zero-retention guarantees).
   - Update [`docs/compliance/ropa.md`](./ropa.md), [`docs/compliance/dpia.md`](./dpia.md), and this register in the same pull request (prompted by [`docs/infra.md`](../infra.md)).
   - Notify customer `Organization`s in advance per the customer DPA (standard 30-day objection window) before routing production customer data to the new sub-processor.
2. **Note on AI Model Providers:** Because OpenRouter DPA §5.2 does not provide 30-day advance notice for upstream AI Model Provider changes, `OpenRouterAiClient.ts` hard-pins `only: ["google-vertex/europe", "amazon-bedrock/eu-west-1"]` with `allow_fallbacks: false` and `zdr: true`. Any new model or region requires an ADR (ADR 0015 pattern) and an update to this register.

---

## 3. Customer Legitimate Interest Assessment (LIA) Template (GDPR Art. 6(1)(f))

*This template is provided for customer `Organization`s (acting as Data Controllers) who rely on **Legitimate Interests (Art. 6(1)(f))** to invite EU `Team` members to recurring SurveyBeat `Pulse`s and process `Person` / `Membership` / `Participation record` data. Customer legal/DPO teams should tailor bracketed `[...]` fields and check national workplace co-determination laws (e.g., German BetrVG §87(1)(6) works council consultation where applicable).*

---

### LIA Template: Recurring Team Health Check-ins with SurveyBeat

**Customer Organization:** `[Organization Name]`  
**Assessment Owner:** `[Name, Title — e.g., People Ops / HR Lead]`  
**DPO / Legal Reviewer:** `[Name, Date]`  
**Review Date:** `[YYYY-MM-DD]`

#### Part 1: Purpose Test — Is there a legitimate interest?

1. **What is the specific business/organizational objective?**  
   To run short (`3–7` questions), recurring `Pulse` check-ins for `Team`s in `[Organization Name]` to surface aggregated team workload, psychological safety, clarity, and recognition trends (`Dimension`s) and turn team feedback into owned `Action`s.
2. **Who benefits from the processing?**  
   - **`Team` members:** Gain a safe, anonymous channel to raise workload or collaboration blockers without fear of individual attribution, and see concrete `Action`s committed in response.  
   - **`Lead`s & `[Organization Name]`:** Detect team burnout or process bottlenecks early, measure whether `Action`s improve team health over time, and improve retention.
3. **Is the interest lawful, real, and clearly articulated?**  
   Yes. Fostering healthy working conditions, operational clarity, and team feedback loops is a lawful, standard business interest. SurveyBeat explicitly prohibits individual performance evaluation and 360-degree scoring (`SPEC.md` §9).

#### Part 2: Necessity Test — Is the processing strictly necessary and proportionate?

1. **Could the objective be achieved without processing personal data at all?**  
   No. Distributing `Invitation`s to eligible `Team` members, preventing a second `Submission` (`participation`), sending reminders only to `Team` members who have not answered, and excluding `Organization admin`s from `Team` `Result`s require knowing each `Person`'s email address and `Team` `Membership`.
2. **Are less intrusive alternatives available? Why is SurveyBeat proportionate?**  
   - **Data minimization:** Only email address, `Team` `Membership`, and time zone are needed for `Pulse` delivery. `Submission`s and `Answer`s are stored in anonymous `WITHOUT ROWID` tables with random 128-bit IDs, zero `Person` columns, zero timestamps, and zero language columns (`ropa.md` §3).  
   - **Store-time `Redaction`:** Before a comment is stored, `redact` removes email addresses, phone numbers, `@handles`, URLs, and roster email local parts of at least 2 characters. A shorter local part can remain when it appears as a word. `person` stores email and no display name, so a name that is not in an email local part is not removed (`Redaction.ts`, `ropa.md` §4). `Question` text sent to the model is not redacted and may contain a name or an email address. `QuestionText` does not reject that.  
   - **No surveillance by management:** `Organization admin`s see zero `Result`s unless they hold a `Team` `Membership` visible to the `Team` (ADR 0003). `Minimum group size` (`>= 3`, set to `[4 or higher]`) prevents singling out individuals or subtraction attacks (ADR 0004).  
   - **Optional AI processing:** `[State whether organization.ai_processing is OFF (0) or ON (1). If ON: the payload is stored comment text, unredacted Question text, scores and changes, and redacted open Action titles, sent via OpenRouter to google-vertex/europe or amazon-bedrock/eu-west-1 with zdr: true. Upstream ZDR is not a promise that OpenRouter keeps nothing. OpenRouter may retain content it flags as potential CSAM, including ZDR traffic, and reported material is kept for one year under 18 U.S.C. § 2258A (docs/research/openrouter-muse-ember.md §6).]`

#### Part 3: Balancing Test — Do the data subjects' interests or rights override the legitimate interest?

| Factor | Assessment for `[Organization Name]` |
| --- | --- |
| **Nature of data** | Directory & delivery metadata (work email, `Team` `Membership`, `Round` `Participation record` without timestamp). Stored `Answer`s/comments are anonymous under Recital 26 (`ropa.md` §3). Special-category data (Art. 9) is not solicited. |
| **Power imbalance (workplace context)** | Because `[Organization Name]` is the employer, `Team` members could fear retaliation if answers were attributable. SurveyBeat neutralizes this structurally: `Submission`s cannot be joined to `Person`s, `Minimum group size` blocks small-group exposure, `Lead`s see no live `Result`s while a `Round` is `Open`, and `Organization admin`s see no `Result`s. |
| **Reasonable expectations of `Team` members** | Periodic anonymous team feedback check-ins are standard in modern workplaces. An `Invitation` states the `Minimum group size` and that the name is not stored with the answers, and mentions `Redaction` and AI only when `ai_processing` is on. The answer page states the `Minimum group size`, what comment `Redaction` removes (`answer.comment.disclosure`), and the AI notice when AI is on. The 30-day backup window is on the in-app Privacy page only (`catalog.ts` `privacy.restore`). |
| **Autonomy & Right to Object (Art. 21)** | Participation in `Pulse`s is voluntary. `Team` members can opt out of reminders per `Pulse` (`GET /api/reminders/unsubscribe`, RFC 8058) or object to directory or reminder processing by contacting `[Internal HR / Privacy Contact]`. `directory.removePerson` sets `person.removed_at` and `membership.ended_at`, deletes `person_index`, `participation`, and `test_send`, and revokes `Invitation`s. The `person` row and membership history stay. There is no automated purge of the retained `person` row, and no command that erases that row or the membership history. That erasure is not available yet. |
| **Safeguards** | Zero-observability `SubmissionWorker`, encrypted storage, EU-pinned ZDR AI (if enabled), and documented internal policy prohibiting attempts to coerce or guess who wrote specific comments. |

#### Part 4: Outcome & Sign-Off

- **Assessment Conclusion:** `[Legitimate Interest (Art. 6(1)(f)) IS / IS NOT valid for this rollout, subject to the safeguards listed above and informing Team members via our internal employee privacy notice.]`
- **Conditions / Controls Required Before Launch:**
  1. Set `Minimum group size` to `[>= 4]`.
  2. Decide `ai_processing` setting (`[OFF / ON with EU ZDR notice]`).
  3. Update employee privacy notice with SurveyBeat details, retention rules, and Art. 21 objection contact `[privacy@company.example]`.
  4. `[Complete works council / employee representative consultation if required by local law.]`
- **Approved by:** `[Name, Role]` — **Date:** `[YYYY-MM-DD]` — **Next Review:** `[YYYY-MM-DD]`
