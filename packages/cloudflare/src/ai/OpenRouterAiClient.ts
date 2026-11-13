import { AiClient, AiNotConfigured, AiRejected, AiUnavailable, type AiRequest } from "@surveybeat/domain";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/**
 * The only model and the only routing ADR 0015 allows. Every request is pinned to the two
 * zero-retention endpoints in the EU and allows no fallback, so it fails closed rather than
 * leaving the EU or reaching an endpoint that keeps data.
 */
const MODEL = "anthropic/claude-haiku-5.5";
const EU_ENDPOINTS = ["google-vertex/europe", "amazon-bedrock/eu-west-1"] as const;
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const ATTEMPT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 30_000;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 502, 503]);

export interface OpenRouterBody {
  readonly model: typeof MODEL;
  readonly provider: {
    readonly zdr: true;
    readonly only: ReadonlyArray<string>;
    readonly order: ReadonlyArray<string>;
    readonly allow_fallbacks: false;
    readonly data_collection: "deny";
  };
  readonly messages: ReadonlyArray<{ readonly role: "system" | "user"; readonly content: string }>;
  readonly response_format: {
    readonly type: "json_schema";
    readonly json_schema: {
      readonly name: string;
      readonly strict: true;
      readonly schema: Record<string, unknown>;
    };
  };
  readonly reasoning: { readonly effort: "low" };
  readonly max_tokens: number;
}

/** The Chat Completions body for one request. Pure, so the exact shape can be asserted. */
export const openRouterRequestBody = (request: AiRequest): OpenRouterBody => ({
  model: MODEL,
  provider: {
    zdr: true,
    only: [...EU_ENDPOINTS],
    order: [...EU_ENDPOINTS],
    allow_fallbacks: false,
    data_collection: "deny",
  },
  messages: [
    { role: "system", content: request.instructions },
    { role: "user", content: JSON.stringify(request.input) },
  ],
  response_format: {
    type: "json_schema",
    json_schema: { name: request.schemaName, strict: true, schema: request.schema },
  },
  reasoning: { effort: "low" },
  max_tokens: request.maxTokens,
});

/** Only the part of the reply we use. Anything else in the envelope is ignored. */
const Envelope = Schema.Struct({
  choices: Schema.NonEmptyArray(
    Schema.Struct({
      message: Schema.Struct({ content: Schema.String }),
    }),
  ),
});

type Attempt =
  | { readonly kind: "response"; readonly response: Response }
  | { readonly kind: "failed"; readonly reason: "timeout" | "network" };

/** One POST. Never throws: a timeout or network failure is an outcome, not an exception. */
const attemptOnce = async (doFetch: typeof fetch, apiKey: string, body: OpenRouterBody): Promise<Attempt> => {
  try {
    const response = await doFetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
    return { kind: "response", response };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return {
      kind: "failed",
      reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
    };
  }
};

/** Waits `Retry-After` seconds when the provider gave them (capped), else 1, 2, 4 seconds. */
const backoffMs = (attempt: number, retryAfter: string | null): number => {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  return 2 ** attempt * 1000;
};

/** Cancels an unread body so Workers can reuse the connection; never reads it. */
const discardBody = (response: Response): Effect.Effect<void> =>
  Effect.promise(() => response.body?.cancel().catch(() => undefined) ?? Promise.resolve(undefined)).pipe(
    Effect.asVoid,
  );

const parseReply = (response: Response) =>
  Effect.gen(function* () {
    const json = yield* Effect.tryPromise({
      try: (): Promise<unknown> => response.json(),
      catch: () => new AiRejected({ status: response.status }),
    });
    const envelope = yield* Schema.decodeUnknownEffect(Envelope)(json).pipe(
      Effect.mapError(() => new AiRejected({ status: response.status })),
    );
    const content = envelope.choices[0].message.content;
    return yield* Effect.try({
      try: (): unknown => JSON.parse(content),
      catch: () => new AiRejected({ status: response.status }),
    });
  });

/**
 * The `AiClient` over OpenRouter. No key means `AiNotConfigured` with no network call. Retries
 * 408, 429, 502, 503, timeouts, and network errors up to three times; any other error status is
 * `AiRejected`. Bodies are never read on error and nothing is logged.
 */
export const makeOpenRouterAiClient = (
  apiKey: Redacted.Redacted<string> | undefined,
  options: {
    readonly fetch?: typeof fetch;
    readonly sleep?: (ms: number) => Effect.Effect<void>;
  } = {},
) => {
  const key = apiKey === undefined ? "" : Redacted.value(apiKey);
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => Effect.sleep(ms));

  return AiClient.of({
    complete: (request) =>
      Effect.gen(function* () {
        if (key === "") {
          return yield* new AiNotConfigured();
        }
        const body = openRouterRequestBody(request);

        for (let attempt = 0; ; attempt++) {
          const outcome = yield* Effect.promise(() => attemptOnce(doFetch, key, body));
          const isLast = attempt >= MAX_RETRIES;

          if (outcome.kind === "failed") {
            if (isLast) {
              return yield* new AiUnavailable({ reason: outcome.reason });
            }
            yield* sleep(backoffMs(attempt, null));
            continue;
          }

          const { response } = outcome;
          if (response.ok) {
            return yield* parseReply(response);
          }
          // Release the connection without reading the body: an error body can echo comment text.
          yield* discardBody(response);
          if (RETRYABLE_STATUSES.has(response.status)) {
            if (isLast) {
              return yield* new AiUnavailable({ reason: "retryable-status", status: response.status });
            }
            yield* sleep(backoffMs(attempt, response.headers.get("Retry-After")));
            continue;
          }
          return yield* new AiRejected({ status: response.status });
        }
      }),
  });
};

/**
 * Reads `OPENROUTER_API_KEY` (a Worker secret). It defaults to empty, so a stage without the key
 * deploys and fails closed with `AiNotConfigured` when AI is used.
 */
export const OpenRouterAiClientLive = Layer.effect(
  AiClient,
  Effect.gen(function* () {
    const key = yield* Config.Redacted("OPENROUTER_API_KEY").pipe(Config.withDefault(Redacted.make("")));
    return makeOpenRouterAiClient(key);
  }).pipe(Effect.orDie),
);
