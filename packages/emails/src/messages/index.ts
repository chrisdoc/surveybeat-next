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

function fill(template: string, params: Readonly<Record<string, Value>>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
}

/** Looks up a message; placeholders are checked against the template at compile time. */
export function message<K extends KeysWithoutParams>(key: K): string;
export function message<K extends KeysWithParams>(key: K, params: Params<K>): string;
export function message(key: MessageKey, params: Readonly<Record<string, Value>> = {}): string {
  return fill(catalog[key], params);
}
