export const RETRY_WINDOW_MS = 24 * 3_600_000;

const FIRST_RETRY_GAP_MS = 5 * 60_000;

const MAX_RETRY_GAP_MS = 4 * 3_600_000;

const retryGapMs = (failedAttempts: number): number => {
  const k = Math.max(1, failedAttempts);

  return Math.min(FIRST_RETRY_GAP_MS * 2 ** (k - 1), MAX_RETRY_GAP_MS);
};

export const nextRetryAt = (startedAt: number, failedAttempts: number, now: number): number | null => {
  const dueAt = now + retryGapMs(failedAttempts);

  return dueAt > startedAt + RETRY_WINDOW_MS ? null : dueAt;
};

export const nextJobAttemptAt = (failures: number, now: number): number => now + retryGapMs(failures);
