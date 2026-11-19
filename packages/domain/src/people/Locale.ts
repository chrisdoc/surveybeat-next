import * as Schema from "effect/Schema";

export const Locale = Schema.Literals(["en"]);
export type Locale = typeof Locale.Type;

export const DEFAULT_LOCALE: Locale = "en";

const isLocale = Schema.is(Locale);

export const matchLocale = (tag: string): Locale | undefined => {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return isLocale(primary) ? primary : undefined;
};

export const browserLocale = (languages: readonly string[]): Locale | undefined => {
  for (const tag of languages) {
    const locale = matchLocale(tag);
    if (locale !== undefined) return locale;
  }
  return undefined;
};

export const resolveLocale = (choice: {
  readonly person: Locale | null;
  readonly browser: Locale | null | undefined;
  readonly organization: Locale;
}): Locale => choice.person ?? choice.browser ?? choice.organization;

export const localeOrNull = (value: unknown): Locale | null => (isLocale(value) ? value : null);

export const localeOr = (value: unknown, fallback: Locale): Locale => (isLocale(value) ? value : fallback);
