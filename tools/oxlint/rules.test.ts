import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fixtures = fileURLToPath(new URL("fixtures", import.meta.url));

interface Diagnostic {
  readonly code: string;
}

const lint = (file: string): readonly Diagnostic[] => {
  const result = spawnSync(
    "pnpm",
    ["exec", "oxlint", "--config", "oxlint.fixtures.json", "--format", "json", file],
    { cwd: fixtures, encoding: "utf8" },
  );
  const report: { diagnostics: readonly Diagnostic[] } = JSON.parse(result.stdout);
  return report.diagnostics;
};

describe("the adopted rule set reports its own violations", () => {
  it.each([
    ["packages/slop/src/no-reflect.ts", "anti-slop(no-reflect-get)"],
    ["packages/slop/src/sleep-in-loop.ts", "patterns(no-sleep-in-loop)"],
    ["packages/slop/src/module-state.ts", "patterns(no-module-level-mutable-state)"],
    ["packages/slop/src/pending-cache.ts", "patterns(no-shared-pending-cache)"],
    ["packages/slop/src/shared-waiter.ts", "patterns(shared-waiters)"],
    ["packages/slop/src/eager-acquire.ts", "patterns(acquire-release-constructs-in-acquire-body)"],
    ["packages/slop/src/runtime.test.ts", "effect-tests(no-manual-effect-runtime-in-tests)"],
    ["packages/slop/src/xstate-inline.ts", "xstate-effect(no-inline-effect)"],
    ["packages/slop/src/fixed-sleep.test.ts", "landmines-testing(no-fixed-sleep)"],
    ["packages/slop/src/flake-masking.test.ts", "landmines-testing(no-flake-masking)"],
    ["packages/slop/src/test-doubles.test.ts", "landmines-testing(no-test-doubles)"],
    ["packages/slop/src/unsignaled-poll.test.ts", "landmines-testing(no-unsignaled-poll)"],
    ["packages/slop/src/strict-msw.test.ts", "landmines-testing(strict-msw)"],
    ["packages/slop/src/thing.mocks.ts", "landmines-structure(test-file-names)"],
    ["packages/detached/src/detached.test.ts", "landmines-structure(colocated-tests)"],
    ["packages/open-exports/src/index.ts", "landmines-structure(package-exports)"],
  ])("reports %s as %s", (file, code) => {
    const diagnostics = lint(file);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  });

  it("reports both inline Effect forms in the xstate fixture", () => {
    const diagnostics = lint("packages/slop/src/xstate-inline.ts");
    expect(
      diagnostics.filter((diagnostic) => diagnostic.code === "xstate-effect(no-inline-effect)"),
    ).toHaveLength(2);
  });

  it("passes the xstate fixture that declares its actors", () => {
    expect(lint("packages/slop/src/xstate-declared.ts")).toHaveLength(0);
  });
});
