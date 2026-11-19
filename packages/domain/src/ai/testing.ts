import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { AiClient } from "./AiClient.ts";
import type { AiNotConfigured, AiRejected, AiRequest, AiUnavailable } from "./AiClient.ts";

export const fakeAiClient = (
  responses: readonly Effect.Effect<unknown, AiNotConfigured | AiRejected | AiUnavailable>[],
) =>
  Effect.gen(function* () {
    const requests = yield* Ref.make<readonly AiRequest[]>([]);

    const layer = Layer.succeed(AiClient, {
      complete: (request) =>
        Ref.modify(requests, (all): [number, readonly AiRequest[]] => [all.length, [...all, request]]).pipe(
          Effect.flatMap((index) => responses[index] ?? Effect.die(`unexpected AI call #${index + 1}`)),
        ),
    });

    return { layer, requests: Ref.get(requests) };
  });
