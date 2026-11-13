// @effect-diagnostics globalDate:off -- the view formats or compares an instant that arrived from the API against the browser clock; nothing here is stored on the server.

import type { Locale } from "@surveybeat/domain";
import { catalog } from "./catalog.ts";
import { de } from "./de.ts";
import {
  fill,
  type KeysWithoutParams,
  type KeysWithParams,
  type MessageKey,
  type Params,
  type PluralKey,
  type PluralParams,
  type Translation,
  type Value,
} from "./index.ts";

const tables = { en: catalog, de } satisfies Record<Locale, Translation>;

interface MessageFn {
  <K extends KeysWithoutParams>(key: K): string;
  <K extends KeysWithParams>(key: K, params: Params<K>): string;
}

/** Message lookup bound to one locale. Workers and tests use this; the browser app uses the live `message` below. */
export interface Messages {
  readonly locale: Locale;
  readonly message: MessageFn;
  readonly pluralMessage: <B extends PluralKey>(base: B, count: number, params?: PluralParams<B>) => string;
  readonly formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) => string;
  /** A Dimension or Question score, one decimal place: "4.0", "3,6" in German. */
  readonly formatScore: (score: number) => string;
  /** A signed score change, one decimal place, with a sign on every non-zero value: "+0.5", "+0,5". */
  readonly formatChange: (change: number) => string;
  /** A ratio as a whole percentage: "75%", "75 %" in German. */
  readonly formatPercent: (ratio: number) => string;
  /** A `YYYY-MM-DD` Round date as a medium date; the input unchanged when it is not a date. */
  readonly formatRoundDate: (isoDate: string) => string;
}

const isMessageKey = (table: Translation, key: string): key is MessageKey => Object.hasOwn(table, key);

const build = (locale: Locale): Messages => {
  const table = tables[locale];
  const pluralRules = new Intl.PluralRules(locale);
  const numberFormat = new Intl.NumberFormat(locale);
  const scoreFormat = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const changeFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  });
  const percentFormat = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });

  function message<K extends KeysWithoutParams>(key: K): string;
  function message<K extends KeysWithParams>(key: K, params: Params<K>): string;
  function message(key: MessageKey, params: Readonly<Record<string, Value>> = {}): string {
    return fill(table[key], params);
  }

  function pluralMessage<B extends PluralKey>(base: B, count: number, params?: PluralParams<B>): string {
    const specific = `${base}.${pluralRules.select(count)}`;
    const template = isMessageKey(table, specific) ? table[specific] : table[`${base}.other`];
    return fill(template, { ...params, count: numberFormat.format(count) });
  }

  function formatDate(date: Date, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
    return new Intl.DateTimeFormat(locale, options).format(date);
  }

  function formatScore(score: number): string {
    return scoreFormat.format(score);
  }

  function formatChange(change: number): string {
    return changeFormat.format(change);
  }

  function formatPercent(ratio: number): string {
    return percentFormat.format(ratio);
  }

  function formatRoundDate(isoDate: string): string {
    const date = new Date(`${isoDate}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return isoDate;
    return formatDate(date, { dateStyle: "medium", timeZone: "UTC" });
  }

  return {
    locale,
    message,
    pluralMessage,
    formatDate,
    formatScore,
    formatChange,
    formatPercent,
    formatRoundDate,
  };
};

const cache = new Map<Locale, Messages>();

/** The messages for `locale`, built once per language. Safe on Workers, where no module state is shared per request. */
export const messagesFor = (locale: Locale): Messages => {
  const cached = cache.get(locale);
  if (cached !== undefined) return cached;
  const messages = build(locale);
  cache.set(locale, messages);
  return messages;
};

/** The app's active language. Reassigned by `setLocale`; call sites read the live binding. */
export let currentLocale: Locale = "en";
export let message: Messages["message"] = messagesFor("en").message;
export let pluralMessage: Messages["pluralMessage"] = messagesFor("en").pluralMessage;

/** A rough duration for people: minutes once it is a whole minute, seconds below. */
export const formatDuration = (seconds: number): string =>
  seconds >= 60
    ? message("duration.minutes", { minutes: Math.round(seconds / 60) })
    : message("duration.seconds", { seconds });
export let formatDate: Messages["formatDate"] = messagesFor("en").formatDate;
export let formatScore: Messages["formatScore"] = messagesFor("en").formatScore;
export let formatChange: Messages["formatChange"] = messagesFor("en").formatChange;
export let formatPercent: Messages["formatPercent"] = messagesFor("en").formatPercent;
export let formatRoundDate: Messages["formatRoundDate"] = messagesFor("en").formatRoundDate;

/** Switches every later `message` call to `locale` and sets `<html lang>`. The browser app has one reader, so module state is safe here; Workers must use `messagesFor`. */
export const setLocale = (locale: Locale): void => {
  const messages = messagesFor(locale);
  currentLocale = locale;
  message = messages.message;
  pluralMessage = messages.pluralMessage;
  formatDate = messages.formatDate;
  formatScore = messages.formatScore;
  formatChange = messages.formatChange;
  formatPercent = messages.formatPercent;
  formatRoundDate = messages.formatRoundDate;
  if (typeof document !== "undefined") document.documentElement.lang = locale;
};
