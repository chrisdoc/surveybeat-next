import { assert, describe, it } from "@effect/vitest";
import { REPAIR_PAGE_SIZE, repairWindow } from "./CronSweep.ts";

describe("repairWindow (ADR 0006)", () => {
  it("repairs every Organization exactly once per cycle, whatever the total", () => {
    for (const total of [0, 1, 7, 249, 250, 251, 600, 1000]) {
      for (const pageSize of [1, 10, 250]) {
        const { days } = repairWindow(total, 0, pageSize);
        const covered = new Set<number>();
        for (let day = 0; day < days; day++) {
          const { offset, limit } = repairWindow(total, day, pageSize);
          for (let index = offset; index < Math.min(offset + limit, total); index++) {
            assert.isFalse(covered.has(index), `index ${index} was read twice in one cycle`);
            covered.add(index);
          }
        }
        assert.strictEqual(covered.size, total, `total ${total}, page ${pageSize}`);
      }
    }
  });

  it("reads one page and stays in range after a whole cycle has passed", () => {
    const window = repairWindow(10_000, 12_345, REPAIR_PAGE_SIZE);
    assert.strictEqual(window.limit, REPAIR_PAGE_SIZE);
    assert.strictEqual(window.days, 40);
    assert.isTrue(window.offset >= 0);
    assert.isTrue(window.offset < 10_000);
  });

  it("keeps one page for an empty index rather than dividing by zero", () => {
    const window = repairWindow(0, 5, REPAIR_PAGE_SIZE);
    assert.strictEqual(window.days, 1);
    assert.strictEqual(window.offset, 0);
    assert.strictEqual(window.limit, REPAIR_PAGE_SIZE);
  });
});
