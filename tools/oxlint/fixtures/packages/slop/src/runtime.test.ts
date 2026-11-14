import * as Effect from "effect/Effect";
import { expect, it } from "vitest";

it("runs an Effect by hand", () => {
  const value = Effect.runSync(Effect.succeed(1));
  expect(value).toBe(1);
});
