import { Option, Schema } from "effect";
import { keptAnswersPrefix } from "../answer/kept-answers.ts";

export const KeptAnswer = Schema.Struct({
  value: Schema.optionalKey(Schema.Finite),
  comment: Schema.optionalKey(Schema.String),
});

export type KeptAnswer = typeof KeptAnswer.Type;

export const KeptAnswers = Schema.Record(Schema.String, Schema.Record(Schema.String, KeptAnswer));

export type KeptAnswers = typeof KeptAnswers.Type;

const StoredRound = Schema.Struct({
  expiresAt: Schema.Finite,
  answers: Schema.Record(Schema.String, KeptAnswer),
});

const decodeStoredRound = Schema.decodeUnknownOption(Schema.fromJsonString(StoredRound));

const keptAnswersKeys = (storage: Pick<Storage, "length" | "key">): string[] => {
  const keys: string[] = [];

  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);

    if (key !== null && key.startsWith(keptAnswersPrefix)) {
      keys.push(key);
    }
  }

  return keys;
};

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

export const clearKeptAnswers = (storage: Pick<Storage, "length" | "key" | "removeItem">): void => {
  try {
    for (const key of keptAnswersKeys(storage)) {
      storage.removeItem(key);
    }
  } catch {}
};

const editKeyPrefix = "sb_edit_";

export const clearOwnBrowserData = (storage: Pick<Storage, "length" | "key" | "removeItem">): void => {
  try {
    const keys: string[] = [];

    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);

      if (key !== null && (key.startsWith(keptAnswersPrefix) || key.startsWith(editKeyPrefix))) {
        keys.push(key);
      }
    }

    for (const key of keys) {
      storage.removeItem(key);
    }
  } catch {}
};

export const browserStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
