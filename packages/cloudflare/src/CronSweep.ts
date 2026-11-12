/** Organizations one daily repair run reads, so the run stays inside its subrequest budget. */
export const REPAIR_PAGE_SIZE = 250;

export interface RepairWindow {
  /** Rows into `organization_index`, ordered by `organization_id`. */
  readonly offset: number;
  readonly limit: number;
  /** Runs needed to repair every Organization once at this total. */
  readonly days: number;
}

/**
 * The slice of `organization_index` one day's run repairs. Each day takes the next contiguous
 * page and wraps after `days`, so every Organization is repaired once per cycle no matter how
 * the index grows, and no run reads more than one page (ADR 0006).
 */
export const repairWindow = (total: number, dayIndex: number, pageSize: number): RepairWindow => {
  const limit = Math.max(1, Math.trunc(pageSize));
  const days = Math.max(1, Math.ceil(Math.max(0, total) / limit));
  const day = ((Math.trunc(dayIndex) % days) + days) % days;
  return { offset: day * limit, limit, days };
};
