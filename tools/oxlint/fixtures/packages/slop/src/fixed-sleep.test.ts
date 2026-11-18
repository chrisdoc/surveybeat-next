import { expect, it } from "vitest";

it("waits a fixed delay", async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(1).toBe(1);
});
