import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));

interface Diagnostic {
  readonly code: string;
  readonly message: string;
}

/** Lints one fixture file with only the plugin rules and returns its diagnostics. */
function lint(file: string): ReadonlyArray<Diagnostic> {
  const result = spawnSync(
    "pnpm",
    ["exec", "oxlint", "--config", "oxlint.fixtures.json", "--format", "json", file],
    {
      cwd: fixtures,
      encoding: "utf8",
    },
  );
  const report: { diagnostics: ReadonlyArray<Diagnostic> } = JSON.parse(result.stdout);
  return report.diagnostics;
}

describe("surveybeat/domain-boundary", () => {
  it.each([
    ["packages/domain/src/bad-cloudflare.ts", "cloudflare:workers"],
    ["packages/domain/src/bad-alchemy.ts", "alchemy"],
    ["packages/domain/src/bad-alchemy-run.ts", "@alchemy.run/cloudflare"],
    ["packages/api/src/bad.ts", "cloudflare:workers"],
    ["apps/web/src/answer/bad-react.ts", "react"],
    ["apps/web/src/answer/bad-react-dom.ts", "react-dom/client"],
    ["apps/web/src/answer/bad-base-ui.ts", "@base-ui/react/button"],
    ["apps/web/src/answer/bad-client.ts", "@surveybeat/api"],
  ])("fails on %s", (file, source) => {
    const diagnostics = lint(file);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("surveybeat(domain-boundary)");
    expect(diagnostics[0]?.message).toContain(`'${source}'`);
  });

  it.each(["packages/domain/src/good.ts", "apps/web/src/app/good-react.tsx"])("passes on %s", (file) => {
    expect(lint(file)).toHaveLength(0);
  });
});

describe("surveybeat/no-literal-ui-text", () => {
  it.each([
    ["apps/web/src/app/bad-text.tsx", 2],
    ["apps/web/src/app/bad-text-expression.tsx", 1],
    ["apps/web/src/answer/bad-text.ts", 1],
  ])("fails on %s", (file, count) => {
    const diagnostics = lint(file);
    expect(diagnostics).toHaveLength(count);
    expect(diagnostics.every((d) => d.code === "surveybeat(no-literal-ui-text)")).toBe(true);
  });

  it("passes on text that comes from elsewhere", () => {
    expect(lint("apps/web/src/app/good-text.tsx")).toHaveLength(0);
  });
});
