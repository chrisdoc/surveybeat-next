import * as Effect from "effect/Effect";

export const waitEach = (delays: readonly number[]) =>
  Effect.gen(function* () {
    for (const delay of delays) {
      yield* Effect.sleep(delay);
    }
  });
