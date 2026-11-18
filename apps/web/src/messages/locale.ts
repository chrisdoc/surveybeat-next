// @effect-diagnostics globalDate:off -- the view formats or compares an instant that arrived from the API against the browser clock; nothing here is stored on the server.

import type { Locale } from "@surveybeat/domain";
import { catalog } from "./catalog.ts";
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

const tables = { en: catalog } satisfies Record<Locale, Translation>;

interface MessageFn {
  <K extends KeysWithoutParams>(key: K): string;
  <K extends KeysWithParams>(key: K, params: Params<K>): string;
}

export interface Messages {
  readonly locale: Locale;
  readonly message: MessageFn;
  readonly pluralMessage: <B extends PluralKey>(base: B, count: number, params?: PluralParams<B>) => string;
  readonly formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) => string;

  readonly formatNumber: (value: number) => string;

  readonly formatScore: (score: number) => string;

  readonly formatChange: (change: number) => string;

  readonly formatPercent: (ratio: number) => string;

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

  function formatNumber(value: number): string {
    return numberFormat.format(value);
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
    formatNumber,
    formatScore,
    formatChange,
    formatPercent,
    formatRoundDate,
  };
};

const cache = new Map<Locale, Messages>();

export const messagesFor = (locale: Locale): Messages => {
  const cached = cache.get(locale);
  if (cached !== undefined) return cached;
  const messages = build(locale);
  cache.set(locale, messages);
  return messages;
};

export let currentLocale: Locale = "en";
export let message: Messages["message"] = messagesFor("en").message;
export let pluralMessage: Messages["pluralMessage"] = messagesFor("en").pluralMessage;

export const formatDuration = (seconds: number): string =>
  seconds >= 60
    ? message("duration.minutes", { minutes: Math.round(seconds / 60) })
    : message("duration.seconds", { seconds });
export let formatDate: Messages["formatDate"] = messagesFor("en").formatDate;
export let formatNumber: Messages["formatNumber"] = messagesFor("en").formatNumber;
export let formatScore: Messages["formatScore"] = messagesFor("en").formatScore;
export let formatChange: Messages["formatChange"] = messagesFor("en").formatChange;
export let formatPercent: Messages["formatPercent"] = messagesFor("en").formatPercent;
export let formatRoundDate: Messages["formatRoundDate"] = messagesFor("en").formatRoundDate;

export const setLocale = (locale: Locale): void => {
  const messages = messagesFor(locale);
  currentLocale = locale;
  message = messages.message;
  pluralMessage = messages.pluralMessage;
  formatDate = messages.formatDate;
  formatNumber = messages.formatNumber;
  formatScore = messages.formatScore;
  formatChange = messages.formatChange;
  formatPercent = messages.formatPercent;
  formatRoundDate = messages.formatRoundDate;
  if (typeof document !== "undefined") document.documentElement.lang = locale;
};
