# German for the app, the answer page, and emails

Research for issue #93 (map #85). Researched 2026-11-10 against the code on `main` (`af25ee3e`), a local production build of `apps/web`, Node 24's ICU (`Intl`), the TypeScript 7.0.2 compiler in the repo, and primary docs: ECMA-402, MDN, RFC 9110, RFC 5646, WHATWG HTML and Unicode CLDR. Nothing was deployed. No production code was changed.

**Why it matters.** The R2 scope decision on #86 says: German for the app, the answer page, and emails; the language is chosen per Person, defaulting to the browser, then the Organization; Claude drafts the translations and the product owner reviews them. SPEC §5.2 already requires English and German, with every string translatable from day one. The answer page has a hard budget (ADR 0008: JS ≤ 10 KB gzip on the critical path, CSS ≤ 2 KB inline, HTML ≤ 8 KB), and its critical path is already 9.0 KB.

## TL;DR

1. **Keep TypeScript catalogs. The format does not change, so no ADR is needed for the format.** Add `de.ts` next to each `catalog.ts`, written `as const satisfies Translation`. A missing key or an extra key then fails `tsc`. A small mapped type also fails `tsc` when a German string's `{placeholders}` differ from the English ones. All three checks were tested on TypeScript 7.0.2 (§1). JSON would lose the literal types that the `{placeholder}` checks need.
2. **Plurals and formats need no new mechanism.** German cardinal plurals have the same two categories as English, `one` and `other`, so every `<base>.one`/`.other` pair carries over. Dates and numbers come from `Intl` once the hard-coded `LOCALE = "en"` in `apps/web/src/messages/index.ts:22` becomes a parameter. For example, `07.11.2026`, `1.234,5` and `42 %`.
3. **Locale choice.** Store a nullable `locale` on the `person` row in the Organization Durable Object (`NULL` means "follow my browser"), plus `default_locale` on `organization`. The app resolves the Person's `locale`, then `navigator.languages`, then the Organization default. Emails have no browser, so the Organization DO resolves the locale when it creates a send and stores it inside the `StoredEmail` (§2).
4. **The answer page cannot afford a second locale in its current shared chunk.** It loads `messages-*.js`, which holds the whole app catalog, 269 keys, 5,186 B gzip. The answer page uses 27 of them. Critical path today: 4,057 + 5,186 = **9,243 B gzip, 997 B left**. Adding German to that chunk adds about 5.2 KB and breaks the budget (§3).
5. **Recommended: prerender one answer page per locale, and let the email link pick it.** Build `/a` (English) and `/de/a` (German). Each page loads only its own answer-only catalog: 756 B gzip for English and 831 B for the German draft in §3. Estimated critical path **about 5.2 KB gzip**, roughly 4 KB below today. The page knows no Person before the token exchange, but the email is rendered for one recipient whose locale is known, so the link already carries the choice. A head script that picks a locale chunk at runtime is worse: the prerendered text would flash in English, and the chunk would start loading later.
6. **`lang` and `<title>`.** Each prerendered page sets `<html lang>` and fills `<title>` from its own catalog. The empty-title and no-visible-text rules in `messages.test.ts` keep holding for the source shells. Add tests that check every plural base has every `Intl.PluralRules` category for each locale, and that every built page has the right `lang` (§4).
7. **Glossary in German.** Keep **Pulse** (der Pulse, die Pulses) and **Team** in English. Translate **Round** as *Runde*, **Lead** as *Teamleitung*, **Organization** as *Organisation*, and **Submission** as *Einsendung*. Use *du*, not *Sie*. The product owner decides each of these when reviewing the PR (§5).
8. **Gaps found.** `packages/cloudflare/src/MainWorker.ts` renders the delivery-time and unsubscribe pages with literal English and `<html lang="en">` (lines 261 and 321), outside any catalog. The Template's Question text (`packages/domain/src/pulses/Template.ts`) is English content that is copied into each Pulse, so it is not UI text. Both need their own decision (§6).

## 1. Catalog shape for a second locale

**Today.** `apps/web/src/messages/catalog.ts` (269 keys) and `packages/emails/src/messages/catalog.ts` (33 keys) are flat `as const` objects. `index.ts` in each package derives `MessageKey`, extracts `{placeholder}` names from the literal types (`Placeholders<T>`), and overloads `message()` so a missing or misspelt parameter fails to compile. `pluralMessage()` picks `<base>.<category>` with `Intl.PluralRules` and falls back to `.other`. All three functions use `const LOCALE = "en"`.

**Recommendation.** Treat `catalog.ts` as the English source and add one sibling file per locale:

```ts
// apps/web/src/messages/de.ts
import type { Translation } from "./index.ts";
export const de = {
  "app.title": "SurveyBeat",
  // ...every key, in the same order as catalog.ts
} as const satisfies Translation;
```

```ts
// apps/web/src/messages/index.ts (types only)
type En = typeof catalog;
export type Translation = { readonly [K in keyof En]: string };
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Keys whose `{placeholders}` differ from English; `never` when the translation is consistent. */
type Mismatched<T extends Translation> = {
  [K in keyof En]: Same<Placeholders<En[K]>, Placeholders<T[K]>> extends true ? never : K;
}[keyof En];
const deIsConsistent: [Mismatched<typeof de>] extends [never] ? true : Mismatched<typeof de> = true;
```

Tested with the repo's `tsc` (7.0.2) on a 4-key sample:

| Mistake in `de` | Result |
| - | - |
| A key missing | `TS2741: Property '"a.x"' is missing in type ... but required in type 'Translation'` |
| An extra key | `TS2353: Object literal may only specify known properties, and '"a.y"' does not exist in type 'Translation'` |
| `{nmae}` for `{name}` | `TS2322: Type 'true' is not assignable to type '"a.title"'`. The error names the bad key. |
| All correct | compiles |

The `message()` overloads keep using the English types, so call sites do not change. The runtime signature gains a locale. Two options:

- `messagesFor(locale)` returns `{ message, pluralMessage, formatDate }` bound to one catalog and one cached `Intl.PluralRules`. The app creates this once from its model, and each email render creates it once.
- A module-level `setLocale()`. This is simpler for the answer page, but it is global state and is unsafe in a Worker isolate that renders emails for several recipients.

Use `messagesFor` everywhere except the answer page. Each answer build imports exactly one catalog, so the answer page has no runtime choice (§3).

**Why not JSON.** With `resolveJsonModule`, TypeScript types a JSON import's values as `string`, not as literals, so `Placeholders<T>` returns `never` and the `{placeholder}` checks disappear. JSON helps external translation tools such as Crowdin or Lokalise. Under #86 there are no external translators: Claude drafts and the owner reviews in a PR, where a `.ts` diff is as readable as JSON. If a translation service is added later, a build step can export JSON from the TypeScript source.

**Plurals.** CLDR gives German cardinals the categories `one` (exactly 1, with no visible fraction digits) and `other`, the same as English ([CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)). Checked in Node 24:

```
new Intl.PluralRules("de").resolvedOptions().pluralCategories  → ["one", "other"]
[0, 1, 2, 1.5].map(n => new Intl.PluralRules("de").select(n))  → ["other", "one", "other", "other"]
```

So no plural key is added or removed. `pluralMessage` already uses `Intl.PluralRules` ([ECMA-402 §17](https://tc39.es/ecma402/#pluralrules-objects), [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules)). The fallback to `.other` covers a future locale with more categories, but a test should still require every category (§4).

**Dates and numbers.** Replace the constant locale with the resolved one in `formatDate` and in the `{count}` formatting. Node 24 output for 2026-11-07 12:00 UTC:

| Locale | `dateStyle: "medium"` | weekday and time | `NumberFormat` 1234.5 | percent 0.42 |
| - | - | - | - | - |
| `en` | Nov 7, 2026 | Saturday 12:00 PM | 1,234.5 | 42% |
| `de` | 07.11.2026 | Samstag, 12:00 | 1.234,5 | 42 % |
| `de-AT` | 07.11.2026 | Samstag, 12:00 | 1 234,5 | 42 % |
| `de-CH` | 07.11.2026 | Samstag, 12:00 | 1'234.5 | 42% |

Sources: [ECMA-402 `DateTimeFormat`](https://tc39.es/ecma402/#datetimeformat-objects), [MDN `Intl.DateTimeFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat), [MDN `Intl.NumberFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat).

Consequences:

- Several templates hard-code a unit, for example `"{rate}% response rate"`. German style puts a space before `%`. The German string can say `"{rate} %"`, so this needs no code change.
- Weekdays come from the catalog (`weekday.monday` and the others), not from `Intl`, so they are translated like any other key.
- Store only `en` or `de`. Format with `de`, not with the browser's region: Austrian and Swiss number formats differ from German ones, but the strings are identical, and one stored value is easier to reason about.
- `packages/domain/src/rounds/Lifecycle.ts` uses `Intl.DateTimeFormat("en-US")` to compute times, not to display them. Leave it unchanged.

## 2. Choosing the locale

**Where the Person setting lives.** A Person is a row in its Organization's Durable Object (`packages/cloudflare/migrations/0003_person.sql`: `id`, `email`, `workos_user_id`, `removed_at`). D1's `person_index` only routes sign-in, and AGENTS.md keeps D1 to the index and auth bookkeeping. Add a DO migration:

```sql
ALTER TABLE person ADD COLUMN locale TEXT CHECK (locale IN ('en', 'de'));       -- NULL: follow the browser
ALTER TABLE organization ADD COLUMN default_locale TEXT NOT NULL DEFAULT 'en' CHECK (default_locale IN ('en', 'de'));
```

In `packages/domain`, define the closed set once, for example `Locale = Schema.Literals(["en", "de"])`, and use it in the API schema, the email schemas and both catalogs.

A human in two Organizations is two Persons, so they have two settings. That matches the data model ("data never crosses Organizations", GLOSSARY), and it is rare enough to accept.

**The order of preference.** This follows #86: the Person's setting, then the browser, then the Organization.

| Surface | 1. Person | 2. Browser | 3. Organization |
| - | - | - | - |
| App (signed in) | `person.locale` from the session/me response | first of `navigator.languages` that matches `en` or `de` by primary subtag ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/languages)) | `organization.default_locale` |
| App (signed out: sign-in, choose Organization) | unknown | `navigator.languages` | `en` |
| Answer page | the locale the email was rendered in, carried in the link path (§3) | `navigator.languages`, only when the page is opened without a locale | `en` |
| Emails | `person.locale` | `person.detected_locale` (below), when it has been recorded | `organization.default_locale` |

Emails have no browser. If a Person never sets a language, the "browser" step can only be a value seen earlier. Recommendation: when a Person signs in and `person.locale` is `NULL`, the app sends its detected locale once and the DO stores it in a separate `detected_locale` column. An explicit choice still beats the detected one, and an Organization admin's changes to the default still reach everyone who never signed in. Without this column, a German speaker who never opens settings would get German UI and English emails.

`Accept-Language` ([RFC 9110 §12.5.4](https://www.rfc-editor.org/rfc/rfc9110#section-12.5.4)) is the server-side twin of `navigator.languages`. The Foldkit app is static and reads `navigator.languages` directly, so it does not need the header. The header matters only where the Worker renders HTML: the MainWorker pages in §6, and possibly a bare `/a` in §3. Match language ranges by primary subtag (`de-AT` → `de`) per [RFC 4647 lookup](https://www.rfc-editor.org/rfc/rfc4647#section-3.4).

**How emails pick the recipient's locale.** The Organization DO builds a `StoredEmail` per recipient and stores it as JSON in `email_send.content` (`packages/cloudflare/migrations/0002_email_send.sql`). The Queue consumer (`handleSendMessage` in `packages/cloudflare/src/EmailDelivery.ts`) later decodes it, derives the token (`withToken` in `packages/domain/src/email/EmailTemplates.ts`) and calls `renderEmail` (`packages/emails/src/render.tsx`). Recommendations:

- Add `locale: Locale` to every `StoredEmail` variant in `packages/domain/src/email/Email.ts`, and decode a missing field as `"en"`. Rows written before R2 are then still valid.
- Resolve the locale in the DO, when the send is created. The DO owns the Person and the Organization, and resolving there means a retry renders the same language as the first attempt.
- `renderEmail` calls `messagesFor(email.locale)` and passes it to the template. `Layout.tsx:39` sets `<Html lang={locale}>`. The subject and the plain-text part use the same messages.
- The email links include the locale (§3).

## 3. The answer page within budget

**Measured.** I ran `pnpm --filter @surveybeat/web build` on `main` and gzipped at level 9, the same as `apps/web/src/answer/budget.test.ts`:

| File | Raw | gzip |
| - | - | - |
| `answer.html` | 7,280 B | 2,706 B |
| inline CSS | | 1,508 B |
| `assets/answer-*.js` (critical) | 12,835 B | 4,057 B |
| `assets/messages-*.js` (critical, shared with the app) | 15,175 B | 5,186 B |
| **Critical path JS** | | **9,243 B of 10,240 B (997 B left)** |
| `assets/schema-validate-*.js` (after paint) | 434 B | 300 B |

`messages-*.js` is the chunk that `apps/web/src/answer/main.ts:1` and the app both import. It contains all 269 keys (4,693 B gzip as a bare object), the helpers, and Foldkit plugin instrumentation (the identity wrapper `n(…, "src/messages/index.ts#fill")`). Only 27 keys start with `answer.`.

**Catalog sizes (gzip -9, as `var r={…};export{r};`).** I wrote a German draft of all 27 `answer.*` keys (informal *du*, glossary from §5). It is 1.18× longer in characters than the English.

| Payload | gzip |
| - | - |
| Full app catalog, English | 4,693 B |
| Full app catalog, English + German (estimated ×1.10 from the answer subset) | about 9.9 KB |
| `answer.*` English | 756 B |
| `answer.*` German draft | 831 B |
| `answer.*` English + German together | 1,345 B |

**Options.**

| | A. Add `de` to today's shared chunk | B. One page, a head script picks a locale chunk | C. One prerendered page per locale (recommended) |
| - | - | - | - |
| Critical JS | about 14.4 KB, **over budget** | about 4.06 + 0.83 + helpers ≈ 5.2 KB | about 4.06 + 0.83 + helpers ≈ **5.2 KB** |
| Text before JS | English | English, then replaced: visible flash, and `noscript` stays English | correct locale, prerendered |
| Requests before Question text | 2 | 3, or 2 with an injected `modulepreload` | 2 (unchanged) |
| Who chooses | nobody | the script, from `navigator.languages`; the Person is unknown before `/exchange` | the email link, rendered for one known recipient |
| Build | none | one chunk per locale | the prerender plugin runs once per locale |

**C in detail.**

- Make `prerenderAnswer` in `apps/web/vite.config.ts` take a locale. Emit `dist/a/index.html`, `dist/a.html` and `dist/answer.html` for `en` (unchanged), and `dist/de/a/index.html` for `de`. Each page sets `lang` and `<title>` and prerenders its own scale labels and buttons.
- Give each page an answer entry that imports only its own `answer.*` catalog. One way is a small `messages/answer.en.ts` and `messages/answer.de.ts` (they must sit under `apps/web/src/messages/`, which `.oxlintrc.json` exempts from `no-literal-ui-text`) with two entries, `answer` and `answer-de`. Another is a Vite `resolve.alias` per build. Either way, the answer page stops importing `apps/web/src/messages/index.ts`. That removes the 5.2 KB shared chunk and the Foldkit instrumentation from its critical path, which is the biggest saving. The answer-only catalog keeps the same `Translation` type checks.
- Emails link to `${baseUrl}/de/a#t=…` for German recipients, in `InvitationEmail.tsx`, `ReminderEmail.tsx` and `Parts.tsx`. The token stays in the fragment, so the path reveals only the language.
- `/de/a` is a plain static asset. It is not in `runWorkerFirst` (`MainWorker.ts:114`), so the Worker is never invoked and no Worker log records it. Keep it that way.
- A bare `/a` (R1 email links, or a link typed by hand) stays English. Optional: a single line in the head script can redirect to `/de/a` when `navigator.languages[0]` starts with `de`, at the cost of one more navigation for those users. Only R1 links reach `/a` without a locale, so skipping the redirect is defensible.
- `/exchange` could also return the Person's locale. It is not needed, and returning it would add a Person attribute to a Submission Worker response for no gain. Do not add it.
- `budget.test.ts` counts every `messages-*.js` in `dist/assets` as critical. After the split, change it to measure each answer page's own script and the imports of that script, per locale.

Estimated cost for a German reader: about 5.2 KB gzip critical JS, compared with 9.2 KB today. The HTML grows by the length of the German labels, roughly +30 B gzip against the 8 KB budget. These are estimates: the 5.2 KB assumes about 300 B of helpers once the shared chunk is gone. Run `budget.test.ts` once per locale on the real build.

## 4. HTML `lang`, `<title>`, and tests

- `lang` declares the language of the document ([WHATWG HTML §3.2.6.2](https://html.spec.whatwg.org/multipage/dom.html#the-lang-and-xml:lang-attributes)), with BCP 47 tags ([RFC 5646](https://www.rfc-editor.org/rfc/rfc5646)). Screen readers choose their pronunciation from it, and browsers use it for hyphenation and translation prompts. That makes it part of WCAG 2.2 AA, which SPEC §5.2 requires: [SC 3.1.1 Language of Page](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html).
  - **Answer page:** set `lang` at prerender. The shell's `<html lang="en">` becomes a placeholder the plugin replaces.
  - **App:** set `document.documentElement.lang` whenever the resolved locale changes. `index.html` keeps `lang="en"` as the pre-JS default.
  - **Emails:** set `<Html lang>` per message.
- The `<title>` rule in `messages.test.ts` ("leaves the title to the catalog") checks the source shells, which stay empty. Extend it to the built pages: each `dist/**/a/index.html` has a non-empty `<title>` equal to that locale's `answer.title`, and its `lang` equal to that locale.
- The "no user-facing text" test checks the source shells too. It needs no change.
- New tests:
  1. Key, extra-key and placeholder parity are compile-time checks (§1), so `pnpm typecheck` enforces them. Add a runtime test as well, for the case where someone weakens the types: for each locale, `Object.keys(de)` equals `Object.keys(catalog)` and the placeholder sets match per key.
  2. For each locale and each plural base, every category in `new Intl.PluralRules(locale).resolvedOptions().pluralCategories` has a key.
  3. `pluralMessage("answer.remaining", 1)` returns `"Noch 1 Frage"`, and `formatDate` returns `07.11.2026` for `de`.
  4. Email snapshots in `packages/emails/src/__snapshots__` for each template × locale, including the `lang` and the `/de/a` link.
  5. A workerd adapter test that renders one German email through the Queue consumer. Emails render in workerd, and the `Intl` output above was measured in Node.
- `no-literal-ui-text` (`tools/oxlint-plugin-surveybeat/index.js`) needs no change for `de.ts`. `.oxlintrc.json` applies it to `apps/web/src/**/*.{ts,tsx}` except `apps/web/src/messages/**`, and to `packages/emails/src/**/*.tsx` only, so new catalog files under `messages/` (and `packages/emails/src/messages/de.ts`) are outside it.

## 5. Translation workflow and glossary

**Workflow.**

1. Claude drafts `de.ts` for each package in the same PR that adds the key. After the initial bulk PR, every PR that adds an English key must add the German one, and `tsc` fails otherwise.
2. The PR description lists new and changed keys as an English → German table, so the owner reviews strings without reading code.
3. The owner reviews in the PR and suggests changes inline. The privacy texts (`answer.anonymity`, `answer.comment.disclosure`, `answer.state.otherBrowser`, `invitation.anonymity`) need a careful read: they are promises to members (SPEC §3.1).
4. Add a German column to `GLOSSARY.md`, or a short `docs/glossary-de.md`, so drafts stay consistent.

**Form of address.** Use *du*. The app is a peer tool used within a team, and the English copy is informal ("Want to say more?"). *Sie* is the alternative for conservative Organizations. Making it a per-Organization setting would double the catalog, so it is not worth it in R2.

**Glossary renderings (proposal).** German capitalises every noun, so English's capitalised domain nouns lose their visual signal. Consistent wording carries that signal instead.

| Term | German | Note |
| - | - | - |
| Organization | Organisation (die) | |
| Organization admin | Organisations-Admin (der/die) | |
| Person / People | Person / Personen | |
| Team | Team (das) | Stays English, as is normal German usage. |
| Lead | Teamleitung (die) | Gender-neutral, and avoids *Leiter/Leiterin*. *Lead* is jargon in German. |
| Membership / member | Mitgliedschaft / Mitglied | |
| Pulse | **Pulse** (der), plural Pulses | Product noun, stays English. *Puls* reads as heartbeat; *Pulsbefragung* is the alternative if the owner prefers German. |
| Round | Runde (die) | "Runde vom 07.11.2026". |
| Question / Question version | Frage / Fragenversion | |
| Dimension | Dimension (die) | |
| Template | Vorlage (die) | |
| Invitation | Einladung (die) | |
| Check-in | Check-in (der) | Kept as in the English copy. |
| Submission | Einsendung (die) | *Antwort* is taken by Answer. *Abgabe* is the alternative. |
| Answer | Antwort (die) | |
| Participation record | Teilnahme (die) | |
| Edit key | Bearbeitungsschlüssel (der) | |
| Results | Ergebnisse | |
| Comment / Comment theme | Kommentar / Kommentarthema | |
| Redaction | Entfernen persönlicher Angaben | Describe what happens rather than use *Schwärzung*. |
| Minimum group size | Mindestgruppengröße | |
| Contributor | Beitragende Person, plural Beitragende | |
| Action | Maßnahme (die) | |

**Product nouns that stay English:** SurveyBeat, Pulse, Team, Check-in. Everything else is translated.

## 6. Gaps and risks

- **MainWorker HTML pages.** `renderDeliveryPage` and the unsubscribe page in `packages/cloudflare/src/MainWorker.ts` (around lines 260 and 320) contain literal English, including `<title>Change delivery time · SurveyBeat</title>`, and hard-code `<html lang="en">`. They use neither catalog, and `.oxlintrc.json` does not apply `no-literal-ui-text` to `packages/cloudflare` at all. They need catalog keys (the emails catalog fits, because email links open them) and a locale: the link can carry it, like `/de/a`, or `Accept-Language` can decide.
- **Template and Question text are content, not UI.** `WEEKLY_TEAM_HEALTH` in `packages/domain/src/pulses/Template.ts` holds English Question text and scale labels. They are copied into each Pulse and frozen per Round. In a German team, German UI around English Questions looks broken. Recommendation for the R2 ticket: give the Template a German variant, and copy the variant in the creating Lead's locale. A Pulse stays single-language. Mixed-language Teams see the Lead's language in the Questions, and do not get per-recipient Question translations in R2.
- **Redaction and German comments.** Rule-based redaction (ADR 0009) matches the Organization's People names, which works in any language. German phone number formats (`0171 …`, `+49 (0)…`) and German contact phrasing need test cases. AI themes (ADR 0015) receive German text, and the theme prompt should answer in the Round's language. This belongs to the ticket for #88.
- **Small Teams and language.** Never put locale in a Submission, the Submission request, or any per-Round record. In a Team where one member reads German, the locale would identify that member. With C, the Submission Worker never sees the locale at all.
- **Budget test drift.** The current test sums every `messages-*.js` in `dist/assets`. After the split it would either miss the new per-locale chunks or count the app's chunk. Rewrite it per page before the split lands, so the gate never goes silent.
- **German text runs longer.** It was 1.18× the English in the answer subset. Check that buttons and the scale wrap at 320 px. *Speichern und weiter* fits, but compound nouns such as *Bearbeitungsschlüssel* need `hyphens: auto`, which uses `lang`.

## Recommendation for the follow-up tickets

1. Domain: `Locale`, `messagesFor(locale)`, the `Translation` type checks, and `de.ts` for both catalogs, with tests from §4.
2. Organization DO: migration (`person.locale`, `person.detected_locale`, `organization.default_locale`), the API to read and set them, and the settings UI.
3. Emails: `locale` in `StoredEmail`, resolved at creation, rendered in the consumer, with `/de/a` links.
4. Answer page: per-locale prerender, an answer-only catalog, and the budget test rewritten per page. This amends the answer build in ADR 0008. Record it as a short ADR when the ticket is built.
5. MainWorker pages and the German Template, as in §6.
