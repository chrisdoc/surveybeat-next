# Data Protection Impact Assessment (DPIA) — GDPR Article 35

**System:** SurveyBeat (`MainWorker`, `SubmissionWorker`, `SiteWorker`, `Organization` Durable Object, `Database` D1, optional OpenRouter EU ZDR AI pipeline)  
**Assessment Scope:** Recurring anonymous Team `Pulse` check-ins, store-time `Redaction`, `Result` aggregation, and optional AI `Comment theme` and `Discussion guide` generation.  
**Vocabulary:** Domain terms follow [`GLOSSARY.md`](../../GLOSSARY.md).  
**Related ADRs:**
- [`0003-organization-admin-sees-no-results.md`](../adr/0003-organization-admin-sees-no-results.md)
- [`0004-minimum-group-size-per-aggregate.md`](../adr/0004-minimum-group-size-per-aggregate.md)
- [`0005-anonymous-submission-storage.md`](../adr/0005-anonymous-submission-storage.md)
- [`0009-comments-redacted-at-store-time.md`](../adr/0009-comments-redacted-at-store-time.md)
- [`0015-comment-ai-claude-haiku-via-openrouter-zdr-eu.md`](../adr/0015-comment-ai-claude-haiku-via-openrouter-zdr-eu.md)
- [`0016-comment-themes.md`](../adr/0016-comment-themes.md) and [`0019-ai-discussion-guide.md`](../adr/0019-ai-discussion-guide.md)

---

## 1. Threshold Analysis: Why a DPIA Is Required (Art. 35(1), Art. 35(3))

Under GDPR Article 35(1) and the EDPB/WP29 DPIA criteria (WP248 rev.01), a DPIA is triggered because SurveyBeat combines three risk factors:

1. **Vulnerable data subjects (workplace power imbalance):** `Team` members answer workplace check-ins initiated by `Lead`s or `Organization admin`s. Because of the employer–employee relationship, members cannot freely absorb risk if responses could be attributed to individuals.
2. **Innovative / automated text analysis (AI):** When an `Organization admin` enables `organization.ai_processing = 1`, redacted free-text comments and open `Action` titles are processed by an LLM (`anthropic/claude-haiku-5.5` via OpenRouter) to generate `Comment theme`s and a `Discussion guide`.
3. **Evaluation / scoring of Team dynamics:** Recurring weekly measurement across `Dimension`s (`workload`, `psychologicalSafety`, `clarity`, `recognition`) could cause chilling effects or informal retaliation if not strictly aggregated above a `Minimum group size`.

---

## 2. Systematic Description of Processing & Architecture (Art. 35(7)(a))

1. **Collection & Invitation:** `Organization` Durable Objects schedule weekly `Round`s (`round`, `round_member`, `round_question`), derive HMAC-signed `Invitation` tokens, store only `token_hash` in `invitation` (DO) and `invitation_index` (D1), and send emails via `EmailDelivery.ts` (`Cloudflare Email Sending` in `production` with `previewEnabled: false`).
2. **Answering Boundary (`SubmissionWorker`):** Answer links put the `Invitation` token in the URL fragment (`#t=`). The browser POSTs it in the JSON body to `SubmissionWorker` (`/exchange`, `/first-answer`), which runs with all observability channels disabled. `GET /delivery?token=` and `GET /api/reminders/unsubscribe?t=` on `MainWorker` still carry the token in the query string (issue #311). The browser generates an `Edit key` locally (`sb_edit_<roundId>`), transmits only its SHA-256 `edit_key_hash` on `/first-answer`, and uses the `Edit key` alone on `/answer`.
3. **Atomic Storage & Store-Time `Redaction`:** `recordFirstAnswer` (`SqlRounds.ts`) atomically inserts `(round_id, person_id)` into `participation`, creates a random 128-bit `submission` (`WITHOUT ROWID`, no `Person`, no time, no locale), and passes every comment through `Redaction.redact` (`Redaction.ts`) before inserting into `answer`. Raw comments are never persisted.
4. **Aggregation & Access Control:** When a `Round` closes, `RoundJobs.ts` computes `round_result` enforcing `effective_minimum_group_size` (default `4`, minimum `3`). `Organization admin`s without a `Team` `Membership` have zero access to `Result`s, comments, or `Action`s (ADR 0003).
5. **Optional AI Processing (`ai_processing`):** Off by default (`0`). When enabled (`1`) and the `Round` meets `Minimum group size`, `RoundJobs.ts` sends only `RedactedText` comments, `Question` texts, `Dimension` scores/changes, and redacted open `Action` titles to OpenRouter (`google-vertex/europe` or `amazon-bedrock/eu-west-1` with `zdr: true`, `allow_fallbacks: false`, `data_collection: "deny"`).

---

## 3. Necessity and Proportionality Assessment (Art. 35(7)(b))

- **Purpose Limitation:** SurveyBeat measures *team* health and supports *team* `Action`s (`SPEC.md` §1, §9). Individual performance evaluations and 360-degree reviews are explicitly out of scope (`SPEC.md` §9).
- **Data Minimization:**
  - `Pulse` editor recommends `<= 7` questions (`Policy.questions.recommended = 7`, hard cap `20`).
  - `participation` stores only `(round_id, person_id)` with no timestamp; `submission` stores only `(id, round_id, edit_key_hash)` with no `Person`, no `Invitation`, no timestamp, and no `locale`.
  - Release 1 supports only `anonymity_mode = 'anonymous'` and `distribution = 'invitation'`.
  - `Redaction` strips direct identifiers before disk write (ADR 0009).
- **Transparency & Member Controls:**
  - Every `Invitation` and the answer page state the `anonymity_mode`, `Minimum group size`, `Redaction` behavior, `ai_processing` state, and 30-day PITR window in plain language (`apps/web/src/messages/catalog.ts`).
  - `Team` members can opt out of reminders per `Pulse` (`pulse_reminder_opt_out`, RFC 8058 `/unsubscribe`) and clear browser-local history (`clearKeptAnswers`).

---

## 4. Risk Register & Technical/Organizational Mitigations (Art. 35(7)(c)-(d))

*Risk scale:* Likelihood / Severity rated `Low`, `Medium`, `High`, `Critical`.

| Risk ID | Threat & GDPR Harm | Inherent Risk (L × S) | Architectural & Procedural Mitigations (Implemented in Repo) | Verification / Evidence | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| **R-01** | **Re-identification of anonymous feedback via database links, insertion order, timestamps, or server logs.** A `Lead`, `Organization admin`, or operator correlates `Submission`s to `Person`s. | High × High (**Critical**) | **ADR 0005:** `submission`, `answer`, and `participation` are `WITHOUT ROWID`, use random 128-bit IDs, and have zero `person`, `invitation`, `time`, or `locale` columns. `Invitation` tokens travel in URL fragment; `SubmissionWorker` accepts POST-body credentials only, rejects `token` + `editKey` together, and keeps `observability`, `logs`, `traces`, `logpush`, and `tailConsumers` off. | `Submissions.privacy.test.ts` (A1, A2, A4, A4b, A10), `Unlinkability.privacy.test.ts`, `SubmissionRoutes.privacy.test.ts` (A5), `check-observability.ts`, `canary-sweep.ts`. | **Low** |
| **R-02** | **Re-identification in small Teams, via live score updates, or subtraction attacks.** A `Lead` infers an individual's score by comparing sub-groups, small `Question` counts, or watching `Result`s update right after someone answers. | High × High (**Critical**) | **ADR 0004:** `Minimum group size` (`defaultValue: 4`, SQL `CHECK (minimum_group_size >= 3)`) applies per `Question` and per `Dimension` (`usableQuestionCount` excludes sub-`N` `Question`s to block subtraction). Each `Round` freezes `effective_minimum_group_size` so lowering `N` never reveals past `Round`s. No live `Result`s appear while a `Round` is `Open` (even above `2N`). Comments are gated on `Round` `Submission` count and unlinked from ratings. | `Results.privacy.test.ts` (P1, P2), `0004_teams.sql`, `0006_rounds.sql`. | **Low** |
| **R-03** | **Surveillance or cross-Team inspection by `Organization admin`s.** Executives or IT admins read raw comments or `Result`s for `Team`s they do not belong to. | Medium × High (**High**) | **ADR 0003 & ADR 0014:** `person.organization_admin` grants directory/settings administration only. Viewing any `Team`'s `Result`s, comments, or `Action`s requires an active `Membership` in that `Team` (`Permissions.ts`), visible to the `Team` roster. | `Permissions.test.ts`, `0003_person.sql`, `0004_teams.sql`. | **Low** |
| **R-04** | **Free-text PII & third-party naming in comments.** A respondent names a colleague, enters an email/phone/handle/URL, or leaves identifying context. | High × Medium (**High**) | **ADR 0009:** Synchronous rule-based `Redaction` (`Redaction.ts`) runs inside `SubmissionWorker` before storage, replacing roster names/email local parts, emails, phone numbers, `@handles`, and URLs with placeholders. Raw text is never stored or logged. `Lead`s cannot link comments to ratings or `Submission` order. *(Limitation: nicknames or non-roster phrasing are not caught by rule-based redaction; disclosed on answer page.)* | `Redaction.privacy.test.ts`, `Submissions.privacy.test.ts` (A4b), `catalog.ts` (`privacy.comments.body`). | **Medium** *(mitigated further by user notice and optional themes-only abstraction)* |
| **R-05** | **Free-text PII leakage, prompt retention, or cross-border transfer to AI sub-processors.** Comments sent to an LLM are logged, retained for 30 days, trained on, or routed outside the EEA. | High × High (**Critical**) | **ADR 0015, ADR 0016, ADR 0019:** `organization.ai_processing` defaults to `0` (off). When enabled: (1) only `RedactedText` comments, `Question` text, `Dimension` scores/changes, and redacted open `Action` titles are sent—never `Person` IDs, names, emails, `Team`/`Organization` names, or timestamps; (2) `OpenRouterAiClient.ts` pins `provider.zdr: true`, `only: ["google-vertex/europe", "amazon-bedrock/eu-west-1"]`, `allow_fallbacks: false`, `data_collection: "deny"`, failing closed if unavailable or if `OPENROUTER_API_KEY` is unset; (3) OpenRouter account prompt/output logging & training opt-ins are disabled; (4) response/error bodies (e.g., moderation `403` echoes) are never logged; (5) `Comment theme`s require `>= 2` supporting comments and pass a 6-word anti-quote check. *(Caveat: OpenRouter account/abuse metadata & in-flight CSAM screening remain documented in `docs/research/openrouter-muse-ember.md`.)* | `OpenRouterAiClient.test.ts`, `Themes.privacy.test.ts`, `0011_ai_processing.sql`. | **Low–Medium** |
| **R-06** | **Point-in-time restore (PITR) correlation attack.** Restoring a Durable Object to a prior timestamp replays transaction order, correlating a `participation` insert with its `submission`. | Low × High (**Medium**) | **ADR 0005:** Explicitly excluded from the cryptographic at-rest guarantee. Mitigated by restricting PITR restores exclusively to named, credentialed infrastructure operators (zero access for `Organization admin`s or `Lead`s), strict **30-day** backup expiry (`Policy.backupRetentionDays = 30`), and plain-language disclosure on the `Privacy` page (`catalog.ts` `privacy.restore`, `privacy.restoreTrigger`). | `Policy.ts`, `catalog.ts`, `docs/adr/0005-anonymous-submission-storage.md`. | **Low** |
| **R-07** | **Email scanner pre-fetching or log leakage of `Invitation` tokens.** Corporate link scanners open URLs in emails, or Cloudflare email logs retain `Invitation` links. | Medium × Medium (**Medium**) | **ADR 0007 & ADR 0005:** One-tap email links pass the `Invitation` token in the URL fragment (`#token`) and only pre-select the rating in the browser; `Submission` requires explicit browser POST confirmation. `ProductionEmail` sets `previewEnabled: false` (`Email.ts`) so Cloudflare does not retain email previews containing `Invitation` links. | `Email.ts`, `SubmissionRoutes.privacy.test.ts`. | **Low** |
| **R-08** | **Silent observability regression on `SubmissionWorker`.** A deploy or dependency update accidentally turns Workers Logs, Traces, or Tail Consumers on. | Low × Critical (**High**) | CI `preview-privacy` and Deploy `staging-privacy` jobs enforce `check-observability.ts` (API read-back of `SubmissionWorker` settings) and `canary-sweep.ts` (1,000-request canary with `MainWorker` positive control) before any change reaches `production`. | `.github/workflows/preview.yml`, `.github/workflows/deploy.yml`, `infra/scripts/check-observability.ts`, `infra/tests/privacy/canary-sweep.ts`. | **Low** |
| **R-09** | **Non-production email capture exposure & unimplemented raw-answer purge.** Test/PR stages capture rendered emails in D1 `captured_email`; `Policy.ts` lacks a 24-month purge cron for `submission`/`answer`. | Medium × Medium (**Medium**) | Non-prod stages never send real mail (`sendsRealEmail(stage)`), use synthetic test data in CI/E2E, and PR stages are destroyed on PR close (`preview.yml`). **Open action item:** implement configurable `Organization` raw-answer retention & purge job (`SPEC.md` §5.3) and automated D1 session/verification cleanup before enterprise GA. | `Email.ts`, `preview.yml`, `ropa.md` §4. | **Medium** *(tracked pre-GA action)* |

---

## 5. Review Cadence & Mandatory Re-Assessment Triggers

This DPIA **must** be reviewed and updated:
1. **Annually** (scheduled governance review).
2. **Before shipping Release 3 features** that materially change the risk profile: `attributed` or `confidential` `Anonymity mode`s, shared-link `Distribution`, nested `Team` roll-ups, Directory Sync (SCIM), or external exports/webhooks/MCP server (`SPEC.md` §5.3–5.7).
3. **Before any change to AI models, prompts, or routing** (`OpenRouterAiClient.ts`, ADR 0015), including any addition of non-EU endpoints or conversational "Ask your results" features.
4. **Following any Personal Data Breach** affecting `Organization` or D1 data (`breach-response-runbook.md`).

---

## 6. Residual Risk Evaluation & Sign-Off Template

Overall residual risk for Release 1 / Release 2 (`anonymous` mode, `invitation` distribution, opt-in EU ZDR AI) is assessed as **Low to Medium**, acceptable for operation subject to completing the pre-GA automated retention/purge implementation tracked in `ropa.md` §4.

| Role | Name | Decision (Approve / Approve with Conditions / Reject) | Conditions / Notes | Signature & Date |
| --- | --- | --- | --- | --- |
| **Product Owner** | | | | |
| **Engineering Lead** | | | | |
| **Data Protection Officer / Privacy Lead** | | | | |
| **Consulted Employee Representative (if applicable)** | | | | |
