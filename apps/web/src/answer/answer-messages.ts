import type { AnswerKey, AnswerTranslation, Placeholders, answerCatalog } from "../messages/answer.ts";

type AnswerCatalog = typeof answerCatalog;

type Value = string | number;

type KeysWithoutParams = {
  [K in AnswerKey]: [Placeholders<AnswerCatalog[K]>] extends [never] ? K : never;
}[AnswerKey];

type KeysWithParams = Exclude<AnswerKey, KeysWithoutParams>;

type Params<K extends AnswerKey> = Readonly<Record<Placeholders<AnswerCatalog[K]>, Value>>;

export interface AnswerMessage {
  <K extends KeysWithoutParams>(key: K): string;
  <K extends KeysWithParams>(key: K, params: Params<K>): string;
}

function fill(template: string, params: Readonly<Record<string, Value>>): string {
  return template.replaceAll(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
}

export function answerMessages(table: AnswerTranslation): AnswerMessage {
  function message<K extends KeysWithoutParams>(key: K): string;
  function message<K extends KeysWithParams>(key: K, params: Params<K>): string;
  function message(key: AnswerKey, params: Readonly<Record<string, Value>> = {}): string {
    return fill(table[key], params);
  }

  return message;
}
