import { assert, describe, it } from "@effect/vitest";
import { findViolations } from "./check-observability.ts";

const off = {
  id: "w",
  logpush: false,
  tail_consumers: [],
  // What Cloudflare reports for a Worker deployed with everything off: invocation_logs and persist stay true.
  observability: {
    enabled: false,
    logs: { enabled: false, invocation_logs: true, persist: true },
    traces: { enabled: false, persist: true },
  },
};

describe("findViolations", () => {
  it("accepts a Worker with every log channel off, whatever invocation_logs and persist report", () => {
    assert.deepStrictEqual(findViolations(off), []);
  });

  it("accepts a Worker with no observability block", () => {
    assert.deepStrictEqual(findViolations({ id: "w", observability: null, logpush: null }), []);
  });

  it("reports each channel that is on", () => {
    const on = {
      ...off,
      logpush: true,
      tail_consumers: [{ service: "tail" }],
      observability: {
        enabled: true,
        logs: { enabled: true, invocation_logs: true, persist: true },
        traces: { enabled: true, persist: true },
      },
    };
    assert.deepStrictEqual(findViolations(on), [
      "observability.enabled is on",
      "observability.logs.enabled is on",
      "observability.logs.invocation_logs is on",
      "observability.logs.persist is on",
      "observability.traces.enabled is on",
      "observability.traces.persist is on",
      "logpush is on",
      "tail consumers are attached",
    ]);
  });
});
