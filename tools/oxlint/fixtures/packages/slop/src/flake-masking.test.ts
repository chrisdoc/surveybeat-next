import { expect, it } from "vitest";

it("retries until green", { retry: 3 }, () => {
  expect(1).toBe(1);
});
