import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { assetsDirectory, httpPlatformStub, mainWorkerAssets, randomHex32 } from "./WorkerWiring.ts";

describe("mainWorkerAssets", () => {
  it("serves index.html for a client route that has no file", () => {
    assert.strictEqual(mainWorkerAssets("production").notFoundHandling, "single-page-application");
  });

  it("lets the API, auth and delivery paths reach the Worker before any asset", () => {
    const routes = mainWorkerAssets("production").runWorkerFirst;
    for (const route of ["/auth/*", "/api/*", "/delivery", "/delivery/*"]) {
      assert.include(routes, route);
    }
  });

  it("adds the test routes only on a test stage", () => {
    assert.notInclude(mainWorkerAssets("production").runWorkerFirst, "/__test/people");
    assert.notInclude(mainWorkerAssets("dev-someone").runWorkerFirst, "/__test/people");
    assert.include(mainWorkerAssets("test_ci").runWorkerFirst, "/__test/people");
    assert.include(mainWorkerAssets("test_ci").runWorkerFirst, "/__test/email");
  });

  it("resolves the asset directory from the module, not the working directory", () => {
    assert.isTrue(assetsDirectory.startsWith("/"));
    assert.isTrue(assetsDirectory.endsWith("/apps/web/dist"));
    assert.strictEqual(mainWorkerAssets("production").directory, assetsDirectory);
  });
});

describe("randomHex32", () => {
  it("makes 32 lowercase hex characters, not reused for the next id", () => {
    const ids = new Set(Array.from({ length: 100 }, randomHex32));
    for (const id of ids) {
      assert.match(id, /^[0-9a-f]{32}$/);
    }
    assert.strictEqual(ids.size, 100);
  });
});

describe("httpPlatformStub", () => {
  it.effect("binds a file-less web platform with no compression", () =>
    Effect.gen(function* () {
      const platform = yield* HttpPlatform.HttpPlatform;
      assert.strictEqual(platform.platform, "web");
      assert.strictEqual(platform.compression.algorithms.size, 0);

      const response = HttpServerResponse.text("hi");
      const compressed = yield* platform.compression.compressResponse(response, "gzip");
      assert.strictEqual(compressed, response);
    }).pipe(Effect.provide(httpPlatformStub)),
  );

  it.effect("dies instead of reading a file, which an isolate cannot do", () =>
    Effect.gen(function* () {
      const platform = yield* HttpPlatform.HttpPlatform;
      assert.isTrue(Exit.isFailure(yield* Effect.exit(platform.fileResponse("/index.html", {}))));
    }).pipe(Effect.provide(httpPlatformStub)),
  );
});
