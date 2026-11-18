import { expect, it, vi } from "vitest";

it("polls spy state", async () => {
  const spy = vi.fn();
  await expect.poll(() => spy.mock.calls.length).toBe(1);
});
