import { describe, expect, it } from "vitest";
import { buildPowerpipeArgs, parseComplianceArgs } from "./check.mjs";

describe("parseComplianceArgs", () => {
  it("uses sensible defaults with no flags", () => {
    expect(parseComplianceArgs([])).toEqual({
      benchmark: "all_compliance",
      output: "text",
      dryRun: false,
    });
  });

  it("parses benchmark, output, stage, and dry-run flags", () => {
    expect(
      parseComplianceArgs(["--benchmark", "gdpr", "--output", "json", "--stage", "production", "--dry-run"]),
    ).toEqual({
      benchmark: "gdpr",
      output: "json",
      stage: "production",
      dryRun: true,
    });
  });

  it("ignores pnpm separator -- before flags", () => {
    expect(parseComplianceArgs(["--", "--benchmark", "soc2", "--dry-run"])).toEqual({
      benchmark: "soc2",
      output: "text",
      dryRun: true,
    });
  });

  it("rejects unknown benchmarks and flags", () => {
    expect(() => parseComplianceArgs(["--benchmark", "hipaa"])).toThrow(/Unknown benchmark/);
    expect(() => parseComplianceArgs(["--unknown"])).toThrow(/Unknown argument/);
  });
});

describe("buildPowerpipeArgs", () => {
  it("builds dry-run arguments pointing at infra/compliance", () => {
    const args = buildPowerpipeArgs({
      benchmark: "soc2",
      output: "md",
      dryRun: true,
    });

    expect(args).toContain("--dry-run");
    expect(args).toContain("soc2");
    expect(args).toContain("md");
    expect(args.some((arg) => arg.endsWith("/infra/compliance"))).toBe(true);
  });
});
