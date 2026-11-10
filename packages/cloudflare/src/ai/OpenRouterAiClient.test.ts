import { describe, expect, it } from "@effect/vitest";
import { AiNotConfigured, AiRejected, AiUnavailable, RedactedText, type AiRequest } from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { makeOpenRouterAiClient, openRouterRequestBody } from "./OpenRouterAiClient.ts";

const request: AiRequest = {
  instructions: "Group the redacted comments into themes.",
  input: {
    questions: [
      {
        position: 1,
        text: "How manageable is your workload?",
        dimension: "workload",
        score: 3.2,
        change: -0.4,
        largerThanUsual: false,
      },
    ],
    comments: [{ questionPosition: 1, text: RedactedText.make("Too many meetings") }],
    dimensions: [],
    actions: [{ title: RedactedText.make("Fewer standing meetings") }],
  },
  schemaName: "comment_themes",
  schema: {
    type: "object",
    properties: { themes: { type: "array", items: { type: "string" } } },
    required: ["themes"],
    additionalProperties: false,
  },
  maxTokens: 2000,
};

const expectedBody = {
  model: "anthropic/claude-haiku-5.5",
  provider: {
    zdr: true,
    only: ["google-vertex/europe", "amazon-bedrock/eu-west-1"],
    order: ["google-vertex/europe", "amazon-bedrock/eu-west-1"],
    allow_fallbacks: false,
    data_collection: "deny",
  },
  messages: [
    { role: "system", content: "Group the redacted comments into themes." },
    { role: "user", content: JSON.stringify(request.input) },
  ],
  response_format: {
    type: "json_schema",
    json_schema: { name: "comment_themes", strict: true, schema: request.schema },
  },
  reasoning: { effort: "low" },
  max_tokens: 2000,
};

const reply = (content: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status });

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** A `fetch` that answers each call with the next step; an `Error` step rejects the call. */
const scriptedFetch = (steps: ReadonlyArray<Response | Error>) => {
  const calls: Array<Call> = [];
  const fetchFn = async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input, init: init ?? {} });
    const step = steps[calls.length - 1];
    if (step === undefined) {
      throw new Error("unexpected fetch");
    }
    if (step instanceof Error) {
      throw step;
    }
    return step;
  };
  return { fetch: fetchFn as unknown as typeof fetch, calls };
};

/** Records each backoff wait instead of sleeping. */
const recordingSleep = () => {
  const waits: Array<number> = [];
  const sleep = (ms: number) =>
    Effect.sync(() => {
      waits.push(ms);
    });
  return { sleep, waits };
};

const timeoutError = () => new DOMException("The operation timed out.", "TimeoutError");

describe("openRouterRequestBody", () => {
  it("matches the ADR 0015 request shape exactly", () => {
    expect(openRouterRequestBody(request)).toEqual(expectedBody);
  });

  it("serialises byte for byte, with the EU-only, zero-retention, no-fallback provider block", () => {
    expect(JSON.stringify(openRouterRequestBody(request))).toBe(JSON.stringify(expectedBody));
    const { provider } = openRouterRequestBody(request);
    expect(provider.zdr).toBe(true);
    expect(provider.allow_fallbacks).toBe(false);
    expect(provider.data_collection).toBe("deny");
    expect(provider.only).toEqual(provider.order);
  });
});

describe("makeOpenRouterAiClient", () => {
  it.effect("returns the parsed JSON from the model's message and sends the key as a bearer token", () =>
    Effect.gen(function* () {
      const fake = scriptedFetch([reply({ themes: ["Meetings"] })]);
      const client = makeOpenRouterAiClient(Redacted.make("key-under-test"), { fetch: fake.fetch });

      const result = yield* client.complete(request);

      expect(result).toEqual({ themes: ["Meetings"] });
      expect(fake.calls).toHaveLength(1);
      const call = fake.calls[0];
      expect(call?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(call?.init.method).toBe("POST");
      expect(call?.init.headers).toEqual({
        Authorization: "Bearer key-under-test",
        "Content-Type": "application/json",
      });
      expect(call?.init.body).toBe(JSON.stringify(expectedBody));
      expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    }),
  );

  it.effect("retries once on 429 and waits the Retry-After seconds", () =>
    Effect.gen(function* () {
      const fake = scriptedFetch([
        new Response("", { status: 429, headers: { "Retry-After": "2" } }),
        reply({ themes: [] }),
      ]);
      const wait = recordingSleep();
      const client = makeOpenRouterAiClient(Redacted.make("k"), { fetch: fake.fetch, sleep: wait.sleep });

      const result = yield* client.complete(request);

      expect(result).toEqual({ themes: [] });
      expect(fake.calls).toHaveLength(2);
      expect(wait.waits).toEqual([2000]);
    }),
  );

  it.effect("caps Retry-After at 30 seconds", () =>
    Effect.gen(function* () {
      const fake = scriptedFetch([
        new Response("", { status: 429, headers: { "Retry-After": "120" } }),
        reply({ themes: [] }),
      ]);
      const wait = recordingSleep();
      const client = makeOpenRouterAiClient(Redacted.make("k"), { fetch: fake.fetch, sleep: wait.sleep });

      yield* client.complete(request);

      expect(wait.waits).toEqual([30_000]);
    }),
  );

  it.effect("backs off 1, 2, then 4 seconds without Retry-After, and gives up after four attempts", () =>
    Effect.gen(function* () {
      const fake = scriptedFetch([
        new Response("", { status: 503 }),
        new Response("", { status: 503 }),
        new Response("", { status: 503 }),
        new Response("", { status: 503 }),
      ]);
      const wait = recordingSleep();
      const client = makeOpenRouterAiClient(Redacted.make("k"), { fetch: fake.fetch, sleep: wait.sleep });

      const error = yield* client.complete(request).pipe(Effect.flip);

      expect(error).toBeInstanceOf(AiUnavailable);
      expect(error).toMatchObject({ reason: "retryable-status", status: 503 });
      expect(fake.calls).toHaveLength(4);
      expect(wait.waits).toEqual([1000, 2000, 4000]);
    }),
  );

  it.effect("fails a non-retryable status at once with the status only, without reading the body", () =>
    Effect.gen(function* () {
      const response = new Response("comment echoed back by the moderator", { status: 400 });
      let bodyRead = false;
      for (const method of ["text", "json", "arrayBuffer", "blob", "formData"] as const) {
        Object.defineProperty(response, method, {
          value: () => {
            bodyRead = true;
            throw new Error("body must not be read");
          },
        });
      }
      const fake = scriptedFetch([response]);
      const wait = recordingSleep();
      const client = makeOpenRouterAiClient(Redacted.make("k"), { fetch: fake.fetch, sleep: wait.sleep });

      const error = yield* client.complete(request).pipe(Effect.flip);

      expect(error).toBeInstanceOf(AiRejected);
      expect(error).toMatchObject({ status: 400 });
      expect(fake.calls).toHaveLength(1);
      expect(wait.waits).toEqual([]);
      expect(bodyRead).toBe(false);
    }),
  );

  it.effect("retries a timeout and a network error, then succeeds", () =>
    Effect.gen(function* () {
      const fake = scriptedFetch([timeoutError(), new Error("socket hang up"), reply({ themes: [] })]);
      const wait = recordingSleep();
      const client = makeOpenRouterAiClient(Redacted.make("k"), { fetch: fake.fetch, sleep: wait.sleep });

      const result = yield* client.complete(request);

      expect(result).toEqual({ themes: [] });
      expect(fake.calls).toHaveLength(3);
      expect(wait.waits).toEqual([1000, 2000]);
    }),
  );

  it.effect("reports a timeout as AiUnavailable once the attempts run out", () =>
    Effect.gen(function* () {
      const fake = scriptedFetch([timeoutError(), timeoutError(), timeoutError(), timeoutError()]);
      const wait = recordingSleep();
      const client = makeOpenRouterAiClient(Redacted.make("k"), { fetch: fake.fetch, sleep: wait.sleep });

      const error = yield* client.complete(request).pipe(Effect.flip);

      expect(error).toMatchObject({ reason: "timeout" });
      expect(fake.calls).toHaveLength(4);
    }),
  );

  it.effect("fails with AiNotConfigured and makes no network call when the key is missing or empty", () =>
    Effect.gen(function* () {
      for (const key of [undefined, Redacted.make("")]) {
        const fake = scriptedFetch([reply({ themes: [] })]);
        const client = makeOpenRouterAiClient(key, { fetch: fake.fetch });

        const error = yield* client.complete(request).pipe(Effect.flip);

        expect(error).toBeInstanceOf(AiNotConfigured);
        expect(fake.calls).toHaveLength(0);
      }
    }),
  );

  it.effect("treats a 2xx reply that is not the expected envelope as AiRejected", () =>
    Effect.gen(function* () {
      const fake = scriptedFetch([new Response("{not json", { status: 200 })]);
      const client = makeOpenRouterAiClient(Redacted.make("k"), { fetch: fake.fetch });

      const error = yield* client.complete(request).pipe(Effect.flip);

      expect(error).toBeInstanceOf(AiRejected);
      expect(error).toMatchObject({ status: 200 });
    }),
  );
});
