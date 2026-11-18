import { expect, it } from "vitest";
import { thing } from "./owner/thing.ts";

it("tests a file in another directory", () => {
  expect(thing).toBe(1);
});
