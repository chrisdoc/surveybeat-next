/**
 * Every user-facing string of both web entries. English only.
 *
 * Keys are flat. Templates use `{placeholder}`. Plural forms are separate keys
 * named `<base>.<Intl.PluralRules category>`; `.other` is required.
 */
export const catalog = {
  "app.title": "SurveyBeat",
  "app.placeholder": "Your team's pulse will show up here.",
  "app.loading": "Loading…",
  "app.error": "Something went wrong. Try again in a moment.",
  "app.retry": "Try again",
  "signIn.title": "Sign in to SurveyBeat",
  "signIn.intro": "Use a code sent to your email, or your Google or Microsoft account.",
  "signIn.action": "Sign in",
  "signIn.failed": "Signing in did not work. Please try again.",
  "signOut.action": "Sign out",
  "createOrganization.title": "Create an Organization",
  "createOrganization.intro": "Your Organization holds your Teams and People. You become its admin.",
  "createOrganization.name": "Organization name",
  "createOrganization.action": "Create Organization",
  "notInOrganization.title": "You're not part of an Organization yet",
  "notInOrganization.intro": "Ask your team lead to add the email you signed in with, then sign in again.",
  "chooseOrganization.title": "Choose an Organization",
  "chooseOrganization.intro": "You belong to more than one. Pick the one to open.",
  "signedIn.title": "{organization}",
  "answer.title": "Your answer",
  "answer.placeholder": "Your Question will appear here.",
  "answer.remaining.one": "{count} Question left",
  "answer.remaining.other": "{count} Questions left",
  "answer.closes": "Closes on {date}",
} as const;
