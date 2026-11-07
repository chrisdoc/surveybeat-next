# Cloudflare Email Service for SurveyBeat transactional email

Research for issue #6 (map #1). Question: can Cloudflare Email Service send SurveyBeat's Invitations, reminders and results-ready notices from a Worker, and if not, what is the fallback (SPEC §6.1)?

All sources were read on 2026-11-07. Dates in brackets are the "last updated" date on the page, where shown.

## Short answer

Yes, with caveats. Email Sending is in **public beta** since 2026-04-16, on Workers Paid only. It has what SurveyBeat needs: a Worker binding, automatic SPF/DKIM/DMARC, bounce and complaint events delivered to a Cloudflare Queue, automatic suppression lists, and `List-Unsubscribe` / one-click headers. It costs about nothing at SurveyBeat's volume ($0.35 per 1,000 after 3,000 a month).

The risks are beta status, an unpublished starting daily quota, no documented dedicated-IP or IP-pool option, a transactional-only policy, and the sending domain must be on Cloudflare DNS. Recommendation: build on Cloudflare, behind an `EmailSender` domain interface, and keep **Postmark** (or Resend) as the named fallback. Decide go or no-go with a seed-inbox deliverability test and a quota check before the first external customer.

## 1. Status and availability

- **Public beta since 2026-04-16.** "Email Sending is now in public beta. Send transactional emails directly from Workers (`env.EMAIL.send()`) or the REST API." It joined Email Routing under the name "Cloudflare Email Service". <https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/>
- Private beta was announced 2025-09-25. <https://blog.cloudflare.com/email-service/>
- The overview page still says beta, with "features and APIs may change before general availability". Arbitrary-recipient sending requires Workers Paid. <https://developers.cloudflare.com/email-service/>
- No GA announcement appears in the product changelog. Its latest entry is dated 2026-09-25 (page updated Oct 15, 2026). <https://developers.cloudflare.com/email-service/platform/changelog/>
- Changes since the public beta that matter here:
  - 2026-05-28: display names on all address fields.
  - 2026-06-08: authenticated SMTP on `smtp.mx.cloudflare.net:465`, also beta.
  - 2026-07-15: Email Sending events published to Queues.
  - 2026-07-17: message preview in the Activity log, kept about 7 days.
  - 2026-09-25: suppressions can be scoped to one sending domain, and automatic bounce and complaint suppressions now use that scope.
- **Transactional only.** The FAQ asks "Can I use Email Service for marketing emails?" and answers "No. Email Service supports transactional email only." [Oct 15, 2026] <https://developers.cloudflare.com/email-service/reference/faq/>. Cloudflare gives no definition. AWS defines transactional as "sent on a one-to-one basis unique to each recipient usually triggered by a user action" (<https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html>). Invitations and reminders for a pulse the organization set up should qualify: each one is unique to the person, carries a personal token, and is sent to employees of the customer. Confirm this with Cloudflare during the limit-increase request.

## 2. API from a Worker

Source: <https://developers.cloudflare.com/email-service/api/send-emails/workers-api/>

- Binding: `"send_email": [{ "name": "EMAIL" }]`. Bindings can be restricted to allowed senders and recipients. <https://developers.cloudflare.com/email-service/configuration/send-bindings/>
- `env.EMAIL.send({ to, from, subject, html?, text?, cc?, bcc?, replyTo?, attachments?, headers? })` returns `Promise<{ messageId }>`. Addresses can be `string` or `{ email, name }`.
- No API key is needed inside the Worker, because the binding is the credential. Outside Workers there is a REST API (`POST https://api.cloudflare.com/client/v4/accounts/{account_id}/email/sending/send`, with an API token) and SMTP. All three share one pipeline and one set of limits. <https://developers.cloudflare.com/email-service/api/send-emails/rest-api/>
- Errors are thrown as `Error` with a `code`. The ones SurveyBeat must map to typed Effect errors are:
  - `E_RATE_LIMIT_EXCEEDED` and `E_DAILY_LIMIT_EXCEEDED`: retry later through the Queue.
  - `E_RECIPIENT_SUPPRESSED`: permanent. Show it in the lead's view (SPEC §7, "Failed sends show up in the lead's view with the reason").
  - `E_DELIVERY_FAILED`, `E_SENDER_NOT_VERIFIED`, `E_ACCOUNT_SUSPENDED`, and the `E_HEADER_*` validation codes.
- `send()` accepting the message is not delivery. Delivery outcome arrives asynchronously as an event (§5).
- Local dev: `wrangler dev` simulates sending. <https://developers.cloudflare.com/email-service/observability/local-development/sending/>
- Alchemy (SPEC §6.1 IaC) has a `Cloudflare.Email.SendEmail` binding descriptor (`allowedSenderAddresses`, …) and a `SendingSubdomain` resource. <https://alchemy.run/cloudflare/email>, <https://alchemy.run/cloudflare/email/send-and-receive>. Its docs do **not** show a resource for the Queues event subscription on Email Sending events. That subscription may need a custom Alchemy resource or an API call in the deploy, to keep the "no dashboard changes" rule.

## 3. Volume limits

Source: <https://developers.cloudflare.com/email-service/platform/limits/> [Oct 30, 2026]

| Limit | Value |
| --- | --- |
| Daily quota | **Not published.** "New accounts start with a conservative daily quota and scale up over time based on your sending behavior, deliverability rates, and account standing." Increases go through a Limit Increase Request Form. |
| Per-second rate | Not published. `E_RATE_LIMIT_EXCEEDED` exists. |
| Recipients per message | 50 (to + cc + bcc). SurveyBeat sends one message per person anyway, because every Invitation carries its own token. |
| Message size | 25 MiB including attachments |
| Custom headers | 16 KB total; max 20 allowlisted non-`X-` headers; values ≤ 2,048 bytes |
| Sending domains per zone | 30 (routing and sending combined) |
| Before a domain is onboarded | Only verified destination addresses can receive mail |

**What this means for SurveyBeat.** The quota is per account, and a "Monday 9:00 local time" round makes the send bursty. Before launch, file the limit-increase request with an expected peak per day. The Workflow that sends invitations in batches must treat the two limit errors as retryable, using Queue delay or backoff, and must not drop sends silently (SPEC §7).

## 4. Domain setup: SPF, DKIM, DMARC

Sources: <https://developers.cloudflare.com/email-service/get-started/send-emails/>, <https://developers.cloudflare.com/email-service/concepts/email-authentication/>, <https://developers.cloudflare.com/email-service/reference/postmaster/>, <https://developers.cloudflare.com/email-service/configuration/subdomains/> [Oct 15, 2026]

- **Requires Cloudflare DNS**: "You must be using Cloudflare DNS to use Email Service." Alchemy's `SendingSubdomain` docs mention fetching the records for zones not on Cloudflare DNS. That conflicts with Cloudflare's page, so treat Cloudflare's statement as authoritative.
- Onboarding a sending domain (apex or subdomain) adds these records:
  - MX records on `cf-bounce.<domain>`, for the bounce return path.
  - SPF `TXT cf-bounce.<domain> "v=spf1 include:_spf.mx.cloudflare.net ~all"`. SPF sits on the bounce subdomain, so SPF alignment with the From domain is relaxed (organizational domain).
  - DKIM at `cf-bounce._domainkey.<domain>`. Cloudflare generates and manages the keys.
  - DMARC at `_dmarc.<domain>`. The doc example is `p=quarantine`, and the doc advises starting at `p=none`.
- Outbound mail is always SPF- and DKIM-signed, and ARC-signed as well. `List-Unsubscribe` is always included in the DKIM signature.
- Each subdomain is a separate sending domain. Cloudflare recommends separate subdomains for different mail types. <https://developers.cloudflare.com/email-service/concepts/deliverability/>
- Suggested setup: send from `notify.surveybeat.<tld>` (or similar), keeping the apex free for people mail. Use a separate subdomain per environment (staging vs production) so preview stages never touch production reputation.
- Gmail's rules for bulk senders (5,000+ per day) are SPF, DKIM and DMARC, From aligned with SPF or DKIM, spam rate below 0.30% (target 0.10%), and one-click unsubscribe for marketing or subscribed mail. Cloudflare's automatic records meet the authentication part. <https://support.google.com/a/answer/81126>

## 5. Bounces, complaints, suppression

- **Events to a Queue** (since 2026-07-15): `message.delivered`, `message.deferred`, `message.bounced` (permanent, or retries exhausted), `message.failed` (internal or non-SMTP error), `message.rejected` (policy: suppression, validation, spam), `message.complained` (feedback loop). Each subscription covers one sending domain. The payload has `messageId`, `recipient`, `delivery.status`, the SMTP codes, and a `bounce.type`/`classification`. <https://developers.cloudflare.com/email-service/reference/event-subscriptions/> [Oct 15, 2026]
  - This fits SPEC §6.2 directly: a Queue consumer Worker joins `messageId` to the Invitation and records the failure reason for the lead's view. There are no webhooks to verify.
- **Automatic suppression**, scoped to the sending domain (2026-09-25):
  - Complaint: no expiration.
  - Hard bounce for a nonexistent mailbox or domain, or a hard bounce that persists: no expiration.
  - Other hard bounce: 7 days.
  - Soft bounce: 24 hours.

  Manual entries can be added through a REST API (`/accounts/{id}/email/sending/suppressions`). <https://developers.cloudflare.com/email-service/concepts/suppressions/> [Sep 25, 2026]
- **Drop suppressed recipients** is off by default, so `send()` throws `E_RECIPIENT_SUPPRESSED`. Keep it off: a loud failure is what SPEC §7 asks for.
- Hard bounces are not retried. Soft bounces retry with exponential backoff. Cloudflare's targets are delivery above 95%, hard bounce below 2%, and complaints below 0.1%. <https://developers.cloudflare.com/email-service/concepts/deliverability/>
- An example shows how to sync app recipient records after bounces and complaints. <https://developers.cloudflare.com/email-service/examples/email-sending/sync-recipient-records/>

## 6. Deliverability and reputation

- Cloudflare says it runs managed infrastructure "optimized for deliverability". It publishes outbound ranges in `_spf.mx.cloudflare.net` (example `ip4:104.30.0.0/20`), IPv6 support, PTR records, and RBL monitoring. <https://developers.cloudflare.com/email-service/reference/postmaster/>
- Not documented: dedicated IPs, separate IP pools for transactional mail, or any public inbox-placement figures. Reputation is effectively shared with every other Email Service sender, and the product is 7 months into public beta. This is the main unknown, and only a test settles it (see Recommendation).
- No open or click tracking is documented, and Cloudflare does not rewrite links. The deliverability page advises linking only to your own domain, and avoiding redirects and shorteners. <https://developers.cloudflare.com/email-service/concepts/deliverability/>
  - This is good for one-tap links.
  - It also means the "open rates" in SPEC §6.2 (Analytics Engine) cannot come from the provider. SurveyBeat would need its own pixel, which is a privacy call. "Answered" is a better metric anyway.
- Support during the beta runs through the community forum and Discord. <https://developers.cloudflare.com/email-service/reference/postmaster/>

## 7. Cost

- Workers Paid: **3,000 emails a month included, then $0.35 per 1,000**. Sends to verified destination addresses are free. [Jun 9, 2026] <https://developers.cloudflare.com/email-service/platform/pricing/>
- Example: an organization of 500 people on a weekly pulse sends about 1 invite, up to 2 reminders and a few lead notices per round. That is roughly 5–7k emails a month, or about $1–1.50 a month above the included amount.

## 8. One-tap links and List-Unsubscribe

**List-Unsubscribe is supported.** `List-Unsubscribe`, `List-Unsubscribe-Post`, `List-Id`, `Precedence`, `Auto-Submitted` and any `X-` header are allowlisted. <https://developers.cloudflare.com/email-service/reference/headers/>

- `List-Unsubscribe` needs angle-bracketed URIs, and plain `http:` is rejected.
- `List-Unsubscribe-Post` must be exactly `List-Unsubscribe=One-Click` and requires an HTTPS URI (RFC 8058).
- A request containing any disallowed header is rejected as a whole.
- `Message-ID`, `Feedback-ID`, `Return-Path`, `Date` and `DKIM-Signature` are platform-controlled. `In-Reply-To` and `References` can be set.

Suggestions for SurveyBeat:

- Put a one-click `List-Unsubscribe` on invitations and reminders. Point it at a Worker endpoint that accepts an unauthenticated `POST` carrying a signed token, and turns off reminders (or that pulse) for that person. This matches SPEC §5.1, "A member can turn reminders off". Do **not** implement it as a Cloudflare suppression. An account-scoped suppression would also block results notices and future invitations, and the person would not see the effect in-app.
- Use `List-Id` per pulse so clients can group and filter. Use `Auto-Submitted: auto-generated` for notices.

**One-tap links survive transport.** Cloudflare does not wrap links (above), so the rating links arrive unchanged. The receiving side is the constraint:

- Microsoft Defender Safe Links states that "URLs are scanned prior to message delivery" and that unknown URLs "are detonated asynchronously in the background". It also rewrites links to `*.safelinks.protection.outlook.com` unless the tenant turns that off. <https://learn.microsoft.com/en-us/defender-office-365/safe-links-about> [ms.date 2026-10-14]

What follows for the design (this is our inference, not Cloudflare's text):

- A `GET` on a rating link must **not** record an answer by itself. A scanner that follows all five rating links would otherwise submit an answer, or overwrite it with the last value fetched.
- Let the `GET` render the small answer page with the value preselected. Record the answer with a `POST` from that page, triggered on load by JS or by one tap on "Confirm". Scanners that fetch without running JS then record nothing.
- The token lives in the URL, so the logging rules in SPEC §5.3 apply to the link-landing request as well.

## 9. Fallbacks

What each one needs from a Worker. All of them work with `fetch` alone, and none needs a Node SMTP library.

| | Cloudflare Email Service | Postmark | Resend | Amazon SES |
| --- | --- | --- | --- | --- |
| Send API | Worker binding `env.EMAIL.send()`, no secret | HTTPS `POST /email` with `X-Postmark-Server-Token` | HTTPS `POST /emails` with Bearer API key | SES v2 HTTPS API, **SigV4-signed** (for example the `aws4fetch` library in a Worker); IAM keys as secrets |
| Bounce and complaint feed | Queue event subscription (no public endpoint) | Webhooks; **no HMAC**, secured by basic auth in the URL plus an IP allowlist; retries 5xx/408/429 with backoff; dedupe on `MessageID` <https://postmarkapp.com/developer/webhooks/webhooks-overview> | Webhooks signed with Svix (`svix-id`, `svix-timestamp`, `svix-signature`; verify on the raw body) <https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests> | SNS topic to an HTTPS subscription (verify SNS message signatures, confirm the subscription), or event publishing through configuration sets to SNS or EventBridge. A feed is **mandatory** <https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity-using-notifications-sns.html> |
| Onboarding friction | Domain must be on Cloudflare DNS; unknown starting quota | Account approval; DKIM plus Return-Path CNAME | DNS records; free tier limited to 100/day | **Sandbox**: verified recipients only, 200 per 24h, 1 per second, until production access is granted (initial response within 96h) <https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html> |
| Price (Nov 2026) | 3k/month included, then $0.35 per 1k | Free 100/month; Basic $15 for 10k, then $1.80 per 1k; Pro $16.50 for 10k, then $1.30 per 1k; dedicated IP $50/month at 300k+ per month <https://postmarkapp.com/pricing> | Free 3k/month (100/day); Pro $20 for 50k, then $0.90 per 1k; dedicated IP $30/month on Scale <https://resend.com/pricing> | $0.10 per 1k (à la carte); dedicated IP $24.95/month; VDM $0.07 per 1k <https://aws.amazon.com/ses/pricing/> |
| Fit with SPEC | Native; no extra vendor | Transactional-only product with separate transactional and broadcast streams; strong deliverability focus | Best developer experience; signed webhooks | Cheapest at scale, but adds an AWS account, IAM and SNS. SPEC §6 keeps compute and data off other clouds, and this adds a third platform |

**Ranking for the fallback.** Postmark is first: the product is transactional-only and its reputation is built on that. Resend is second: signed webhooks and a free tier that covers staging. SES comes last: it is cheap, but brings the most integration work and a sandbox wait.

**Whatever is chosen, keep it swappable:**

- Define one `EmailSender` Effect service in the domain, with a Cloudflare adapter and, later, an HTTP adapter.
- Define one `DeliveryEvent` schema. Cloudflare Queue events and vendor webhooks are both parsed into it at the boundary.
- Unsubscribe and reminder preferences live in SurveyBeat, not in the provider. Switching providers then changes no product behavior.

## Recommendation for the SPEC §6.1 decision

1. Use **Cloudflare Email Service** as the primary sender for Release 1. It meets every functional need in SPEC §5.1, §5.8 and §7.
2. Record **Postmark** as the fallback, triggered by any of the following:
   1. Seed tests land invitations in spam or junk at Gmail, Outlook.com or a Microsoft 365 tenant, and authentication is correct.
   2. The granted daily quota is below the projected peak day after a limit request.
   3. Cloudflare rules SurveyBeat's invitations or reminders out of "transactional".
   4. A breaking beta API change lands without a migration path.
3. Before the first external customer:
   - File the limit-increase request.
   - Onboard a dedicated sending subdomain per stage.
   - Set DMARC to `p=none` with `rua` reporting, then tighten it.
   - Wire the Queue event subscription.
   - Run a seed-inbox test of an invitation with one-tap links and `List-Unsubscribe`.

## Open points

- Size of the starting daily quota: not public, ask Cloudflare.
- GA date and SLA: none announced as of 2026-11-07.
- Alchemy support for Email Sending event subscriptions: settled on 2026-11-07. `Cloudflare.Queues.Subscription` accepts `source: { type: "email.sending", zoneId, domain }` in 2.0.0-beta.85 (src: `cf/Queues/Subscription.ts`). See `docs/infra.md`, "Email".
- Whether Cloudflare will offer dedicated IPs or pools for transactional mail: not documented.
