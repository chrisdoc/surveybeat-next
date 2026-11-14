import { assert, describe, it } from "@effect/vitest";
import { isProviderRefusal, isProviderUnreachable, providerStatusOf } from "./ProviderFailure.ts";

const status = (value: number) => ({ status: value });

describe("providerStatusOf", () => {
  it("reads a numeric status and ignores anything else", () => {
    assert.strictEqual(providerStatusOf(status(404)), 404);
    assert.strictEqual(providerStatusOf({ status: "404" }), undefined);
    assert.strictEqual(providerStatusOf(null), undefined);
    assert.strictEqual(providerStatusOf("boom"), undefined);
  });
});

describe("isProviderRefusal", () => {
  it("answers the request was refused for a 4xx other than 408 and 429", () => {
    for (const code of [400, 401, 403, 404, 409, 422]) {
      assert.isTrue(isProviderRefusal(status(code)), String(code));
    }
  });

  it("does not call a timeout, a rate limit, a 5xx, or a missing status a refusal", () => {
    for (const code of [408, 429, 500, 502, 503]) {
      assert.isFalse(isProviderRefusal(status(code)), String(code));
    }
    assert.isFalse(isProviderRefusal({}));
    assert.isFalse(isProviderRefusal(new TypeError("fetch failed")));
  });
});

describe("isProviderUnreachable", () => {
  it("covers fetch failures, timeouts, 429 and 5xx", () => {
    assert.isTrue(isProviderUnreachable(new TypeError("fetch failed")));
    for (const code of [408, 429, 500, 503]) {
      assert.isTrue(isProviderUnreachable(status(code)), String(code));
    }
  });

  it("covers the JWKS and jose errors the SDK throws when it cannot verify", () => {
    assert.isTrue(isProviderUnreachable({ code: "ERR_JWKS_TIMEOUT" }));
    assert.isTrue(isProviderUnreachable({ code: "ERR_JOSE_GENERIC" }));
  });

  it("leaves a refusal and an unrecognisable throw to the session decision", () => {
    for (const code of [400, 401, 403, 404]) {
      assert.isFalse(isProviderUnreachable(status(code)), String(code));
    }
    assert.isFalse(isProviderUnreachable({}));
    assert.isFalse(isProviderUnreachable(null));
    assert.isFalse(isProviderUnreachable({ code: "SOMETHING_ELSE" }));
  });
});
