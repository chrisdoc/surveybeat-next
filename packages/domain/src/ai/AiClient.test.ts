import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AiClient, AiInput, AiUnavailable, RedactedText, type AiRequest } from "./AiClient.ts";
import { fakeAiClient } from "./testing.ts";

const text = RedactedText.make("Too many meetings");

// The input type admits only redacted comment text, Question text, Dimension scores and changes, and
// redacted Action titles. Each `@ts-expect-error` below must stay an error: `tsc` fails if one stops being one.
describe("AiInput privacy", () => {
  it("rejects a Person id on a comment", () => {
    const input: AiInput = {
      questions: [],
      comments: [
        // @ts-expect-error a Person id must not fit the input type
        { questionPosition: 1, text, personId: "person-1" },
      ],
      dimensions: [],
      actions: [],
    };
    expect(input.comments).toHaveLength(1);
  });

  it("rejects a name on an Action", () => {
    const input: AiInput = {
      questions: [],
      comments: [],
      actions: [
        // @ts-expect-error a name must not fit the input type
        { title: text, name: "Ada Lovelace" },
      ],
    };
    expect(input.actions).toHaveLength(1);
  });

  it("rejects a plain string where RedactedText is required", () => {
    const plain: string = "not yet redacted";
    const input: AiInput = {
      questions: [],
      // @ts-expect-error only RedactedText may reach the model
      comments: [{ questionPosition: 1, text: plain }],
      dimensions: [],
      actions: [],
    };
    expect(input.comments).toHaveLength(1);
  });

  it("rejects an extra field on the input itself", () => {
    const input: AiInput = {
      // @ts-expect-error no ids, times, or names at the top level
      roundId: "round-1",
      questions: [],
      comments: [],
      dimensions: [],
      actions: [],
    };
    expect(input.questions).toHaveLength(0);
  });

  it("decodes a well-formed input and drops nothing it should keep", () => {
    const decoded = Schema.decodeSync(AiInput)({
      questions: [
        {
          position: 1,
          text: "How clear is the plan?",
          dimension: "clarity",
          score: 4,
          change: null,
          largerThanUsual: true,
        },
      ],
      comments: [{ questionPosition: 1, text }],
      dimensions: [{ dimension: "clarity", score: 4, change: null, largerThanUsual: false }],
      actions: [{ title: text }],
    });
    expect(decoded.questions[0]?.dimension).toBe("clarity");
  });
});

describe("fakeAiClient", () => {
  const request: AiRequest = {
    instructions: "i",
    input: { questions: [], comments: [], dimensions: [], actions: [] },
    schemaName: "s",
    schema: { type: "object" },
    maxTokens: 10,
  };

  it.effect("answers in order and records each request", () =>
    Effect.gen(function* () {
      const fake = yield* fakeAiClient([
        Effect.succeed({ themes: ["a"] }),
        Effect.fail(new AiUnavailable({ reason: "timeout" })),
      ]);
      const complete = AiClient.use((client) => client.complete(request)).pipe(Effect.provide(fake.layer));

      const first = yield* complete;
      const second = yield* complete.pipe(Effect.flip);

      expect(first).toEqual({ themes: ["a"] });
      expect(second).toBeInstanceOf(AiUnavailable);
      expect(yield* fake.requests).toEqual([request, request]);
    }),
  );
});
