import type { Locale } from "@surveybeat/domain";

/** The answer page for a locale: `/de/a` for German, `/a` for English (ADR 0018). */
export const answerPath = (locale: Locale): string => (locale === "de" ? "/de/a" : "/a");

/**
 * The `lang` query the delivery and unsubscribe pages read, German only: English links stay as they were.
 * Starts with `&`, so it appends to a URL that already has a query.
 */
export const langQuery = (locale: Locale): string => (locale === "de" ? "&lang=de" : "");
