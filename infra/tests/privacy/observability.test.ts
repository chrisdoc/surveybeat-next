import { assert, describe, it } from "@effect/vitest";
import { decodeEventCount, queryBody } from "./observability.ts";

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
            { source: { message: "GET /orgs/sbcanary" }, $metadata: { service: "surveybeat-main-dev" } },
            { source: { message: "GET /orgs/sbcanary" }, $metadata: { service: "surveybeat-main-dev" } },
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
