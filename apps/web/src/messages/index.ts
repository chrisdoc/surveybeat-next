import { catalog } from "./catalog.ts";

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

type PluralBase<K extends string> = K extends `${infer Base}.other` ? Base : never;
export type PluralKey = PluralBase<MessageKey>;
type PluralParams<B extends PluralKey> = Readonly<
  Record<Exclude<Placeholders<Catalog[`${B}.other`]>, "count">, Value>
>;

const LOCALE = "en";
const pluralRules = new Intl.PluralRules(LOCALE);

const isMessageKey = (key: string): key is MessageKey => Object.hasOwn(catalog, key);

function fill(template: string, params: Readonly<Record<string, Value>>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
}

/** Looks up a message; placeholders are checked against the template at compile time. */
export function message<K extends KeysWithoutParams>(key: K): string;
export function message<K extends KeysWithParams>(key: K, params: Params<K>): string;
export function message(key: MessageKey, params: Readonly<Record<string, Value>> = {}): string {
  return fill(catalog[key], params);
}

/** Picks the plural form for `count` with `Intl.PluralRules`; `{count}` is filled in. */
export function pluralMessage<B extends PluralKey>(base: B, count: number, params?: PluralParams<B>): string {
  const specific = `${base}.${pluralRules.select(count)}`;
  const template = isMessageKey(specific) ? catalog[specific] : catalog[`${base}.other`];
  return fill(template, { ...params, count: new Intl.NumberFormat(LOCALE).format(count) });
}

/** Formats a date for display with `Intl.DateTimeFormat`. */
export function formatDate(
  date: Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return new Intl.DateTimeFormat(LOCALE, options).format(date);
}
