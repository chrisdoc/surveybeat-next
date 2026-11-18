import type { Locale } from "@surveybeat/domain";

const ANSWER_PATHS = { en: "/a" } satisfies Record<Locale, string>;

const LANG_QUERIES = { en: "" } satisfies Record<Locale, string>;

export const answerPath = (locale: Locale): string => ANSWER_PATHS[locale];

export const langQuery = (locale: Locale): string => LANG_QUERIES[locale];
