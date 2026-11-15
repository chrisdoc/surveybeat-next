export const REPAIR_PAGE_SIZE = 250;

export interface RepairWindow {
  readonly offset: number;
  readonly limit: number;
  readonly days: number;
}

export const repairWindow = (total: number, dayIndex: number, pageSize: number): RepairWindow => {
  const limit = Math.max(1, Math.trunc(pageSize));
  const days = Math.max(1, Math.ceil(Math.max(0, total) / limit));
  const day = ((Math.trunc(dayIndex) % days) + days) % days;
  return { offset: day * limit, limit, days };
};
