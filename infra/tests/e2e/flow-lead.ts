/**
 * The SPEC §7 flow's Lead creates an Organization, so the local stage's allowlist must name them.
 * Local D1 outlives a run and a retry replays the whole serial flow, so every attempt of every run
 * signs in as its own Lead: the config allowlists one per attempt and the spec picks its attempt's.
 */
export const flowAttempts = (retries: number): ReadonlyArray<number> =>
  Array.from({ length: retries + 1 }, (_, attempt) => attempt);

export const flowLeadFor = (run: string, attempt: number): string =>
  `flow-lead-${run}-${attempt}@example.com`;
