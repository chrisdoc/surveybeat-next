/** A background job that keeps failing gives up once its retries span this long (ADR 0016). */
export const RETRY_WINDOW_MS = 24 * 3600_000;

const FIRST_RETRY_GAP_MS = 5 * 60_000;
const MAX_RETRY_GAP_MS = 4 * 3600_000;

/**
 * Backoff for the k-th failed attempt (k >= 1): min(5 min * 2^(k-1), 4 h). Returns the next due
 * time, or null when it would fall after startedAt + 24 h (give up).
 */
export const nextRetryAt = (startedAt: number, failedAttempts: number, now: number): number | null => {
  const k = Math.max(1, failedAttempts);
  const gap = Math.min(FIRST_RETRY_GAP_MS * 2 ** (k - 1), MAX_RETRY_GAP_MS);
  const dueAt = now + gap;
  return dueAt > startedAt + RETRY_WINDOW_MS ? null : dueAt;
};
