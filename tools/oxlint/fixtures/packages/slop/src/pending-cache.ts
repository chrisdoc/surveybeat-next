import * as Effect from "effect/Effect";

export const shared = Effect.cached(Effect.succeed(1));
