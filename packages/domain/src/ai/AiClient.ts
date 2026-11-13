import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Dimension } from "../pulses/Question.ts";

/**
 * Text that has been through rule-based redaction (ADR 0009). Callers pass the comment text as it
 * was stored (already redacted at store time) or redact it first; nothing else may be branded.
 */
export const RedactedText = Schema.String.pipe(Schema.brand("RedactedText"));
export type RedactedText = typeof RedactedText.Type;

/**
 * Everything the model may see (ADR 0015). Deliberately no Person, name, id, Membership, Round,
 * Team, Organization, or time: a field that is not here cannot be sent.
 */
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

/** One completion request. `schema` is the JSON schema the reply must match (strict `json_schema`). */
export interface AiRequest {
  readonly instructions: string;
  readonly input: AiInput;
  readonly schemaName: string;
  readonly schema: Record<string, unknown>;
  readonly maxTokens: number;
}

/** No API key is configured for this stage, so nothing was sent. */
export class AiNotConfigured extends Data.TaggedError("AiNotConfigured") {}

/**
 * The provider refused the request with a non-retryable status. Only the status is kept: a
 * provider's error body can echo comment text, so it is never read or logged.
 */
export class AiRejected extends Data.TaggedError("AiRejected")<{
  readonly status: number;
}> {}

/** The provider could not answer in time: a timeout, a network failure, or retryable statuses that stayed retryable. */
export class AiUnavailable extends Data.TaggedError("AiUnavailable")<{
  readonly reason: "timeout" | "network" | "retryable-status";
  readonly status?: number;
}> {}

/**
 * Calls the language model. The Cloudflare adapter talks to OpenRouter (ADR 0015); the reply is the
 * parsed JSON object from the model's message, which later slices decode against their own schema.
 */
export class AiClient extends Context.Service<
  AiClient,
  {
    readonly complete: (
      request: AiRequest,
    ) => Effect.Effect<unknown, AiNotConfigured | AiRejected | AiUnavailable>;
  }
>()("@surveybeat/domain/AiClient") {}
