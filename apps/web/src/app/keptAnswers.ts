import { Option, Schema } from "effect";
import { keptAnswersPrefix } from "../answer/kept-answers.ts";

/** One Answer the member kept on this device. A Rating has `value`; a SingleChoice has `value` (option index); a LongText has `comment`. */
export const KeptAnswer = Schema.Struct({
  value: Schema.optionalKey(Schema.Finite),
  comment: Schema.optionalKey(Schema.String),
});
export type KeptAnswer = typeof KeptAnswer.Type;

/** Kept answers keyed by roundId, then by questionVersionId. */
export const KeptAnswers = Schema.Record(Schema.String, Schema.Record(Schema.String, KeptAnswer));
export type KeptAnswers = typeof KeptAnswers.Type;

/** What the answer page writes under `sb_answers_<roundId>`. */
const StoredRound = Schema.Struct({
  expiresAt: Schema.Finite,
  answers: Schema.Record(Schema.String, KeptAnswer),
});
const decodeStoredRound = Schema.decodeUnknownOption(Schema.fromJsonString(StoredRound));

/** Every key the answer page wrote, collected before anything is removed. */
const keptAnswersKeys = (storage: Pick<Storage, "length" | "key">): Array<string> => {
  const keys: Array<string> = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key !== null && key.startsWith(keptAnswersPrefix)) keys.push(key);
  }
  return keys;
};

/**
 * Reads the member's kept answers for this device. Entries past their expiry or that do not decode are
 * removed from storage. Never throws: unavailable storage reads as no kept answers.
 */
export const readKeptAnswers = (
  storage: Pick<Storage, "length" | "key" | "getItem" | "removeItem">,
  now: number,
): KeptAnswers => {
  try {
    const kept: Record<string, Record<string, KeptAnswer>> = {};
    for (const key of keptAnswersKeys(storage)) {
      const stored = decodeStoredRound(storage.getItem(key) ?? "");
      if (Option.isSome(stored) && stored.value.expiresAt > now) {
        kept[key.slice(keptAnswersPrefix.length)] = stored.value.answers;
      } else {
        storage.removeItem(key);
      }
    }
    return kept;
  } catch {
    return {};
  }
};

/** Removes every kept answer on this device and nothing else (the answer page's edit keys stay). Never throws. */
export const clearKeptAnswers = (storage: Pick<Storage, "length" | "key" | "removeItem">): void => {
  try {
    for (const key of keptAnswersKeys(storage)) storage.removeItem(key);
  } catch {
    // Storage can be unavailable; there is nothing to clear then.
  }
};

/** The browser's localStorage, or null where reading it throws (sandboxed frames, blocked storage). */
export const browserStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
