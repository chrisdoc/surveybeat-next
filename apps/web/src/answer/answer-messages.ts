import type { AnswerKey, AnswerTranslation, Placeholders, answerCatalog } from "../messages/answer.ts";

type AnswerCatalog = typeof answerCatalog;
type Value = string | number;
type KeysWithoutParams = {
  [K in AnswerKey]: [Placeholders<AnswerCatalog[K]>] extends [never] ? K : never;
}[AnswerKey];
type KeysWithParams = Exclude<AnswerKey, KeysWithoutParams>;
type Params<K extends AnswerKey> = Readonly<Record<Placeholders<AnswerCatalog[K]>, Value>>;

/**
 * Looks up an answer-page message; placeholders are checked against the English template.
 * Kept out of `messages/answer.ts` so that module (and the English strings) is only in the English page.
 */
export interface AnswerMessage {
  <K extends KeysWithoutParams>(key: K): string;
  <K extends KeysWithParams>(key: K, params: Params<K>): string;
}

/** Fills `{placeholder}` templates. */
function fill(template: string, params: Readonly<Record<string, Value>>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
}

/** Builds the answer page's `message` for one locale's table (the English catalog or a translation). */
export function answerMessages(table: AnswerTranslation): AnswerMessage {
  function message<K extends KeysWithoutParams>(key: K): string;
  function message<K extends KeysWithParams>(key: K, params: Params<K>): string;
  function message(key: AnswerKey, params: Readonly<Record<string, Value>> = {}): string {
    return fill(table[key], params);
  }
  return message;
}
