# English is the only shipped language for now; German stays a path back

English is the only language the app, the answer page, the landing page, and emails ship in. This supersedes the Release 2 German rollout of [ADR 0018](0018-german-localization.md) for now, and the German landing page in [ADR 0020](0020-landing-page-is-a-static-site-worker.md).

- **Shipped language:** `Locale` is `Schema.Literals(["en"])`. The `Locale` type, `messagesFor(locale)`, the `Record<Locale, …>` tables, and the API fields `locale`, `detectedLocale`, and `defaultLocale` stay, so a language comes back by adding its literal.
- **Removed:** the German catalogs, the German answer page (`/de/a`), the German landing page (`/de/`), the German weekly team health Template, the account menu's language field, and the Settings "Default language" section.
- **Kept:** the typed-catalog approach, so a missing key, an extra key, or a wrong `{placeholder}` still fails typecheck. Redaction's German phone-number cases stay.
- **Stored values:** rows that already hold `de` read back as unset (`person.locale`, `person.detected_locale`) or as English (`organization.default_locale`, the locale of a stored email). No migration rewrites them.
- **Bringing German back:** add the literal to `Locale`, a catalog per surface (web, answer, emails), the bilingual weekly team health Template, an answer page per locale with its own budget check, and the language picker. The stored values then read as German again without a migration.

## Consequences

- Every page and email renders in English. A `lang=de` or `/de/` link falls back to English.
- A Person who had chosen German no longer sees the German UI, and cannot change the language in the app. The API still accepts a language, so a later client can set one.
- Adding a language is a code change in the catalogs and the Template, not a data migration.
