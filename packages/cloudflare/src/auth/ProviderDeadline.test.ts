import { AuthUnavailable } from "@surveybeat/domain";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Predicate from "effect/Predicate";
import { TestClock } from "effect/testing";
import { withProviderDeadline } from "./ProviderDeadline.ts";

describe("provider deadline", () => {
  it.effect("a call that never settles fails AuthUnavailable at the deadline", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        withProviderDeadline(Effect.never, Duration.seconds(5)).pipe(Effect.flip),
      );

      yield* TestClock.adjust(Duration.seconds(5));

      const error = yield* Fiber.join(fiber);
      assert.strictEqual(Predicate.isTagged(error, "AuthUnavailable"), true);
    }),
  );

  it.effect("a call that settles first keeps its own result", () =>
    withProviderDeadline(Effect.succeed(42), Duration.seconds(5)).pipe(
      Effect.map((value) => assert.strictEqual(value, 42)),
    ),
  );

  it.effect("a refusal before the deadline keeps its own error", () =>
    withProviderDeadline(Effect.fail(new AuthUnavailable()), Duration.seconds(5)).pipe(
      Effect.flip,
      Effect.map((error) => assert.strictEqual(error._tag, "AuthUnavailable")),
    ),
  );
});
