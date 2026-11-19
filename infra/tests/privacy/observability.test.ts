import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { decodeEventCount, queryBody, retryingServerErrors } from "./observability.ts";

describe("queryBody", () => {
  it("filters by Worker script and searches for the needle", () => {
    assert.deepStrictEqual(
      queryBody({ from: 1, to: 2, service: "surveybeat-main-pr-1", needle: "sbcanary" }),
      {
        queryId: "surveybeat-canary-sweep",
        timeframe: { from: 1, to: 2 },
        view: "events",
        limit: 100,
        parameters: {
          needle: { value: "sbcanary" },
          filters: [
            { key: "$metadata.service", operation: "eq", type: "string", value: "surveybeat-main-pr-1" },
          ],
        },
      },
    );
  });

  it("searches every Worker when no script is given", () => {
    assert.deepStrictEqual(queryBody({ from: 1, to: 2 }).parameters, { filters: [] });
  });
});

describe("decodeEventCount", () => {
  it("reads the count and the scripts of the returned events", () => {
    // Trimmed from a real response for a stage on 2026-11-07.
    const body = {
      success: true,
      result: {
        run: { status: "COMPLETED" },
        events: {
          count: 2,
          events: [
            {
              source: { message: "GET /auth/session?canary=sbcanary" },
              $metadata: { service: "surveybeat-main-dev" },
            },
            {
              source: { message: "GET /auth/session?canary=sbcanary" },
              $metadata: { service: "surveybeat-main-dev" },
            },
          ],
        },
      },
    };
    assert.deepStrictEqual(decodeEventCount(body), { count: 2, services: ["surveybeat-main-dev"] });
  });

  it("reads an empty result as zero events", () => {
    assert.deepStrictEqual(decodeEventCount({ result: { events: { count: 0, events: [] } } }), {
      count: 0,
      services: [],
    });
    assert.deepStrictEqual(decodeEventCount({ result: {} }), { count: 0, services: [] });
  });

  it("rejects a response without a result", () => {
    assert.throws(() => decodeEventCount({ success: false, errors: [] }));
  });
});

describe("retryingServerErrors", () => {
  const answering = (...statuses: ReadonlyArray<number>) => {
    let calls = 0;
    const send = () => {
      const status = statuses[Math.min(calls, statuses.length - 1)] ?? 200;
      calls += 1;
      return Promise.resolve(new Response("{}", { status }));
    };
    return { send, calls: () => calls };
  };

  it.live("asks again after a 500 and returns the first good answer", () =>
    Effect.gen(function* () {
      const api = answering(500, 200);
      const response = yield* retryingServerErrors(api.send, 2, "1 millis");
      assert.strictEqual(response.status, 200);
      assert.strictEqual(api.calls(), 2);
    }),
  );

  it.live("gives up after the last retry and returns that 5xx", () =>
    Effect.gen(function* () {
      const api = answering(500, 502, 503, 200);
      const response = yield* retryingServerErrors(api.send, 2, "1 millis");
      assert.strictEqual(response.status, 503);
      assert.strictEqual(api.calls(), 3);
    }),
  );

  it.live("does not retry a 4xx", () =>
    Effect.gen(function* () {
      const api = answering(403, 200);
      const response = yield* retryingServerErrors(api.send, 2, "1 millis");
      assert.strictEqual(response.status, 403);
      assert.strictEqual(api.calls(), 1);
    }),
  );
});
