import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));

interface Diagnostic {
  readonly code: string;
}

const lint = (file: string): ReadonlyArray<Diagnostic> => {
  const result = spawnSync(
    "pnpm",
    ["exec", "oxlint", "--config", "oxlint.fixtures.json", "--format", "json", file],
    { cwd: fixtures, encoding: "utf8" },
  );
  const report: { diagnostics: ReadonlyArray<Diagnostic> } = JSON.parse(result.stdout);
  return report.diagnostics;
};

describe("the adopted rule set reports its own violations", () => {
  it.each([
    ["packages/slop/src/no-reflect.ts", "anti-slop(no-reflect-get)"],
    ["packages/slop/src/sleep-in-loop.ts", "patterns(no-sleep-in-loop)"],
    ["packages/slop/src/module-state.ts", "patterns(no-module-level-mutable-state)"],
    ["packages/slop/src/runtime.test.ts", "effect-tests(no-manual-effect-runtime-in-tests)"],
  ])("reports %s as %s", (file, code) => {
    const diagnostics = lint(file);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  });
});
