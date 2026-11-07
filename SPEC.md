# SurveyBeat rebuild specification

This document describes SurveyBeat for an engineer who will rebuild it from nothing. It says what the product is, who it serves, what it does, and which platform choices are fixed. It contains no code. Where the spec makes a design decision, it gives the reason, so you can tell a binding rule from a suggestion.

The existing repository (Next.js, Clerk, Drizzle on Postgres, Vercel and GCP via Terraform) is reference material only. Do not port it. Section 2 lists what it got right and where it went wrong, so the rebuild keeps the lessons and drops the code.

## 1. What SurveyBeat is

SurveyBeat measures how a team is doing, week over week, and helps the team act on what it learns.

A team lead sets up a short recurring check-in called a pulse. Each week (or each sprint, or each month), every member of the team gets a few questions. They answer in under a minute, usually without leaving their inbox or chat app. Once enough people answer, the team sees how it scored, how that compares with last time, and what people wrote. The lead and the team agree on one or two actions. The next pulse shows whether those actions helped.

The product loop has four steps, and every feature in this spec serves one of them.

1. **Ask.** A short, consistent set of questions reaches each member at a good time for them.
2. **Answer.** Answering is fast, works on a phone, and is safe. Members trust that anonymous really means anonymous.
3. **Understand.** The team sees trends, not single data points. Free-text comments are condensed into themes without exposing who wrote what.
4. **Act.** Findings turn into owned actions. The team sees the effect of those actions in later pulses.

The old product stopped at step 3, and step 3 was only half built. Most competitors also stop at step 3. The rebuild treats step 4 as a core feature.

### Who uses it

| Role | What they need |
| --- | --- |
| Team member | Answer in seconds. Be certain an anonymous answer cannot be traced back. See the team's results and what changed because of them. See their own answer history, privately. |
| Team lead | Set up a pulse once and never touch the schedule again. See a clear picture of the team's health, its trend, and what people are saying. Run a short team conversation about the results. Track actions. |
| Organization admin | Connect the company directory and single sign-on. Manage teams and leads. Set privacy policy for the whole organization. |
| Leadership viewer | See aggregated health across many teams without access to any team's individual responses or comments. |

A person can hold different roles in different teams. A lead of one team is often a member of another.

## 2. What the current codebase teaches

The last commit on the old app was made in mid 2025. Read this section as a list of lessons, not as a backlog.

**What it got right.** The core entities were correct: teams, members with a lead or member role, surveys with ordered questions, responses, and answers. The question types (rating, multiple choice, open text) are the right starting set. A per-survey anonymity setting was the right instinct. Analytics already tried to show trends over time, response rates, and per-question trends, which is the right emphasis.

**Where it went wrong.** Each item below is a requirement the rebuild must meet.

- The browser decided anonymity. The response form sent the survey's anonymity flag back as a hidden field, and the server trusted it. The responses table also had a user column that every response could fill. In the rebuild, only the server enforces anonymity, and an anonymous answer has no stored link to a person.
- Results showed for any number of responses. With two responses on a team of four, a lead can often guess who said what. The rebuild enforces a minimum group size before showing any result.
- A survey was one fixed form with a "scheduled day" and "scheduled time" stored on it, but nothing ever ran on that schedule. A weekly pulse is a recurring thing that produces separate rounds. The rebuild models those as two concepts.
- Editing a question changed it in place for all past answers, which breaks trends. The rebuild versions questions.
- Email distribution was a form behind a feature flag that sent nothing. Sharing a link was the only working channel.
- The README promised action-item tracking. The code had none.
- Several products did overlapping jobs (Clerk, Statsig, PostHog, Sentry, Prisma alongside Drizzle, Supabase config, Terraform for Vercel and GCP). The rebuild uses fewer, chosen on purpose.

## 3. Product principles

These rules decide the trade-offs that the rest of the spec does not cover.

1. **Trust before features.** If a feature could weaken a member's anonymity, it does not ship, or it ships only behind the privacy threshold. Members who doubt anonymity stop answering honestly, and the product then measures nothing.
2. **Short beats complete.** A pulse is 3 to 7 questions. The product pushes back when a lead adds more. A 90 percent response rate on five questions beats 40 percent on twenty.
3. **Trends over snapshots.** One week's score tells you little. Every result is shown against its history and its confidence (how many people answered).
4. **The team owns the results.** By default, members see the same aggregated results as the lead. A lead can delay sharing until after the team discussion, but cannot hide results permanently.
5. **Meet people where they are.** Answering happens in email, Slack, or Microsoft Teams with one tap where possible. Opening the web app is the fallback, not the default.
6. **Close the loop.** Every round of results asks "what will we do about this?" and every following round reminds the team what it decided.

## 4. Domain model

This section names the core concepts and the rules each one must keep. Pick the storage layout yourself, but keep these concepts and invariants. Use these names in the code, the UI, and the API, so that one word means one thing everywhere.

### Tenancy and people

- **Organization.** The tenant. Every other record belongs to exactly one organization. An organization maps one to one to a WorkOS organization. Data never crosses organizations.
- **Person.** A human in an organization. A person is linked to a WorkOS user once they sign in, and may exist before that, for example when imported from a directory, or invited by email.
- **Team.** A named group of people. Teams can nest (a department contains teams), so leadership views can roll up. Nesting is optional for small customers.
- **Membership.** A person's role in a team. Roles are lead, member, and viewer. A team needs at least one lead. Memberships have a start and end date, so historical participation rates stay correct after people join or leave.

### Asking

- **Question.** A reusable question in the organization's library. It has a type, a text, and for choice questions, a set of options. A question optionally belongs to a **dimension**, such as workload, psychological safety, clarity, or recognition.
- **Question version.** An edit that changes meaning creates a new version. Answers always point at the version they answered. Trends across versions are shown with a visible break marker. Typo fixes may edit a version in place. The editor asks the lead which kind of change they are making.
- **Pulse.** A recurring check-in for one team. It has an ordered list of question versions, a cadence (weekly, every two weeks, monthly, or a custom rule), a send time in the member's local time zone, an answer window (for example three days), a reminder policy, and an anonymity mode. The old "survey" becomes this.
- **Round.** One occurrence of a pulse. A round freezes the question list and the eligible members at the moment it opens. Later edits to the pulse affect only future rounds.
- **One-off survey.** A pulse with a single round and no cadence. It is not a separate concept. Leads use one-off surveys for retrospectives, offsites, or onboarding feedback.

### Answering

- **Invitation.** One eligible member's ticket to answer one round. It carries an unguessable token that is used for one-tap links in email and chat.
- **Participation record.** States that a given member has answered a given round. It exists so that reminders go only to people who have not answered, and so that response rates can be computed. In anonymous rounds, it holds no link to what the member answered.
- **Submission.** The set of answers for one round. In anonymous rounds, a submission has no person, no invitation, and no exact timestamp. Store the round and a coarse time bucket only. In attributed rounds, a submission names its person.
- **Answer.** One value for one question version within a submission.

The core privacy rule in the domain model is that the participation record and the submission must not be joinable for anonymous rounds. That includes indirect joins through timestamps, sequence numbers, insertion order, or log lines. Write this rule as a test, not as a comment.

### Understanding and acting

- **Result.** The aggregated outcome of a round, computed once the round closes or reaches its threshold. A result has scores per question and per dimension, a response rate, and comment themes. Results are derived data that can always be recomputed.
- **Comment theme.** A short, machine-written summary of a group of comments. Each theme has a label, a sentiment, a count, and a few representative quotes. A quote may be shown only if it passes the redaction step described in section 5.4.
- **Action.** A commitment the team makes in response to a result. It has a title, an owner, a due date, a status (proposed, committed, done, or dropped), and a link to the result and dimension that prompted it. An action's status shows in the next rounds.
- **Note.** An optional free-text summary the lead writes after the team discussion. It is visible to the team.

### Round lifecycle

A round moves through fixed states. Implement the lifecycle as an explicit state machine with one owner per round. Do not use scattered booleans.

| State | Meaning | Leaves when |
| --- | --- | --- |
| Scheduled | The round exists with its open time. | The open time arrives. |
| Open | Invitations are sent, and answers are accepted. Reminders go out on schedule. | The window ends, or the lead closes it early. |
| Closed | No more answers are accepted. Results are being computed. | Computation finishes. |
| Ready | Results exist. The lead can see them. Members can see them unless the lead chose a delayed share. | The lead shares, or the share delay expires. |
| Shared | Members can see results. Actions can be attached. | Final state. |
| Cancelled | The lead cancelled before close. No results. | Final state. |

Every transition must be idempotent. If the system crashes during the step that sends invitations, rerunning that step must not send the same person a second invitation. If computation fails, it can be retried without creating duplicate results.

## 5. Functional requirements

Requirements are grouped by the loop step they serve. Section 8 sequences them into releases.

### 5.1 Ask: set up and send pulses

- A lead can create a pulse in under two minutes by starting from a template. The product ships with templates for weekly team health, sprint retrospectives, onboarding check-ins (at 30, 60, and 90 days), and a manager feedback round.
- Question types are rating (1 to 5, with labeled ends), eNPS (0 to 10), single choice, multiple choice, short text, and long text. Each rating question can have an optional "Want to say more?" comment field.
- The question library is shared across the organization. Admins can mark questions as standard, so that every team asking the same question produces comparable data across the organization.
- The pulse editor shows an estimated answer time, and warns when a pulse goes over 7 questions or about 90 seconds.
- Optional rotation. A pulse can have a fixed core set of questions plus a rotating set, where each round asks one or two different questions. This covers more topics without making each round longer.
- Cadence uses each member's local time zone. Monday 9:00 means 9:00 for each recipient. A lead can skip a round (for holidays) or pause a pulse.
- Channels are email, Slack, and Microsoft Teams. Each member picks their preferred channel. Email is the fallback for everyone.
- The first question can be answered directly from the message. In email, each rating value is a link that opens the answer page with that value chosen; the answer is saved when the member confirms it there, because email security scanners open every link (ADR 0007). In Slack and Teams, the message has interactive buttons and, where the platform allows it, a modal for the rest.
- Reminders go only to members who have not answered, and there are at most two per round. A member can turn reminders off.
- A shareable link remains available for teams that do not use invitations. A link round cannot compute a response rate and cannot guarantee one answer per person. The UI says so.

### 5.2 Answer: the member experience

- The answer page loads in under one second on a mid-range phone on 4G. It needs no sign-in when opened from an invitation token. It does need sign-in when opened from the shared link, if the organization requires it.
- One question per screen on mobile. All questions on one page on desktop. Keyboard navigation works fully. The page meets WCAG 2.2 AA.
- The answer page states the round's anonymity mode in plain words before the first question, along with what the lead will and will not see. Example: "Your lead sees the team's combined answers once at least 4 people respond. Your name is never stored with your answers."
- A member can change answers until the round closes. In anonymous rounds this needs a design that does not link the person to the submission on the server. The recommended approach is a random edit key that only the member's browser stores. If the member loses the key, they cannot edit, and that is acceptable.
- After submitting, the member sees a thank-you screen and the team's current open actions. This reminds them that answering leads to change.
- A member has a private history page that shows their own past attributed answers. It also shows their anonymous answers if their browser still holds those edit keys. Nobody else can see this page.
- Interface languages at launch are English and German. All strings must be translatable from day one.

### 5.3 Anonymity and privacy

Anonymity is a product feature, and section 3 explains why it comes first. These rules hold everywhere: in the UI, the API, exports, logs, the MCP server, and AI features.

- **Modes.** Each pulse picks one of three modes. Anonymous is the default. Attributed means the lead sees names. Confidential means the organization stores names for follow-up, but the lead sees only aggregates. Confidential needs an admin to turn it on, and the answer page must state it clearly.
- **Minimum group size.** No aggregate, comment, theme, or breakdown appears unless at least N people contributed to it. N defaults to 4. Admins can raise it but not set it below 3. The rule applies to every view, including filters and comparisons. A view that would fall below N shows "Not enough responses to protect anonymity" instead.
- **No subtraction attacks.** If team A has 6 responses and its parent department shows 10, then a sub-group of 4 must not become visible by subtraction unless that group itself meets N. Comparison and roll-up views must check every group they reveal, directly or by difference.
- **Comments.** In anonymous rounds, the lead sees comments only after a redaction pass. The pass removes names, email addresses, and unusual identifying phrases, and it is done by an AI model with a rule-based check after it. The lead can choose themes only, which hides raw comments entirely.
- **Timing.** Anonymous submissions store a coarse time bucket (the day), not an exact time. Results do not update live during a round for teams below 2N members. Live updates would let a lead match a new response to the person who just told them they had answered.
- **Logs and telemetry.** Request logs for the submission endpoint must not contain the invitation token, the person, or the IP address together with the submission. Use separate requests, or remove the fields before logging. Write tests for this.
- **Data rights.** A person can export and delete their personal data. Anonymous submissions are not personal data under this design, so they survive deletion. The privacy page must state that plainly.
- **Retention.** An organization sets a retention period for raw answers and comments, defaulting to 24 months. Aggregated results can be kept longer.

### 5.4 Understand: results and insight

- **Round results page.** The page shows the response rate, the score per question and per dimension, the change since the last round, and the trend over the last 12 rounds. Every number shows its sample size. Drops and rises larger than normal noise are highlighted. Noise is judged from the team's own history, not from a fixed threshold.
- **Team health overview.** One page per team shows each dimension's trend, its current level, open actions, and participation over time. This is the lead's home screen.
- **Comment themes.** When a round closes, an AI model groups its comments into a small number of themes, each with a label, a sentiment, and redacted example quotes. The lead can see the comments behind a theme only if raw comments are allowed and the theme meets the group-size minimum.
- **Discussion guide.** For each round, the product generates a short agenda for a 15-minute team conversation. It contains the two or three most notable changes, one open question per item, and a prompt to agree on an action. The lead can edit it before sharing.
- **Ask your results.** The lead can type a question in plain language, such as "Has workload gotten better since we hired two people in March?" The system answers using only aggregated, threshold-checked data, and links to the charts it relied on. It never quotes raw comments that the lead could not see directly.
- **Comparisons.** Leads of several teams, and leadership viewers, can compare teams on standard questions. The minimum group size applies to each team shown.
- **Exports.** CSV and PDF exports of results. Exports follow the same thresholds as the UI. Raw answer exports exist only for attributed rounds.

### 5.5 Act: close the loop

- From a result, the lead or any team member can propose an action. The lead commits it, assigns an owner and a due date, and links it to the dimension it targets.
- Open actions appear in the next round's invitation and on the answer page. Example: "Last time you said meetings eat your focus time. We moved stand-up to async on Tuesdays and Thursdays."
- When a dimension's score changes after an action is committed, the team health overview shows the action as a marker on that dimension's trend chart. The product does not claim the action caused the change. It shows the two side by side.
- An optional follow-up question can be attached to a committed action and asked once in the next round, for example "Did the async stand-up change help?"
- Actions can sync one way to Linear, Jira, or GitHub Issues. Treat this as a later phase.

### 5.6 Administration

- **Sign-in.** Sign-in uses WorkOS AuthKit, with email magic link, Google, and Microsoft for small teams, and enterprise SSO (SAML or OIDC) for organizations that set it up.
- **Directory sync.** WorkOS Directory Sync (SCIM) creates and removes people and can map directory groups to teams. When a person is removed from the directory, they lose access immediately. Their memberships end on that date, and history stays intact.
- **Roles and permissions.** WorkOS manages organization-level roles (admin, member). Team-level roles (lead, member, viewer) live in SurveyBeat's own data, because they belong to the domain. Permission checks are one function of (person, action, resource), defined in one place and tested as a table.
- **Audit log.** The system records admin and lead actions, such as changing privacy settings, changing anonymity modes, exporting data, and adding leads. Use WorkOS Audit Logs if that fits, or a store inside SurveyBeat.
- **Billing.** Not in the first release. Design the model so that seats or teams per organization can be counted later.

### 5.7 Integrations and API

- **Slack app and Microsoft Teams app.** Members can answer from the messages. Leads get the results summary in a channel they choose. A slash command or message action shows the team's current health.
- **Public API.** A small, versioned HTTP API, authenticated with organization API keys, that returns results and actions. All privacy rules apply.
- **MCP server.** A remote MCP server lets a lead use an AI assistant to ask about their teams' results and manage actions. It enforces the same permissions and privacy thresholds as the web app, because it calls the same domain services.
- **Webhooks.** Webhooks for "round results ready" and "action created or updated".

### 5.8 Product surfaces outside the app

- A marketing landing page, a pricing page that can be a placeholder, and legal pages for privacy, terms, and the data processing agreement. The old app had legal page stubs. The rebuild needs real text before any external customer uses it.
- Transactional emails for invitations, reminders, results-ready notices, and action updates. They must look good in the major email clients and in dark mode.

## 6. Platform and architecture

Everything runs on Cloudflare. No Next.js, no Vercel, and no separate cloud provider for compute or data. WorkOS (identity) and the Slack and Microsoft Teams platforms are the only required external services.

### 6.1 Fixed technology choices

| Concern | Choice | Notes |
| --- | --- | --- |
| Infrastructure as code | alchemy.run | Every Cloudflare resource, binding, secret, and custom domain is declared in TypeScript with Alchemy. No dashboard changes. No Terraform. No hand-edited wrangler config. |
| Runtime | Cloudflare Workers | One Worker serves the API and the static web app (Workers static assets). Add more Workers only when a job needs a different runtime profile, such as a queue consumer. |
| Business logic | Effect | All domain logic, data access, and integrations are Effect programs. Errors, dependencies, retries, and timeouts are typed. Domain services are Effect services with layers that can be swapped in tests. |
| Schemas | Effect Schema | One schema definition per domain type is shared by the API, the client, the database layer, and the AI tool definitions. External data is parsed at the boundary, and internal code trusts the types. |
| HTTP API | Effect's platform HTTP API module | The API is declared once. The server implementation and a typed client for the web app both come from that declaration. |
| Web app | React single-page app built with Vite | Client-side routing with a typed router, such as TanStack Router. Answer pages and email landing pages must render fast without a heavy bundle. Split them into their own small entry point. |
| UI components | Base UI | Unstyled, accessible primitives. Build a small design system of your own on top (tokens, typography, and a dozen composed components). Tailwind CSS for styling is fine. Charts need an accessible library or hand-built SVG, and each chart needs a table view. |
| Authentication | WorkOS AuthKit, SSO, Directory Sync | The Worker handles the OAuth callback and keeps a session cookie. The session is checked on every request. WorkOS webhooks (directory and user events) arrive at the Worker and are verified there. |
| Email | Cloudflare Email Service | Sends invitations, reminders, and notices. Inbound email routing is optional, for reply-to-answer later. If Cloudflare email sending cannot meet deliverability needs, decide on a fallback and record it. |
| AI | Cloudflare Workers AI, through AI Gateway | Comment redaction, theme grouping, discussion guides, and "ask your results". AI Gateway handles caching, rate limits, logging policy, and model swaps. Never send raw comments to a model that keeps them. |

### 6.2 Cloudflare building blocks and their jobs

The recommended layout follows. Departures are fine when they make the system simpler, but write down the reason.

- **Durable Object per organization, with SQLite storage, as the system of record.** Each organization's people, teams, pulses, rounds, submissions, results, and actions live in that organization's own Durable Object. This gives hard tenant isolation, strongly consistent writes, and plain SQL for analytics within one organization. Survey data is small, so a single object's storage limit is far away. An organization with 5,000 people answering weekly for 5 years stays well under it. Check this number against current Cloudflare limits before you commit.
- **Durable Object per open round** (optional, decide during the build). It counts participation, rejects double submissions, and owns the round's state machine. If the organization object handles this load well, skip the extra object.
- **D1 for the global index.** This holds what must be looked up before you know the organization: WorkOS user to organization memberships, invitation token to organization and round, Slack and Teams workspace to organization, and API keys. Keep it small. No survey content goes here.
- **Cloudflare Workflows for the round lifecycle.** Each round is a durable workflow. It waits until the open time, sends invitations in batches, waits, sends reminders, closes, computes results, and notifies. Workflows give retries and resumption after crashes, and each step must be idempotent.
- **Cron Triggers** run once an hour to create the next round for each active pulse. This job is idempotent. Running it twice creates no duplicate rounds.
- **Queues** buffer outbound messages (email, Slack, Teams) and inbound webhooks, with retries and a dead-letter queue.
- **R2** stores exports and generated PDFs, and backups of each organization's data on a schedule.
- **KV** holds rarely changing configuration and caches, if needed. Do not use it for sessions that must be revoked at once.
- **Workers Analytics Engine** stores product metrics (send counts, open rates, answer latency). It must never contain answers.
- **Turnstile** protects the public link answer page against bots.
- **Secrets Store, or Worker secrets managed through Alchemy**, holds the WorkOS, Slack, and Teams credentials.

### 6.3 Code organization

- One repository and one package manager workspace. Suggested packages are the domain (pure Effect services and schemas, with no Cloudflare imports), the Cloudflare adapters (Durable Objects, D1, Queues, Workflows, and email, each implementing a domain interface), the API, the web app, the infrastructure definition, and the email templates.
- The domain package must run in plain Node tests without Cloudflare. Adapter packages are tested against local Cloudflare emulation (Miniflare, through Alchemy's dev mode or the Vitest integration for Workers).
- Organize modules by domain concept (rounds, privacy, results, actions), not by layer or execution step.

### 6.4 Environments and delivery

- Alchemy stages give every pull request its own preview environment, with its own Workers, D1, and Durable Object namespaces. The preview is removed when the pull request closes.
- `staging` and `production` are Alchemy stages too. Production deploys from the main branch after CI passes.
- CI runs type checking, linting, unit tests, Worker integration tests, the privacy test suite, and an accessibility check on the answer page.
- Errors and traces go to Workers Logs and Workers Observability. Add Sentry only if Cloudflare's tooling is not enough, and then strip all answer content before sending.

## 7. Quality requirements

- **Privacy tests are release blockers.** The suite proves at least the following. An anonymous submission has no stored path back to a person. Every result view respects the minimum group size, including subtraction across groups. Logs from the submission path contain no identifiers. Exports and the MCP server obey the same rules.
- **Performance.** The answer page reaches first paint (the screen with the anonymity statement) in under 1 second and shows the first Question's text in under 1.3 seconds, measured as the 75th percentile on a mid-range phone. The text needs one round trip, because the Invitation token is only in the URL fragment (ADR 0005, ADR 0008). Answer submission completes in under 300 ms at the 95th percentile. The results page renders in under 1.5 seconds for a team with two years of weekly rounds.
- **Reliability.** No invitation is sent twice. No invitation is skipped silently. Failed sends show up in the lead's view with the reason.
- **Accessibility.** WCAG 2.2 AA on every page. The answer flow works with a screen reader and with a keyboard alone.
- **Testing approach.** Test behavior through the domain services and the API, not internal functions. Swap Effect layers for in-memory adapters in unit tests. Run a small set of end-to-end tests against a real preview stage, covering create pulse, receive invitation, answer from email, close round, see results, and create action.

## 8. Release plan

Each release is usable on its own. Ship a release to a real team (your own, first) before starting the next.

**Release 1. The core loop for one team.**
Sign-in with AuthKit, plus organization and team setup by hand. Pulses from templates, with rating, choice, and text questions. Weekly cadence with time zones. Email invitations with one-tap first answers, and reminders. Anonymous mode with the minimum group size. Round results with trends and sample sizes. Actions with owner and status, shown in the next invitation. The full privacy test suite. Preview environments per pull request.

**Release 2. Insight.**
Comment redaction and themes. Discussion guide. Team health overview with action markers. Delayed sharing. The member's private history page. German translation.

**Release 3. Organizations.**
Enterprise SSO and Directory Sync. Nested teams and leadership roll-ups with subtraction-safe thresholds. Standard questions and cross-team comparison. Confidential mode. Audit log. Exports.

**Release 4. Where people already work.**
Slack app. Microsoft Teams app. Question rotation. Action follow-up questions.

**Release 5. Open up.**
Public API, webhooks, and the MCP server. "Ask your results". Issue tracker sync for actions.

## 9. Out of scope

- Individual performance reviews, 360 reviews, and anything that scores a single person. Those features change what members believe the tool is for, and they would erode trust in anonymous team health data.
- A general-purpose form builder. SurveyBeat asks short, recurring questions. Leads who need branching logic, file uploads, or 40-question forms should use a form tool.
- Industry benchmarks against other companies' data. Revisit this only when there is enough data and a legal basis to pool it.
- Native mobile apps. Email, chat, and a fast mobile web page cover the need.

## 10. Open questions for the product owner

These need a decision from the product owner. Each one has a default you can build against until someone answers.

1. Should members see raw comments, or only themes? Default is themes only, with the lead able to show raw comments if the minimum group size is met.
2. What is the default minimum group size? Default is 4, with 3 as the floor.
3. Is self-serve sign-up for small teams wanted, or is the product sold to organizations only? Default is self-serve, with an organization created at first sign-in.
4. Which AI models are acceptable for comment processing, given data residency? Default is Workers AI models only, through AI Gateway with logging of prompts turned off.
5. What is the target market's main chat tool, Slack or Microsoft Teams? This decides which one ships first in release 4. Default is Slack.
6. Is the "surveybeat.com" domain still owned and pointed at Cloudflare? The old Terraform config assumed so.
