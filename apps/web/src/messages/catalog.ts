/**
 * Every user-facing string of both web entries. English only.
 *
 * Keys are flat. Templates use `{placeholder}`. Plural forms are separate keys
 * named `<base>.<Intl.PluralRules category>`; `.other` is required.
 */
export const catalog = {
  "app.title": "SurveyBeat",
  "app.placeholder": "Your team's pulse will show up here.",
  "app.start": "Get started",
  "answer.title": "Your answer",
  "answer.placeholder": "Your Question will appear here.",
  "answer.remaining.one": "{count} Question left",
  "answer.remaining.other": "{count} Questions left",
  "answer.closes": "Closes on {date}",
} as const;
