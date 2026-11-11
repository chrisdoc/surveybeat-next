import { AuthUnavailable } from "@surveybeat/domain";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

export const withProviderDeadline = <A, E>(
  effect: Effect.Effect<A, E>,
  timeout: Duration.Duration,
): Effect.Effect<A, E | AuthUnavailable> =>
  effect.pipe(
    Effect.timeout(timeout),
    Effect.catchTag("TimeoutError", () => Effect.fail(new AuthUnavailable())),
  );
