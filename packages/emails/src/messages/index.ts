import type { Locale } from "@surveybeat/domain";
import { catalog } from "./catalog.ts";
import { de } from "./de.ts";

type Catalog = typeof catalog;
export type MessageKey = keyof Catalog;
type Value = string | number;

type Placeholders<T extends string> = T extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;
type Params<K extends MessageKey> = Readonly<Record<Placeholders<Catalog[K]>, Value>>;
type KeysWithoutParams = {
  [K in MessageKey]: [Placeholders<Catalog[K]>] extends [never] ? K : never;
}[MessageKey];
type KeysWithParams = Exclude<MessageKey, KeysWithoutParams>;

/** A complete set of strings for one language: every key of the English `catalog`. */
export type Translation = { readonly [K in MessageKey]: string };

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Keys whose `{placeholders}` differ from English; `never` when the translation is consistent. */
export type Mismatched<T extends Translation> = {
  [K in MessageKey]: Same<Placeholders<Catalog[K]>, Placeholders<T[K]>> extends true ? never : K;
}[MessageKey];

const tables = { en: catalog, de } satisfies Record<Locale, Translation>;

function fill(template: string, params: Readonly<Record<string, Value>>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
}

export interface Messages {
  readonly locale: Locale;
  /** Looks up a message in this locale; placeholders are checked against the English template at compile time. */
  message<K extends KeysWithoutParams>(key: K): string;
  message<K extends KeysWithParams>(key: K, params: Params<K>): string;
}

const cache = new Map<Locale, Messages>();

/** The messages of one language. Callers pass the locale of the email they render, never a module-level default. */
export const messagesFor = (locale: Locale): Messages => {
  const cached = cache.get(locale);
  if (cached !== undefined) return cached;

  const table: Translation = tables[locale];
  function message<K extends KeysWithoutParams>(key: K): string;
  function message<K extends KeysWithParams>(key: K, params: Params<K>): string;
  function message(key: MessageKey, params: Readonly<Record<string, Value>> = {}): string {
    return fill(table[key], params);
  }

  const messages: Messages = { locale, message };
  cache.set(locale, messages);
  return messages;
};
