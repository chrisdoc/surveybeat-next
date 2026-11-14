# German ships as typed catalogs per locale, a prerendered answer page per locale, and a bilingual Template

Release 2 adds German to the app, the answer page, and emails ([research](../research/german-localization.md)).

- **Catalogs:** each catalog gets a `de.ts` beside the English one, typed so a missing key, an extra key, or a wrong `{placeholder}` fails typecheck. The message functions take the locale instead of the fixed `"en"`; plurals, dates, and numbers come from `Intl` for that locale.
- **Which language:** a Person's own setting, then the browser's languages, then the Organization's default. Emails render in the language stored with the send when it is created.
- **Answer page:** one prerendered page per locale (`/a`, `/de/a`), each loading only its own answer catalog. The Invitation link picks the page from the recipient's language. ADR 0008's budget applies to each page separately.
- **Words:** informal "du". Pulse and Team stay English; Round → Runde, Lead → Teamleitung, Organization → Organisation, Submission → Einsendung. Claude drafts, the product owner reviews in the PR.
- **Template:** the weekly team health Template ships in both languages; a new Pulse copies its Questions in the Lead's language. Existing Pulses keep their Questions.
- **Privacy:** the language is never stored with a Submission or an Answer. In a small Team it could single out the one German reader.

## Consequences

- The budget test runs per answer page.
- Pages rendered in `MainWorker.ts` (delivery time, unsubscribe) hold hard-coded English and must move to the catalog.
- Redaction gains German phone number cases.
- A Team with mixed languages sees the Pulse's Questions in the language they were created in.
