export const keptAnswersPrefix = "sb_answers_";
export const keptAnswersLifetimeMs = 365 * 24 * 60 * 60 * 1000;
export interface KeptAnswer {
  readonly value?: number;
  readonly comment?: string;
}

const readAnswers = (raw: string | null): Record<string, unknown> => {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? "null");
  } catch {
    return {};
  }
  if (typeof data !== "object" || data === null || !("answers" in data)) return {};
  const { answers } = data;
  return typeof answers === "object" && answers !== null ? { ...answers } : {};
};

/**
 * Merges one Answer into the Round's kept answers and pushes the expiry to a year from now. Never throws:
 * `storage` is a getter because reading `window.localStorage` itself throws where storage is blocked.
 */
export const keepAnswer = (
  storage: () => Pick<Storage, "getItem" | "setItem">,
  roundId: string,
  questionVersionId: string,
  answer: KeptAnswer,
  now: number,
): void => {
  try {
    const key = keptAnswersPrefix + roundId;
    const store = storage();
    const answers = readAnswers(store.getItem(key));
    const prior = answers[questionVersionId];
    answers[questionVersionId] = { ...(typeof prior === "object" && prior !== null ? prior : {}), ...answer };
    store.setItem(key, JSON.stringify({ expiresAt: now + keptAnswersLifetimeMs, answers }));
  } catch {
    // Storage can be unavailable (private mode, quota); answering must still work.
  }
};
