import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Dimension } from "../pulses/Question.ts";

export const RedactedText = Schema.String.pipe(Schema.brand("RedactedText"));
export type RedactedText = typeof RedactedText.Type;

export const AiInput = Schema.Struct({
  questions: Schema.Array(
    Schema.Struct({
      position: Schema.Finite,
      text: Schema.String,
      dimension: Schema.NullOr(Dimension),
      score: Schema.NullOr(Schema.Finite),
      change: Schema.NullOr(Schema.Finite),
      largerThanUsual: Schema.Boolean,
    }),
  ),
  comments: Schema.Array(
    Schema.Struct({
      questionPosition: Schema.Finite,
      text: RedactedText,
    }),
  ),
  dimensions: Schema.Array(
    Schema.Struct({
      dimension: Dimension,
      score: Schema.NullOr(Schema.Finite),
      change: Schema.NullOr(Schema.Finite),
      largerThanUsual: Schema.Boolean,
    }),
  ),
  actions: Schema.Array(
    Schema.Struct({
      title: RedactedText,
    }),
  ),
});
export type AiInput = typeof AiInput.Type;

export interface AiRequest {
  readonly instructions: string;
  readonly input: AiInput;
  readonly schemaName: string;
  readonly schema: Record<string, unknown>;
  readonly maxTokens: number;
}

export class AiNotConfigured extends Data.TaggedError("AiNotConfigured") {}

export class AiRejected extends Data.TaggedError("AiRejected")<{
  readonly status: number;
}> {}

export class AiUnavailable extends Data.TaggedError("AiUnavailable")<{
  readonly reason: "timeout" | "network" | "retryable-status";
  readonly status?: number;
}> {}

export class AiClient extends Context.Service<
  AiClient,
  {
    readonly complete: (
      request: AiRequest,
    ) => Effect.Effect<unknown, AiNotConfigured | AiRejected | AiUnavailable>;
  }
>()("@surveybeat/domain/AiClient") {}
