import { expect, it, vi } from "vitest";

vi.mock("node:fs");

it("replaces a dependency", () => {
  expect(1).toBe(1);
});
