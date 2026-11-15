import type { Locale } from "@surveybeat/domain";

export const answerPath = (locale: Locale): string => (locale === "de" ? "/de/a" : "/a");

export const langQuery = (locale: Locale): string => (locale === "de" ? "&lang=de" : "");
