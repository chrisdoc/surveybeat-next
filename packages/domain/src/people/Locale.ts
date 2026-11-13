import * as Schema from "effect/Schema";

/** The languages SurveyBeat ships (ADR 0018). Only the primary subtag is stored. */
export const Locale = Schema.Literals(["en", "de"]);
export type Locale = typeof Locale.Type;

/** What anything without a language reads as, such as a send stored before R2. */
export const DEFAULT_LOCALE: Locale = "en";

const isLocale = Schema.is(Locale);

/** A BCP 47 tag matched by its primary subtag (`de-AT` → `de`); `undefined` when SurveyBeat has no such language. */
export const matchLocale = (tag: string): Locale | undefined => {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return isLocale(primary) ? primary : undefined;
};

/** The first of the browser's languages (`navigator.languages`, most preferred first) that SurveyBeat has. */
export const browserLocale = (languages: ReadonlyArray<string>): Locale | undefined => {
  for (const tag of languages) {
    const locale = matchLocale(tag);
    if (locale !== undefined) return locale;
  }
  return undefined;
};

/**
 * Which language to show (ADR 0018): the Person's own setting, then the browser's, then the
 * Organization's default. Emails have no browser, so they pass the language last detected at sign-in.
 */
export const resolveLocale = (choice: {
  readonly person: Locale | null;
  readonly browser: Locale | null | undefined;
  readonly organization: Locale;
}): Locale => choice.person ?? choice.browser ?? choice.organization;
