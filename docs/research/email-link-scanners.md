# Email link scanners and one-tap answer links

Research for issue #11 (map #1). This is throwaway research and will not be merged.
Context: SPEC.md §5.1 says "In email, each rating value is a link that records the answer and opens the remaining questions." §5.2 says the answer page needs no sign-in when opened from an invitation token. §5.3 restricts what the submission path may store and log.

Researched 2026-11-07. Each claim cites its source. Claims marked *(secondary)* come from a GitHub issue, a forum, or a search-index summary, not from vendor documentation.

## TL;DR

1. **Scanners request every link in the message, often before the member sees it.** Microsoft Defender scans URLs before delivery and detonates URLs that lack a reputation. Mimecast and Proofpoint sandbox suspicious messages before delivery. All of them, Barracuda and Gmail included, also check the link when it is clicked. A rating email with five links can therefore get five "answers" within seconds.
2. **Scanners send GET and HEAD, and some run a full headless Chrome that executes JavaScript.** Microsoft's requests have been observed from AS8075 with a HeadlessChrome user agent and no cookies *(secondary)*. Running JavaScript on page load is therefore not proof that a human is there. Field reports agree that scanners do not submit forms or click buttons, but no vendor guarantees it.
3. **HTTP itself rules this out.** RFC 9110 says a resource whose URI selects an unsafe action "MUST disable or disallow that action when it is accessed using a safe request method." RFC 8058 introduced POST for one-click unsubscribe for exactly this reason.
4. **Vendors that record the answer on the click get scanner answers.** SurveyMonkey records on click only if you opt in, and its docs warn that scanner bots then answer first. Qualtrics documents the same failure and sells a fix based on reCAPTCHA v3. Medallia gates its auto-save behind bot detection plus a real user interaction. Magic-link providers have moved to codes (WorkOS), bot detection (Stytch), or a GET page plus POST (Supabase, Auth.js, several OSS projects).
5. **Recommendation for SurveyBeat:** the rating link GET opens the answer page with the tapped value preselected and writes nothing. The answer is saved by a POST that a real interaction triggers. It never fires on page load alone. Answer HEAD requests with a 200 that has no side effects. Keep scanner heuristics as a secondary signal for metrics only, never as the gate. Do not store a "tentative" answer on the server. Details follow.

## 1. How the scanners behave

### Microsoft Defender for Office 365 Safe Links

Source: [Safe Links overview](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about) (updated 2026-10).

- **Pre-delivery scan of every message:** "As long as Safe Links protection is turned on, URLs are scanned prior to message delivery, regardless of whether the URLs are rewritten or not."
- **Detonation:** "URLs that don't have a valid reputation are detonated asynchronously in the background." A new survey domain with per-recipient token URLs is exactly the kind of URL that lacks a reputation.
- **Delivery can wait for the scan:** the recommended setting is "Wait for URL scanning to complete before delivering the message". "Messages are delivered only after the URLs are confirmed to be safe."
- **Click-time check:** links are rewritten to `*.safelinks.protection.outlook.com`. "If a users clicks a rewritten link, it's scanned for malicious content before directing the user to the page." In API-only mode, Outlook clients call Safe Links when the user clicks. The member's own click can therefore cause a second fetch by the scanner just before the browser request.
- **Built-in protection preset:** this preset applies Safe Links to every recipient in any tenant with at least one Defender for Office 365 license, even if no policy was configured. Assume it is on for most Microsoft 365 business customers.
- **Allowlisting:** each policy has a "Do not rewrite the following URLs" list, but its entries "might still be blocked at time of click". The Tenant Allow/Block List covers both delivery and click time. Both are tenant-admin actions, so we cannot rely on them.
- **Methods and fingerprint *(secondary)*:** Auth.js says Safe Links "send a HEAD request to each link in the Email" ([Auth.js tutorial](https://next-auth.js.org/tutorials/avoid-corporate-link-checking-email-provider)). An emdash bug report logged GETs from Microsoft's AS8075 with a headless Chrome user agent and no cookies. The report later saw four GET and HEAD requests within about 90 seconds ([emdash#3298](https://github.com/emdash-cms/emdash/issues/3298)). Microsoft does not publish the scanner's IP ranges or user agents.
- **Real-world precedent *(secondary)*:** in a Microsoft Tech Community thread, Safe Links scans were unsubscribing users from lists. Another participant reported that the scanning "triggered satisfaction ratings in their service desk software" ([thread](https://techcommunity.microsoft.com/discussions/microsoft-security/atp-safe-links-are-automatically-unsubscribing-users-from-email-lists/205278/replies/207403)). That second report is the SurveyBeat failure mode.

### Mimecast URL Protect

- Mimecast "performs a deep scan of suspicious links in emails before the user clicks on them" and holds or rejects messages with malicious links. A 2025 service update enabled URL Pre-Delivery Action, set to Hold, for all customers from 2025-11-18. Mimecast also scans the URL again at click time ([Mimecast support: URL Pre-Delivery Action, Oct 2025](https://mimecastsupport.zendesk.com/hc/en-us/articles/43671505743123); the page returned 403 to our fetcher, so these quotes come from the search index *(secondary)*).

### Proofpoint URL Defense / TAP

- "hold suspicious messages with URLs for sandbox analysis … Our sandbox technology conducts an exhaustive analysis of the URL using static and dynamic analysis." Also: "URLs in delivered messages are re-written and sandboxed at time of click" ([Proofpoint blog](https://www.proofpoint.com/us/blog/email-and-cloud-threats/malicious-links-stop-url-based-attacks-before-they-start)). Rewritten links use the `urldefense.com` and `urldefense.proofpoint.com` prefixes. The page does not say that Proofpoint fetches every message before delivery, only suspicious ones.

### Barracuda Email Gateway Defense Link Protection

- Barracuda rewrites URLs to `linkprotect.cudasvc.com`. "Each time a URL is clicked its status is verified before the redirect is allowed." It also has a "specialized sandbox engine." The page does not say whether URLs are fetched at delivery ([Barracuda: Understanding Link Protection](https://documentation.campus.barracuda.com/wiki/spaces/EGD/pages/2850935/Understanding+Link+Protection)).

### Gmail / Google Workspace

- Google documents click-time checks: "IMAP link protection checks links when the recipient clicks a message link, but before they're redirected to the link" ([Workspace admin help](https://knowledge.workspace.google.com/admin/sync/protect-users-from-suspicious-links-in-imap-email-clients?hl=en)). The checks draw on Safe Browsing reputation ([Workspace Updates 2017](https://workspaceupdates.googleblog.com/2017/05/making-email-safer-with-Gmail-click-time-security-checks.html)). Google publishes no pre-delivery fetch of every link. Workspace does have an optional "security sandbox" setting for attachments. In our sources Gmail is the least aggressive of the scanners, but the endpoint must not depend on that.

### Apple Mail Privacy Protection

- MPP fetches remote content through a proxy. It hides the IP address and "prevents senders from seeing if you've opened the email." It does **not** follow links: "Mail Privacy Protection does not extend to links or email attachments" ([Apple iPhone User Guide](https://support.apple.com/guide/iphone/use-mail-privacy-protection-iphf084865c7/ios)). It affects open tracking only. Answer links are safe from MPP, but never derive anything from image loads.

### Summary table

| Scanner | Pre-delivery fetch | Click-time fetch | Runs JS | Notes |
|---|---|---|---|---|
| MS Defender Safe Links | Yes, every message; detonates unknown URLs | Yes (rewritten link or Outlook API) | Yes, headless Chrome observed *(secondary)* | On by default via Built-in protection |
| Mimecast | Suspicious messages; Hold is default since Nov 2025 | Yes, rescan | Sandbox | |
| Proofpoint | Suspicious messages, static + dynamic analysis | Yes, sandboxed | Sandbox (dynamic) | |
| Barracuda | Not documented | Yes | Sandbox engine, scope unclear | |
| Gmail | Not documented for links | Yes, reputation | Not documented | |
| Apple MPP | Images and remote content only | No | No | Breaks open tracking, not links |

**Timing:** pre-delivery fetches arrive before or within seconds of delivery. Click-time fetches arrive milliseconds before the member's own request, often from a different IP and user agent. Several commercial bot-click filters use bursts as their signal: many links fetched within a few seconds of delivery ([Maestra](https://help.maestra.io/campaigns/filtering-out-fake-clicks-keeping-your-click-rate-clean), [Paminga](https://www.paminga.com/blog/enhanced-bot-click-filtering/) *(secondary)*).

## 2. Standards

- **RFC 9110 §9.2.1 (Safe Methods).** GET and HEAD are safe, so that "automated retrieval processes (spiders) and cache performance optimization (pre-fetching) [can] work without fear of causing harm." "When a resource is constructed such that parameters within the target URI have the effect of selecting an action … the resource owner MUST disable or disallow that action when it is accessed using a safe request method." Recording an answer from `GET /a/<token>?q1=4` violates this ([RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.1)).
- **RFC 8058 (one-click unsubscribe).** The RFC gives its reason: "anti-spam software often fetches all resources in mail header fields automatically, without any action by the user." The sender therefore adds `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and the mail client sends a POST with that body to the HTTPS `List-Unsubscribe` URI, and only with the user's consent. The POST carries no cookies or auth. The endpoint must not redirect, because browsers turn a redirected POST into a GET. Both headers must be covered by a valid DKIM signature. The URI should carry an opaque token that identifies the recipient and the list ([RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.html)).
- **Gmail bulk sender rules.** Senders of more than 5,000 messages a day must support one-click unsubscribe (RFC 8058) for "marketing messages and subscribed messages", and must also have a visible unsubscribe link in the body ([Google sender guidelines](https://support.google.com/a/answer/81126)).

**How RFC 8058 relates to us.** It is the same problem with the same fix. Any state change goes behind POST, and the GET form (the body link) shows a confirmation page. For SurveyBeat:
- Pulse invitations and reminders arguably count as "subscribed messages". Send `List-Unsubscribe` + `List-Unsubscribe-Post` headers that point at a POST-only endpoint that turns reminders off (§5.1 "A member can turn reminders off"). Answer GET on that URI with a confirmation page. Do not redirect the POST. Sign both headers with DKIM. Without these headers, Gmail and Yahoo bulk-sender enforcement will hurt deliverability once volume exceeds 5,000 a day.
- The answer link cannot use RFC 8058's mechanism, because that mechanism is header-only and its POST is sent by the mail client. Only the principle carries over.

## 3. What other products do

### Survey and NPS vendors

- **SurveyMonkey: opt-in record-on-click with a documented downside.** "In-email Response Capture" is **off by default**. With it off, the embedded answer "saves the first response upon clicking Next or Done". With it on, "email scanner bots could click the links within your email invitation … These bot clicks record responses to the embedded question before your respondent sees the email." A later real answer replaces the bot's answer. SurveyMonkey's own advice: if response quality matters, "don't enable In-email response capture." ([SurveyMonkey help: Embedding questions](https://help.surveymonkey.com/en/surveymonkey/send/embedding-questions/)).
- **Qualtrics: documents the failure and sells a fix.** Its docs say "Some email providers may test links contained in emails, causing your inline email question to be answered" before the respondent sees it, which leaves responses with only the first choice. Its fix is **Security Scan Monitor** (Fraud Detection licence), which "uses reCAPTCHA V3 to identify when the survey is being tested by email security scanners". "If a bot is detected, a start page will be shown instead of the first question". A human who was wrongly flagged clicks Next ([Qualtrics: Email invitations](https://www.qualtrics.com/support/survey-platform/distributions-module/email-distribution/emails/emails-overview/), [Qualtrics: Fraud Detection](https://www.qualtrics.com/support/survey-platform/survey-module/survey-checker/fraud-detection/)). Without the licence, Qualtrics tells customers to ask recipients' IT to allowlist Qualtrics.
- **Medallia: two layers.** Quick Start surveys now stop auto-save "from being triggered by email clients, link-preview bots, and security scanners". Layer 1 is automated traffic detection of known scanners. Layer 2 is **interaction gating**: for visitors not recognised as scanners, auto-save fires only after a real user interaction (click, scroll, keypress), not on page load. The rollout runs July–August 2026 ([Medallia Experience Cloud release notes 2026 H2 1](https://docs.medallia.com/en/medallia-experience-cloud/release-notes/medallia-experience-cloud-release-notes/2026-h2-1-e698); the page blocks automated fetchers, so this summary comes from the search index *(secondary)*). Medallia's older Agile Research docs show the naive pattern: each answer is a plain `href="survey-url&q1=1&as=1"` ([Medallia: embedding survey questions](https://docs.medallia.com/medallia-agile-research/distribution/emails/embedding-survey-questions-in-emails)).
- **Delighted:** we found no primary documentation. `help.delighted.com` no longer resolves, because Qualtrics is sunsetting Delighted.
- **Other platforms *(secondary)*:** a Qualtrics community poster's security team had them remove inline questions entirely. Simplesat and Ternair detect bot clicks by requiring JavaScript to load. Section 1 shows that this check is too weak against Defender.

### Magic-link authentication providers

The failure here is the opposite one: the scanner *burns* a single-use token, so the human gets "expired".
- **WorkOS** deprecated Magic Link: it is "not recommended due to issues with email clients or other security software visiting the links … it can cause the Magic Links to expire before they reach the user's inbox". It moved to Magic Auth, a 6-digit code with a 10-minute expiry ([WorkOS Magic Link](https://workos.com/docs/magic-link.md), [Magic Auth](https://workos.com/docs/authkit/magic-auth)).
- **Stytch:** "Most security scanners will inspect and click on any links present in emails". Stytch uses device intelligence so that a scanner click is not treated as an authentication attempt: "the token is not consumed, and a session is not granted" ([Stytch B2B magic links](https://stytch.com/docs/b2b/guides/magic-links/overview)).
- **Supabase:** prefetching is "the most common reason" for `otp_expired`. Supabase suggests a code flow, or a link that "only directs the user to a page to *enter* the OTP, rather than consuming it directly" ([Supabase troubleshooting](https://supabase.com/docs/guides/troubleshooting/otp-verification-failures-token-has-expired-or-otp_expired-errors-5ee4d0)).
- **Auth.js / NextAuth:** return 200 to HEAD before any logic runs ([tutorial](https://next-auth.js.org/tutorials/avoid-corporate-link-checking-email-provider)). This handles only HEAD-only scanners.
- **OSS fixes *(secondary)*:** emdash ([#3298](https://github.com/emdash-cms/emdash/issues/3298)) and Fluent Security ([PR #121](https://github.com/WPManageNinja/fluent-security/pull/121)) both changed GET so it renders a page and only POST redeems the token, on the reasoning that "A scanner fetches but does not submit forms." Fluent Security also auto-submits with JS unless `navigator.webdriver` is set. It notes the gap: "A sandbox that runs JavaScript and hides `navigator.webdriver` can still spend the link."

## 4. The candidate patterns compared

| Pattern | Stops scanner answers? | Cost to the member | Notes |
|---|---|---|---|
| Record on GET | No | None | What SurveyMonkey and Qualtrics warn about. Violates RFC 9110. |
| 200 on HEAD only | Only for HEAD-only scanners | None | Necessary but not enough. Defender also sends GET. |
| Record on GET as "tentative", overwritten by a later real answer (SurveyMonkey style) | No. The scanner's value stays if the human never acts | None | Scanners hit every value link, so the tentative value is arbitrary. In anonymous rounds it puts a token-linked server write on a GET path (§5.3). Reject. |
| GET page + JS POST on load | Partly. Defender runs headless Chrome | None | Fails against the scanner most likely to hit B2B inboxes. |
| JS POST on load unless `navigator.webdriver` / headless | Mostly | None | Bypassable by stealthy sandboxes, as the Fluent PR admits. |
| **GET page + save on first real interaction (interaction gating)** | **Yes**, under the observed behaviour that scanners do not interact | Nearly none. The member is already tapping or scrolling through the remaining questions | Medallia layer 2. Strongest pattern that keeps one tap. |
| GET page + explicit "Confirm" button | Yes | One extra tap | Strictest. Fallback when the remaining questions are empty or bot suspicion is high. |
| Bot detection (reCAPTCHA v3, ASN/UA lists, burst heuristics) as the gate | Probabilistic | False positives cost a real answer, or need a start page (Qualtrics) | Third-party script on the answer page conflicts with the anonymity stance and the under-1-second load target. Use only as a signal. |
| Short-lived or single-use tokens | Make it **worse** | Links die | Scanners fetch first, so the human gets "expired". The opposite of what we need. The spec already lets members edit until the round closes (§5.2). |
| Allowlisting by customer IT | Yes, where IT does it | Admin work | Document it for enterprise customers. It is not a design. |

## 5. Recommendation for SurveyBeat

1. **The rating link GET is side-effect free.** `GET /a/<invitation-token>?q=<question>&v=<value>` renders the answer page with value `v` preselected and stores nothing on the server. It does not consume, rotate, or expire the token. Answer `HEAD` with `200` and an empty body. The page itself is the "opens the remaining questions" part of §5.1.
2. **Save the first answer with a POST triggered by a real interaction.** The page holds the preselected value in client state. It sends the POST on the member's first trusted interaction (`pointerdown`, `keydown`, or a scroll with `event.isTrusted`), on "Next" or "Submit", or on an explicit "Save my answer" control that is always visible above the fold. Do not POST on `load`, `DOMContentLoaded`, `visibilitychange`, or a timer. A member who taps 4, sees "4 saved? Tap to confirm or continue", and leaves without touching the page loses that answer. Accept that loss knowingly: it is the price of not counting a scanner as a voter.
   - Spec wording consequence: §5.1 "each rating value is a link that records the answer" should become something like "each rating value is a link that opens the answer page with that value chosen. The answer is saved on the member's first interaction there." This is a product-owner decision. Raise it on the map.
3. **The same rule covers every token-bearing GET:** the answer page, the reminder opt-out, and the history page. A GET never writes. This is also simpler to reason about for the §5.3 logging rules.
4. **Use one-click unsubscribe for reminders under RFC 8058:** a POST-only endpoint, no redirect, DKIM-signed headers, and a body link that opens a confirmation page. This is required once volume exceeds 5,000 a day to Gmail.
5. **Use scanner heuristics as telemetry, not as the gate.** Useful signals: more than one distinct `v` requested for the same token within about 60 seconds (a human taps one value, a scanner fetches all of them), HEAD requests, a HeadlessChrome user agent, a Microsoft ASN, and fetches within seconds of send. Use them to report "link opened by a scanner" separately from real opens in response-rate metrics. Keep them away from submission records. §5.3 forbids logging IP together with the token or submission, so compute the signal at the edge and log only the aggregated, token-free flag.
6. **No bot-detection third party on the answer page.** reCAPTCHA-style scoring adds a Google script and fingerprinting to an anonymous answer flow. It would undercut §3 and §5.3 and the under-1-second budget in §5.2. Interaction gating needs no third party.
7. **Test plan for later tickets:** a unit or integration test that GET and HEAD on an answer URL cause zero writes. A Playwright test in headless Chromium that loads the answer URL, does not interact, and asserts zero POSTs. A manual end-to-end send to a Microsoft 365 tenant with Defender on that checks logs show scanner GETs and no stored answers.

## 6. Open questions and gaps

- Microsoft, Mimecast, Proofpoint and Barracuda do not document whether their sandboxes interact with a page (click buttons, fill forms). The claim that scanners don't submit forms rests on field reports. A cheap check: send real pulses to a Defender tenant and record what arrives at the server.
- The Medallia and Mimecast details come from search-index summaries, because both sites block automated fetchers. Confirm them in a browser if a decision depends on them.
- We found no Delighted primary sources.
- Do pulse invitations count as "subscribed messages" for Gmail's one-click rule? We assume they do, as the safe choice.
