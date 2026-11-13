# Dashboard UI audit: every screen, EN/DE, light/dark, desktop/phone

Research for issue #138 (map #137). Captured 2026-11-10 from `main` at `492ec31e`.

## Short answer

The B2 tokens and components are applied consistently, and dark mode and German mostly hold up. What makes the app look unfinished is not colour or type. Navigation dead-ends, unformatted numbers and dates, form-heavy pages, and charts with no axes make it look like an admin tool rather than a product. Five defects show up on screen and should be fixed before the first real Round (#94).

### Top 10 findings (ranked)

1. **Bug: the "Actions" heading is invisible in light mode.** It is ink (`#0E2A24`) on the ink evergreen Actions panel, so the contrast is 1:1. Every Results page shows an empty band at the top of the dark panel. In dark mode the panel colours differ, so the heading shows there. ([light](dashboard-ui-audit/results-shared-lead--en-light-desktop.png) vs [dark](dashboard-ui-audit/results-shared-lead--de-dark-desktop.png))
2. **Members cannot reach Results from inside the app.** The Team page shows a member the trend charts but no link to any Round. My history lists Rounds without links. Pulses → Rounds is Lead-only. A Lead also needs four clicks (Team → Pulses → Pulse → Rounds → Results). The Team page needs a "Latest Results" entry point and a list of recent Rounds. ([team-member](dashboard-ui-audit/team-member--en-light-desktop.png), [history](dashboard-ui-audit/history--en-light-desktop.png))
3. **Numbers and dates are not formatted for the locale.** Scores go through `String()`, so German shows "3.6" (should be "3,6") and a whole score shows "4" (should be "4.0"). Round titles, "since last Round (2026-11-02)" and action due dates are ISO strings, while other dates on the same card are localized ("Nov 13, 2026", "13.11.2026"). The sidebar shows "75%" in German, where the body says "75 %". ([results DE](dashboard-ui-audit/results-shared-lead--de-dark-desktop.png))
4. **Bug: the answer page and My history ignore a Question's own scale labels.** The editor stores `lowLabel`/`highLabel` (for example "Overwhelming" … "Very manageable", or "Light" … "Heavy" in the scene fixtures), but the answer page always shows "1 · Very poor … 5 · Very good", and history shows "4 · Good". On an inverted scale ("Heavy" = 5) the shown labels contradict the Question. ([answer](dashboard-ui-audit/answer-open--de-light-phone.png))
5. **Team health charts can't be read.** The Team overview and the Results trends have no y-axis, no scale, no date labels and no current value. Lines sit flat inside 70 px of a large card. The Action-marker strip is a separate box that isn't aligned to the charts in any way you can see. "12-Round trend" is the title even when there are 4 points. ([team-lead](dashboard-ui-audit/team-lead--en-light-desktop.png))
6. **The phone header takes 135 px.** The nav wraps onto three rows (Teams, My history, Organization settings, then Privacy, or the German equivalents) on every signed-in screen. Privacy doesn't belong in the primary nav. Language and Sign out sit at the bottom of every page's content instead of in an account menu. ([teams phone](dashboard-ui-audit/teams--de-light-phone.png))
7. **Bug: the Team page scrolls sideways on phones.** Two elements overflow 390 px: the hidden Action-marker tooltip (`w-max`, which still takes up layout space) reaches 420 px, and each roster row's "Remove" button doesn't wrap next to a long email. ([team-lead phone](dashboard-ui-audit/team-lead--en-dark-phone.png))
8. **Admin forms dominate content pages.** Teams, Team, Settings and Rounds each end in one or more always-open, full-width forms (Create a Team, rename, Add member, Assign Lead, Skip a week). The forms outweigh the content: a Lead's Team page is mostly forms below the charts. Move them into secondary sections or disclosures, or behind a "+ Add" button. Destructive actions (Remove, Remove from Organization, Cancel Round, Drop) look exactly like harmless links.
9. **Bug: the "Bigger change than usual" badge always shows a down arrow**, even when a score rose (`results.ts` `highlightBadge` hard-codes the path). The explanation next to it comes from the server in English only ("Usually moves about ±0.3 between rounds", built in `packages/domain/src/rounds/Results.ts:306`), so German Results mix languages.
10. **Empty states are dead ends.** "You're not in any Team yet.", "This Team has no Pulse yet.", "No shared Rounds yet.", a People heading with an empty roster, "This check-in is closed." and the history empty state each show one centred grey line, with no next step or explanation. A brand-new Organization gets no onboarding path (create Team → add people → create Pulse → send a test, #136). ([teams-empty-member](dashboard-ui-audit/teams-empty-member--en-light-desktop.png), [team-new](dashboard-ui-audit/team-new--en-light-desktop.png))

### Bugs found (separate from polish)

| # | Bug | Where | Evidence |
|---|---|---|---|
| B1 | "Actions" h2 has 1:1 contrast in light mode (ink on evergreen) | `results.ts` ~968, `sectionTitle` on the dark panel | computed `color` = panel `background-color` = `rgb(14,42,36)` |
| B2 | Highlight badge arrow always points down | `results.ts` `highlightBadge` | `M6 1v7M3 5l3 3 3-3` regardless of `direction` |
| B3 | Highlight explanation is server-side English in the German UI; also lowercase "rounds" | `domain/rounds/Results.ts:305-306` | DE Results |
| B4 | Scores and history team score formatted with `String()`: no German decimal comma, "4" instead of "4.0" | `results.ts:115,1073,1132`, `history.ts:102` | DE Results, history |
| B5 | Rating anchor labels (`lowLabel`/`highLabel`) never shown on the answer page or in My history | `answer/main.ts`, `history.ts` | answer, history |
| B6 | Horizontal overflow on the Team page at 390 px (marker tooltip, roster Remove) | `overview.ts` tooltip span, roster row in `directory.ts` | overflow probe: tooltip right edge 420 px, Remove 415 px |
| B7 | Action without an owner renders a dangling "Owner:" label | Actions list in `results.ts` | results-shared-lead |
| B8 | Single-choice distribution: option labels are overlapped by their bars ("Standup", "Planning") | distribution bars in `results.ts` / `charts.ts` | results-shared-lead |
| B9 | Question number has no space: "1.How manageable…" | Pulse editor question card | pulse-editor |
| B10 | Answer page without a valid token shows the error *and* "Loading your question…" plus the full scale and a disabled button | `answer/main.ts` `showError` path | answer-no-token |
| B11 | `document.title` is the Organization name on every signed-in screen, so tabs and history can't be told apart (WCAG 2.4.2) | App `view` | probe: title "Northwind Logistics" on Results, editor |
| B12 | "Pause Pulse" and "Resume Pulse" are both shown, with no indication of the current state | Rounds screen | rounds-lead |
| B13 | The privacy page leaves out the minimum group size and AI processing (ADR 0004, ADR 0015), the two facts a buyer asks about first. Signed in, it also loses the app nav. | `privacyView` | privacy |

## How this was captured

- **Throwaway harness, not committed.** A git-ignored `apps/web/audit/` entry imports the real `App.ts` `view`/`update` and boots Foldkit's `Runtime.makeApplication` with a fixture `Model` chosen by `?scene=<name>&lang=en|de`. No commands run on init, so no API is needed. The fixtures copy the shapes in `App.scene.test.ts` and the `@surveybeat/domain` schemas, with realistic names and eight Rounds of trend data. This deliberately renders exact Model states instead of mocking `/api/*` over HTTP: it reaches every Results state (ready, couldNotCompute, themes preparing/unavailable) without a server that can produce them. The Model schema is validated at runtime, and it caught one bad fixture.
- 37 dashboard scenes × {en, de} × {light, dark} × {1280, 390} = 296 shots from Vite dev. The answer page was captured from `vite preview` of the production build at `/a/` and `/de/a/`, with `/exchange` stubbed by Playwright: open (AI on, `v=4` preselected), closed, and no token. Browser: the pinned Playwright chrome-headless-shell 1248 on arm64, `deviceScaleFactor` 1, time zone Europe/Berlin.
- Committed here: 160 of them (4 variants per scene: `en-light-desktop`, `de-dark-desktop`, `de-light-phone`, `en-dark-phone`). Desktop shots are scaled to 960 px wide and all are palette-quantized, about 6 MB in total. File names are `<scene>--<lang>-<scheme>-<width>.png`.
- Headless Chromium renders the answer page's system serif as DejaVu and native `<input type=time>` as "09:00 AM" even with a German locale. Don't treat either as a product finding without checking on a real device.

## Per-screen findings

Ranking within each screen: **P1** looks broken or blocks a task, **P2** clearly unfinished to a buyer, **P3** refinement.

### Shell and navigation (all signed-in screens)

- P1 Phone header wraps to 2–3 nav rows (finding 6). Proposal: brand + Organization on the left, a menu button on phones; desktop keeps the inline nav. Move Privacy to a footer.
- P2 Language select and Sign out sit inside page content on every screen, after the forms. Move them to an account menu in the header (Organization name → menu) or the footer.
- P2 No active state on nav links: the current section isn't indicated.
- P2 Back links ("All Teams", "Back to Team", "Back to Pulse") are the only wayfinding. Use a consistent breadcrumb (Team › Pulse › Round) on Team, Pulse, Rounds and Results.
- P3 In dark mode the brand mark's square is hard-coded `#0E2A24`, which almost disappears on the dark header ([teams dark](dashboard-ui-audit/teams--de-dark-desktop.png)).
- P3 Sign out is a `linkButton` with `px-1`, so it sits 4 px right of the column edge on every page.
- P3 The Teams list doubles as the post-login landing page; there's no "home" that answers "what needs my attention?" (Ready Results to share, an open Round's response rate, Actions due).

### Sign-in, failed sign-in, session failed

[en light desktop](dashboard-ui-audit/signin--en-light-desktop.png) · [de light phone](dashboard-ui-audit/signin--de-light-phone.png) · [failed](dashboard-ui-audit/signin-failed--en-light-desktop.png) · [session failed](dashboard-ui-audit/session-failed--en-light-desktop.png)

- P2 A bare left-aligned column in a 1280 px canvas: heading, one sentence, a small button. Nothing tells a first-time buyer what SurveyBeat is or reassures them about privacy. Centre a sign-in card, add one line of product framing and the privacy promise, and make Sign in full width on phones.
- P3 The session-failed page uses a 44 px display headline for an error sentence. Use a normal title ("Couldn't load SurveyBeat") plus body text.

### Create Organization, Choose Organization, Not in an Organization

[create](dashboard-ui-audit/create-org--en-light-desktop.png) · [choose](dashboard-ui-audit/choose-org--de-light-phone.png) · [not in org](dashboard-ui-audit/not-in-org--de-light-phone.png)

- P2 Not in an Organization: a dead end. It doesn't show the signed-in email (the most useful fact for "ask them to add this email") and offers no "Sign in with a different account".
- P2 Copy: "Ask your team lead" uses a lowercase role and isn't the glossary "Lead". The German "Teamleitung" is fine.
- P3 Choose Organization: the rows are buttons with no chevron or hover affordance, and nothing tells you which Organization you last used.

### Teams list (admin, member, empty)

[teams](dashboard-ui-audit/teams--en-light-desktop.png) · [phone de](dashboard-ui-audit/teams--de-light-phone.png) · [empty admin](dashboard-ui-audit/teams-empty-admin--en-light-desktop.png) · [empty member](dashboard-ui-audit/teams-empty-member--en-light-desktop.png)

- P2 Team rows hold only a name and a role badge: no member count, Pulse status, next Round or last response rate, and no chevron to show the row is a link. The row for a Team the admin isn't in has no badge, so nothing explains why it looks different.
- P2 The Create a Team form is always open below the list. Make it a "Create a Team" button that opens the form, and use it as the empty state's call to action.
- P2 Time zone is a free-text input (it accepts "UTC" or a typo). Use a searchable select defaulting to the browser zone.
- P2 Empty member state: "You're not in any Team yet." with no explanation of how to get added.
- P3 Badge copy is inconsistent: "You are Lead" vs "You are member". The German badge "Deine Rolle: Teamleitung" wraps to two lines on phones; use "Lead"/"Mitglied" alone.

### Team page (Lead, member, new Team)

[lead](dashboard-ui-audit/team-lead--en-light-desktop.png) · [lead phone](dashboard-ui-audit/team-lead--en-dark-phone.png) · [member](dashboard-ui-audit/team-member--en-light-desktop.png) · [new](dashboard-ui-audit/team-new--en-light-desktop.png)

- P1 Horizontal overflow on phones (B6).
- P1 No path from the Team page to Results for members, and only a small "Pulses" text link for Leads (finding 2). Add a "Latest Results" card and a "Recent Rounds" list.
- P2 Overview charts can't be read (finding 5). Add a 1–5 y-scale, date ticks, the latest value per Dimension, and put the Action markers on the chart's x-axis instead of in a separate box. The markers' only labels are tooltips, which touch screens never show.
- P2 The Lead's page stacks charts, then a rename form, then People, then two more forms. Group them into tabs or sections: Overview | People | Settings.
- P2 Roster: the role badge is lowercase "member" but capitalized "Lead". "Remove as Lead" wraps to two or three lines on phones, especially in German ("Als Teamleitung entfernen"). Remove has no confirmation and no danger styling.
- P2 New Team: the "People" heading sits over an empty rule, and the overview says "No shared Rounds yet" with no next step. Use a checklist: add members → create a Pulse → first Round on <date>.
- P3 The "Time zone: Europe/Berlin" metadata line is more prominent than it needs to be. Fold it into the settings.

### Organization settings (AI on/off, languages)

[settings](dashboard-ui-audit/settings--en-light-desktop.png) · [de phone](dashboard-ui-audit/settings--de-light-phone.png) · [ai off](dashboard-ui-audit/settings-ai-off--de-dark-desktop.png)

- P2 Each setting has its own panel and Save button, and the AI toggle saves instantly, so the saving model is inconsistent. Either autosave everything with a "Saved" tick or use one Save.
- P2 "Default language" appears twice (panel heading and field label).
- P2 People: "Make admin" and "Remove from Organization" are identical underlined links. On phones, in German, they wrap into centred two-line link stacks that look broken. Use a row menu (⋯) with a danger item and confirmation.
- P2 The personal "Language" select at the bottom of the page sits next to the Organization "Default language" panel, which is confusing on this one page. That select belongs in the account menu (see Shell).
- P3 The German H1 "Organisationseinstellungen" just fits at 390 px. Add `hyphens: auto` with `lang` set for long German compounds.
- P3 The "hasn't signed in yet" badge is lowercase. Show People in a table (email, role, status) on desktop.

### Pulses list (with Pulses, empty)

[pulses](dashboard-ui-audit/pulses--en-light-desktop.png) · [empty phone](dashboard-ui-audit/pulses-empty--de-light-phone.png)

- P2 Rows show the cadence and question count but no state (active or paused, next Round date, last response rate) and no link to Rounds or latest Results.
- P2 Empty state: the "no Pulse yet" box and the Create button are separate blocks. Put the call to action and the Template explanation inside the empty state.
- P3 "about 60 s" / "about 120 s" reads as machine output. Use "about 1 min" / "about 2 min".

### Pulse editor (existing, new)

[editor](dashboard-ui-audit/pulse-editor--en-light-desktop.png) · [de phone](dashboard-ui-audit/pulse-editor--de-light-phone.png) · [new](dashboard-ui-audit/pulse-editor-new--en-light-desktop.png)

- P1 "1.How…" has no space (B9).
- P2 Each question card has three or four underlined text links (Move up, Move down, Edit, Remove). On German phones they wrap to two lines and Remove lands alone on its own line. Use icon buttons (↑ ↓ ✎ 🗑) with labels, or drag handles, and give Remove a danger style.
- P2 Disabled "Move up" / "Move down" are pale underlined links, close to illegible in dark mode.
- P2 Show a preview of what a member will see (scale labels, comment box). Related to the open map question about "Send me a test" and B5.
- P3 "Rounds" is a lone small link under the title. Make it a tab next to "Questions" and "Settings".
- P3 The settings panel ends with anonymity and distribution facts in fine print. Show them as read-only rows with an info icon.

### Rounds

[rounds](dashboard-ui-audit/rounds-lead--en-light-desktop.png) · [de phone](dashboard-ui-audit/rounds-lead--de-light-phone.png) · [empty](dashboard-ui-audit/rounds-empty--en-light-desktop.png)

- P1 Pause and Resume are both always shown (B12).
- P2 "Skip a week (date, YYYY-MM-DD)" is a free-text date in a full panel with a full-width primary button, above the list. It duplicates "Skip this week" on the Scheduled Round. Remove it or use a date picker in a disclosure.
- P2 Status badges are all the same grey. Ready (Lead action needed) and Open should stand out, and a Ready Round should have a "Review and share" primary button instead of "View Results".
- P2 Round titles are ISO ("Round 2026-11-16") while the range under them is localized.
- P3 Close early and Cancel Round are plain links. Cancel is destructive. The confirmation step exists (scene tests); its styling wasn't audited here.

### Results (all states)

Shared, Lead: [en light](dashboard-ui-audit/results-shared-lead--en-light-desktop.png) · [de dark](dashboard-ui-audit/results-shared-lead--de-dark-desktop.png) · [phone](dashboard-ui-audit/results-shared-lead--de-light-phone.png). Shared, member: [en light](dashboard-ui-audit/results-shared-member--en-light-desktop.png). Ready, Lead / member: [lead](dashboard-ui-audit/results-ready-lead--en-light-desktop.png) · [member](dashboard-ui-audit/results-ready-member--en-light-desktop.png). Open: [open](dashboard-ui-audit/results-open--en-light-desktop.png). Below N: [below N](dashboard-ui-audit/results-below-n--en-light-desktop.png). Themes: [preparing](dashboard-ui-audit/results-themes-preparing--en-light-desktop.png) · [unavailable](dashboard-ui-audit/results-themes-unavailable--en-light-desktop.png) · [AI off](dashboard-ui-audit/results-ai-off--en-light-desktop.png). Failures: [couldn't compute, Lead](dashboard-ui-audit/results-failed-lead--en-light-desktop.png) · [delayed, member](dashboard-ui-audit/results-delayed-member--de-light-phone.png).

- P1 The Actions heading is invisible in light mode (B1). The arrow is wrong (B2), the explanation is English-only (B3) and the numbers aren't localized (B4).
- P1 The page title is just "Results" and "Round 2026-11-09" (ISO). Put the Team and Pulse in the title: "Platform Engineering · Weekly check-in · 9 Nov".
- P2 The response rate appears three times: in the summary sentence, in the "75% response rate (6 of 8)" line and in the sidebar card. Keep the sidebar card and the sentence.
- P2 Single-choice labels collide with their bars (B8). A long-text Question shows only "—" and "4 contributors", while its answers sit in the separate Comments section. Link the two or show the comments under the Question.
- P2 Scores are right-aligned in the card header with nothing that says "out of 5". Show "3.6 / 5" and fix one decimal.
- P2 The Ready state for a Lead is a plain white card with a small button; this is the most important Lead action of the week. Use a highlighted banner with the review deadline as a countdown ("Shares automatically in 2 days").
- P2 Couldn't compute (Lead): "Try again" sits above an open Note editor and the Commit-an-action form, although there's nothing to discuss yet. Hide or disable those until Results exist. The member's "Results delayed" copy uses lowercase "results".
- P2 The commit-an-action form is always open inside the dark panel: the Owner select truncates the email ("grace.hopper@northwi"), the disabled "Commit action" is low contrast, and "Mark done" is mint while "Drop" is outlined. Collapse the form behind "+ Commit an action".
- P3 The "Note from your Lead" panel shows "Write note" in a mint button inside a white card, while the rest of the app's primary buttons are teal.
- P3 "Raised in 3 comments" and the discussion-guide fine print are 11–12 px. The "How this page protects people" sidebar sits at the end on phones, which is fine; on desktop it's taller than the content in the Open/Ready states and leaves a large empty right column.

### My history (local answers, none on device, empty)

[history](dashboard-ui-audit/history--en-light-desktop.png) · [no local, phone](dashboard-ui-audit/history-no-local--de-light-phone.png) · [empty](dashboard-ui-audit/history-empty--en-light-desktop.png)

- P1 Rounds don't link to their Results (finding 2).
- P2 With no local answers, every row repeats "Not on this device", which wraps to three lines per cell on phones. Show it once per Round and hide the answer column.
- P2 The three-column table is cramped on phones. Stack "Your answer" and "Team score" under each Question.
- P2 Each card's title is the Pulse name, so "Weekly check-in" repeats. Lead with the date ("Week of 9 Nov").
- P3 "3.6 of 5" isn't localized (B4), and the scale label shown is the generic one (B5).

### Privacy page

[en light](dashboard-ui-audit/privacy--en-light-desktop.png) · [de phone](dashboard-ui-audit/privacy--de-light-phone.png)

- P1 Content gap (B13): the page says nothing about the minimum group size or AI processing. The 30-day backup and "who can trigger a restore" sections are operator detail, ranked above what a member cares about.
- P2 Signed in, it drops the app nav and offers only a "Back" link.
- P3 "Anonymous submissions" and "team leads" are lowercase glossary terms. No contact or imprint line.

### Answer page (`/a`, `/de/a`)

[open, de phone](dashboard-ui-audit/answer-open--de-light-phone.png) · [open, en dark phone](dashboard-ui-audit/answer-open--en-dark-phone.png) · [closed](dashboard-ui-audit/answer-closed--en-light-desktop.png) · [no token](dashboard-ui-audit/answer-no-token--de-light-phone.png)

- P1 Generic scale labels instead of the Question's anchors (B5).
- P1 The no-token or error state shows the error banner above a "Loading your question…" form (B10).
- P2 The closed state is a dead end: one sentence, no SurveyBeat mark, no "next check-in on …", no link to My history.
- P2 The anonymity statement and AI notice are one 8-line grey block. Lead with one short sentence ("Your Lead sees only combined answers from 4+ people") and put the detail behind "How?".
- P3 The primary button is evergreen/ink here and teal in the dashboard, so the two disagree about which token is "primary". The pulse name is 13 px muted text, the only branding on the page.

## Proposed polish tickets

Effort: S ≤ ½ day, M ≈ 1–2 days, L ≈ 3–5 days.

### A. Bugs to fix before the first real Round

1. **Fix invisible Actions heading and badge arrow** (S). Give `sectionTitle` an on-dark variant for the Actions panel (B1), and draw the highlight arrow from `direction` (B2). Add a scene test for both directions and an axe contrast check on Results in light mode.
2. **Localize numbers and dates everywhere** (M). Add `formatScore` (one decimal, `Intl.NumberFormat`) and `formatRoundDate` helpers in `messages/locale.ts`, and use them for scores, history team scores, the sidebar percent, Round titles, "since last Round", and due dates (B4, finding 3). Move the highlight explanation to a catalog message with params instead of server English (B3).
3. **Show a Question's own scale labels to members** (M). Pass `lowLabel`/`highLabel` into the answer page's rating screen (within the ADR 0008 budget) and into My history (B5). Decide whether the 1/5 anchors replace or sit next to the generic labels.
4. **Phone overflow and small rendering bugs** (S). Fix the marker tooltip layout (absolute, no layout width) and let roster rows wrap (B6). Also fix the dangling "Owner:" (B7), the choice-label/bar overlap (B8), "1.How" (B9), the answer page's error-plus-form state (B10), and Pause/Resume state (B12). Add an overflow assertion at 390 px to the e2e axe pass.

### B. Navigation and information architecture

5. **Results reachable for everyone** (M). On the Team page, add "Latest Results" plus a "Recent Rounds" list visible to anyone who may view Results. Link each My history Round to its Results. Put breadcrumbs (Team › Pulse › Round) on Pulse, Rounds and Results.
6. **Responsive header and account menu** (M). Use a compact header with a menu on phones and an active nav state. Move Language and Sign out into an Organization/account menu and Privacy to a footer. Give each screen a per-screen `document.title` ("Results · Platform Engineering — SurveyBeat") (B11).
7. **Home: "what needs my attention"** (L, can follow). Make the landing page a summary, not only the Teams list: Results waiting to be shared, open Rounds with their response rate, Actions due.

### C. Screen polish

8. **Readable charts** (M). Add a y-scale (1–5), date ticks, the latest value label and Action markers on the x-axis to the Team overview and Results trends. Title the trend by its actual length. Make markers keyboard and touch accessible without hover.
9. **Forms out of the way** (M). Make Create Team, rename/time zone, Add member / Assign Lead, Skip a week and Commit an action button-triggered disclosures or dialogs. Replace the time-zone text input with a select. Add one destructive-action pattern (danger style plus confirmation) for Remove, Remove from Organization, Cancel Round and Drop.
10. **Results page hierarchy** (M). Put Team and Pulse in the title, show each score as "x.x / 5", and show the response rate once. Give the Lead's Ready state a prominent "Share with the Team" banner with a countdown. Hide Note and Actions when Results couldn't be computed. Show long-text answers with their Question.
11. **Rows that carry information** (S–M). Teams rows get member count, next Round, a chevron, and badges reduced to "Lead"/"Member". Pulses rows get state, next Round and links. Rounds get coloured status badges and a "Review and share" button on Ready. People in Settings become a table with a row menu.
12. **Pulse editor controls** (S). Use icon buttons with labels for reorder, edit and remove (Remove styled as danger), make disabled states legible, and turn "Rounds" into a tab.

### D. Empty states, onboarding and copy

13. **Empty states with next steps** (M). Use one `emptyState` component with title, one sentence and a call to action for: no Teams (member and admin), new Team (checklist: add members → create Pulse → first Round date), no Pulse, no Rounds, no history, and the answer page's closed state. This overlaps the open onboarding question on #137 and #136.
14. **Privacy page and copy pass** (S). Add the minimum group size and AI processing sections first on the privacy page (B13), and keep the nav when signed in. Do a glossary casing pass in both catalogs ("Lead", "Results", "Submissions", "Round"), and fix "about 60 s" → "about 1 min" and the duplicate "Default language" label. Add `hyphens: auto` for German headings.
15. **Sign-in and answer-page trust** (S). Centre the sign-in card with one line of product framing and the privacy promise. Shorten the answer page's anonymity statement, add a small SurveyBeat mark, and align the primary button token with the dashboard.
