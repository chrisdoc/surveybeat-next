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

1. **Vulnerable data subjects (workplace power imbalance):** `Team` members answer workplace check-ins initiated by `Lead`s or `Organization admin`s. Because of the employer–employee relationship, members cannot freely absorb risk if `Submission`s could be attributed to individuals.
2. **Innovative / automated text analysis (AI):** When an `Organization admin` enables `organization.ai_processing = 1`, redacted free-text comments and open `Action` titles are processed by an LLM (`anthropic/claude-haiku-5.5` via OpenRouter) to generate `Comment theme`s and a `Discussion guide`.
3. **Evaluation / scoring of Team dynamics:** Recurring weekly measurement across `Dimension`s (`workload`, `psychologicalSafety`, `clarity`, `recognition`) could cause chilling effects or informal retaliation if not strictly aggregated above a `Minimum group size`.

---

## 2. Systematic Description of Processing & Architecture (Art. 35(7)(a))

1. **Collection & Invitation:** `Organization` Durable Objects schedule weekly `Round`s (`round`, `round_member`, `round_question`), derive HMAC-signed `Invitation` tokens, store only `token_hash` in `invitation` (DO) and `invitation_index` (D1), and send emails via `EmailDelivery.ts` (`Cloudflare Email Sending` in `production` with `previewEnabled: false`).
2. **Answering Boundary (`SubmissionWorker`):** Answer links put the `Invitation` token in the URL fragment (`#t=`). The browser POSTs it in the JSON body to `SubmissionWorker` (`/exchange`, `/first-answer`), which runs with all observability channels disabled. `GET /delivery?token=` and `GET /api/reminders/unsubscribe?t=` on `MainWorker` still carry the token in the query string (issue #311). The browser generates an `Edit key` locally (`sb_edit_<roundId>`), transmits only its SHA-256 `edit_key_hash` on `/first-answer`, and uses the `Edit key` alone on `/answer`.
3. **Atomic Storage & Store-Time `Redaction`:** `recordFirstAnswer` (`SqlRounds.ts`) atomically inserts `(round_id, person_id)` into `participation`, creates a random 128-bit `submission` (`WITHOUT ROWID`, no `Person`, no time, no locale), and calls `redact` (`Redaction.ts`) on each comment before inserting into `answer`. That call runs in the `Organization` Durable Object on `MainWorker`. `SubmissionWorker` forwards the raw answers over Durable Object RPC (`SubmissionRoutes.ts`) and does not redact them. Raw comments are never persisted.
4. **Aggregation & Access Control:** When a `Round` closes, `RoundJobs.ts` computes `round_result` enforcing `effective_minimum_group_size` (default `4`, minimum `3`). `Organization admin`s without a `Team` `Membership` have zero access to `Result`s, comments, or `Action`s (ADR 0003).
5. **Optional AI Processing (`ai_processing`):** Off by default (`0`). When enabled (`1`) and the `Round` meets `Minimum group size`, `RoundJobs.ts` sends stored comment text (redacted at store time), each `Question`'s text, dimension, score, and change, `Dimension` scores and changes, and redacted titles of open `Action`s to OpenRouter (`google-vertex/europe` or `amazon-bedrock/eu-west-1` with `zdr: true`, `allow_fallbacks: false`, `data_collection: "deny"`). `Question` text is not redacted. `QuestionText` only checks that the string is trimmed and between 1 and 200 characters. It does not reject an email address, a name, or a `Team` or `Organization` name.

---

## 3. Necessity and Proportionality Assessment (Art. 35(7)(b))

- **Purpose Limitation:** SurveyBeat measures *team* health and supports *team* `Action`s (`SPEC.md` §1, §9). Individual performance evaluations and 360-degree reviews are explicitly out of scope (`SPEC.md` §9).
- **Data Minimization:**
  - `Pulse` editor recommends `<= 7` questions (`Policy.questions.recommended = 7`, hard cap `20`).
  - `participation` stores only `(round_id, person_id)` with no timestamp; `submission` stores only `(id, round_id, edit_key_hash)` with no `Person`, no `Invitation`, no timestamp, and no `locale`.
  - Release 1 supports only `anonymity_mode = 'anonymous'` and `distribution = 'invitation'`.
  - `Redaction` strips direct identifiers before disk write (ADR 0009).
- **Transparency & Member Controls:**
  - An `Invitation` states the `Minimum group size` and that the name is not stored with the answers (`packages/emails/src/messages/catalog.ts` `invitation.anonymity`). It mentions `Redaction` and AI only when `ai_processing` is on (`privacy.aiNotice`). The answer page states the `Minimum group size` (`answer.anonymity`), what comment `Redaction` removes and what it leaves (`answer.comment.disclosure` in `apps/web/src/messages/answer.ts`), and the AI notice when AI is on (`answer.aiNotice`). The 30-day backup window is on the in-app Privacy page only (`catalog.ts` `privacy.restore`).
  - `Team` members can opt out of reminders per `Pulse` (`pulse_reminder_opt_out`, RFC 8058 `GET /api/reminders/unsubscribe`) and clear browser-local history (`clearKeptAnswers`).

---

## 4. Risk Register & Technical/Organizational Mitigations (Art. 35(7)(c)-(d))

*Risk scale:* Likelihood / Severity rated `Low`, `Medium`, `High`, `Critical`.

| Risk ID | Threat & GDPR Harm | Inherent Risk (L × S) | Architectural & Procedural Mitigations (Implemented in Repo) | Verification / Evidence | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| **R-01** | **Re-identification of anonymous feedback via database links, insertion order, timestamps, or server logs.** A `Lead`, `Organization admin`, or operator correlates `Submission`s to `Person`s. | High × High (**Critical**) | **ADR 0005:** `submission` and `answer` are `WITHOUT ROWID`, use random 128-bit IDs, and have no `person`, `invitation`, `time`, or `locale` column. `participation` is `(round_id, person_id)`: it identifies the `Person` and is structurally separate from `submission` (no shared key, no timestamp). Answer links use `#t=`. `SubmissionWorker` accepts POST-body credentials only, rejects `token` + `editKey` together, and keeps `observability`, `logs`, `traces`, `logpush`, and `tailConsumers` off. Delivery and unsubscribe still put the token in the query string (R-07, issue #311). | `Submissions.privacy.test.ts` (A1, A2, A4, A4b, A10), `Unlinkability.privacy.test.ts`, `SubmissionRoutes.privacy.test.ts` (A5), `check-observability.ts`, `canary-sweep.ts`. | **Low** for the stored rows. Query-string tokens are R-07. |
| **R-02** | **Re-identification in small Teams, via live score updates, or subtraction attacks.** A `Lead` infers an individual's score by comparing sub-groups, small `Question` counts, or watching `Result`s update right after someone answers. | High × High (**Critical**) | **ADR 0004:** `Minimum group size` (`defaultValue: 4`, SQL `CHECK (minimum_group_size >= 3)`) applies per `Question` and per `Dimension` (`usableQuestionCount` excludes sub-`N` `Question`s to block subtraction). Each `Round` freezes `effective_minimum_group_size` so lowering `N` never reveals past `Round`s. No live `Result`s appear while a `Round` is `Open` (even above `2N`). Comments are gated on `Round` `Submission` count and unlinked from ratings. | `Results.privacy.test.ts` (P1, P2), `0004_teams.sql`, `0006_rounds.sql`. | **Low** |
| **R-03** | **Surveillance or cross-Team inspection by `Organization admin`s.** Executives or IT admins read raw comments or `Result`s for `Team`s they do not belong to. | Medium × High (**High**) | **ADR 0003 & ADR 0014:** `person.organization_admin` grants directory/settings administration only. Viewing any `Team`'s `Result`s, comments, or `Action`s requires an active `Membership` in that `Team` (`Permissions.ts`), visible to the `Team` roster. | `Permissions.test.ts`, `0003_person.sql`, `0004_teams.sql`. | **Low** |
| **R-04** | **Free-text PII and third-party naming in comments.** A `Team` member names a colleague, enters an email, phone, handle, or URL, or leaves identifying context. | High × Medium (**High**) | **ADR 0009:** Synchronous rule-based `redact` (`Redaction.ts`) runs in the `Organization` Durable Object (`SqlRounds.ts`) before the SQLite insert, after `SubmissionWorker` has forwarded the raw answers. It replaces email local parts of at least 2 characters from the directory roster (`person` stores email and no display name), emails, phone numbers, `@handles`, and URLs with placeholders. A shorter local part can remain when it appears as a word. Raw text is never stored or logged. `Lead`s cannot link comments to ratings or `Submission` order. *(Limitation: a display name that is not in an email local part, a nickname, or a unique anecdote is not removed. The answer page says so.)* | `Redaction.privacy.test.ts`, `Submissions.privacy.test.ts` (A4b), `answer.ts` (`answer.comment.disclosure`). | **Medium** *(the answer-page disclosure says what is left in, and themes are a further abstraction)* |
| **R-05** | **Free-text PII leakage, prompt retention, or cross-border transfer to AI sub-processors.** Comments sent to an LLM are logged, retained for 30 days, trained on, or routed outside the EEA. | High × High (**Critical**) | **ADR 0015, ADR 0016, ADR 0019:** `organization.ai_processing` defaults to `0` (off). When enabled: (1) the payload is stored comment text, `Question` text, each `Question`'s dimension, score, and change, `Dimension` scores and changes, and redacted open `Action` titles (`buildThemesInput`). It has no dedicated field for a `Person` ID, an email address, a `Team` name, an `Organization` name, or a timestamp. `Question` text is not redacted, and `QuestionText` does not reject those identifiers, so any of them typed into a `Question` is sent. Comment name redaction uses email local parts of at least 2 characters, not a display-name column. A shorter local part can remain when it appears as a word. The **Medium** residual below assumes authors keep personal data out of `Question` text. Nothing in the schema enforces that. (2) `OpenRouterAiClient.ts` pins `provider.zdr: true`, `only: ["google-vertex/europe", "amazon-bedrock/eu-west-1"]`, `allow_fallbacks: false`, `data_collection: "deny"`. It returns `AiNotConfigured` only when `OPENROUTER_API_KEY` is missing or empty; a non-empty rotated key still sends. (3) OpenRouter account prompt/output logging and training opt-ins are disabled. (4) Response and error bodies (for example moderation `403` echoes) are never logged. (5) `Comment theme`s require `>= 2` supporting comments and pass a 6-word anti-quote check. *(Caveat: upstream ZDR is not "OpenRouter keeps nothing". OpenRouter may retain content flagged as potential CSAM, including ZDR traffic; reported material is kept for one year under 18 U.S.C. § 2258A. Account and abuse metadata can be processed in the US. See `docs/research/openrouter-muse-ember.md` §6.)* | `OpenRouterAiClient.test.ts`, `Themes.privacy.test.ts`, `0011_ai_processing.sql`. | **Medium** |
| **R-06** | **Point-in-time restore (PITR) correlation attack.** Restoring a Durable Object to a prior timestamp replays transaction order, correlating a `participation` insert with its `submission`. | Low × High (**Medium**) | **ADR 0005:** Explicitly excluded from the cryptographic at-rest guarantee. Mitigated by restricting PITR restores exclusively to named, credentialed infrastructure operators (zero access for `Organization admin`s or `Lead`s), strict **30-day** backup expiry (`Policy.backupRetentionDays = 30`), and plain-language disclosure on the `Privacy` page (`catalog.ts` `privacy.restore`, `privacy.restoreTrigger`). | `Policy.ts`, `catalog.ts`, `docs/adr/0005-anonymous-submission-storage.md`. | **Low** |
| **R-07** | **Email scanner pre-fetching or log leakage of `Invitation` tokens.** Corporate link scanners open URLs in emails, Cloudflare email logs retain `Invitation` links, or a query-string token reaches `MainWorker` logs or a `Referer`. | Medium × Medium (**Medium**) | **ADR 0007 and ADR 0005:** One-tap answer links pass the `Invitation` token in the URL fragment (`#t=`) and only pre-select the rating in the browser; a `Submission` requires an explicit browser POST. `ProductionEmail` sets `previewEnabled: false` (`Email.ts`) so Cloudflare does not retain email previews containing `Invitation` links. **Still open (issue #311):** `GET /delivery?token=` and `GET /api/reminders/unsubscribe?t=` send the live token on the query string to `MainWorker`. Fragment transport and `previewEnabled: false` do not cover that path. Workers Logs on `MainWorker` and `Referer` can see it. | `Email.ts`, `InvitationEmail.tsx`, `ReminderEmail.tsx`, `PageRoutes.ts`, `SubmissionRoutes.privacy.test.ts`, issue #311. | **Medium** until #311. The fragment answer link alone would be **Low**. |
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

Overall residual risk for Release 1 / Release 2 (`anonymous` mode, `invitation` distribution, opt-in EU ZDR AI) is assessed as **Low to Medium**, acceptable for operation subject to completing the pre-GA automated retention/purge implementation tracked in `ropa.md` §4. That overall rating assumes `Question` text contains no personal data. R-05 is **Medium** because `QuestionText` does not enforce the assumption.

| Role | Name | Decision (Approve / Approve with Conditions / Reject) | Conditions / Notes | Signature & Date |
| --- | --- | --- | --- | --- |
| **Product Owner** | | | | |
| **Engineering Lead** | | | | |
| **Data Protection Officer / Privacy Lead** | | | | |
| **Consulted Employee Representative (if applicable)** | | | | |
