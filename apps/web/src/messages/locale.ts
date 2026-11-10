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
}

const isMessageKey = (table: Translation, key: string): key is MessageKey => Object.hasOwn(table, key);

const build = (locale: Locale): Messages => {
  const table = tables[locale];
  const pluralRules = new Intl.PluralRules(locale);
  const numberFormat = new Intl.NumberFormat(locale);

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

  return { locale, message, pluralMessage, formatDate };
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
export let formatDate: Messages["formatDate"] = messagesFor("en").formatDate;

/** Switches every later `message` call to `locale` and sets `<html lang>`. The browser app has one reader, so module state is safe here; Workers must use `messagesFor`. */
export const setLocale = (locale: Locale): void => {
  const messages = messagesFor(locale);
  currentLocale = locale;
  message = messages.message;
  pluralMessage = messages.pluralMessage;
  formatDate = messages.formatDate;
  if (typeof document !== "undefined") document.documentElement.lang = locale;
};
