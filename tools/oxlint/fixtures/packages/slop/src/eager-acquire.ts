import * as Effect from "effect/Effect";

const handle = { close: () => undefined };

export const resource = Effect.acquireRelease(Effect.succeed(handle), () => Effect.void);
