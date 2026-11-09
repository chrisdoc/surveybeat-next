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
    ["packages/domain/src/bad-foldkit.ts", "foldkit"],
    ["packages/api/src/bad.ts", "cloudflare:workers"],
    ["packages/api/src/bad-foldkit.ts", "foldkit"],
    ["apps/web/src/answer/bad-react.ts", "react"],
    ["apps/web/src/answer/bad-react-dom.ts", "react-dom/client"],
    ["apps/web/src/answer/bad-base-ui.ts", "@base-ui/react/button"],
    ["apps/web/src/answer/bad-client.ts", "@surveybeat/api"],
    ["apps/web/src/answer/bad-foldkit.ts", "foldkit"],
  ])("fails on %s", (file, source) => {
    const diagnostics = lint(file);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("surveybeat(domain-boundary)");
    expect(diagnostics[0]?.message).toContain(`'${source}'`);
  });

  it.each(["packages/domain/src/good.ts", "apps/web/src/app/good-foldkit.ts"])("passes on %s", (file) => {
    expect(lint(file)).toHaveLength(0);
  });
});

describe("surveybeat/no-literal-ui-text", () => {
  it.each([
    ["apps/web/src/app/bad-text.ts", 2],
    ["apps/web/src/app/bad-text-expression.ts", 1],
    ["apps/web/src/answer/bad-text.ts", 1],
  ])("fails on %s", (file, count) => {
    const diagnostics = lint(file);
    expect(diagnostics).toHaveLength(count);
    expect(diagnostics.every((d) => d.code === "surveybeat(no-literal-ui-text)")).toBe(true);
  });

  it("passes on text that comes from elsewhere", () => {
    expect(lint("apps/web/src/app/good-text.ts")).toHaveLength(0);
  });
});

describe("surveybeat/privacy-query", () => {
  it.each([
    ["packages/bad-query-rowid.ts", "rowid"],
    ["packages/bad-query-join.ts", "join"],
    ["packages/bad-query-order.ts", "ORDER BY"],
  ])("fails on %s with %s violation", (file, messageSubstring) => {
    const diagnostics = lint(file);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("surveybeat(privacy-query)");
    expect(diagnostics[0]?.message).toContain(messageSubstring);
  });

  it("passes on valid queries", () => {
    expect(lint("packages/good-query.ts")).toHaveLength(0);
  });
});
