import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classify } from "./select.mjs";

const SELECT = fileURLToPath(new URL("select.mjs", import.meta.url));

const canaryOnly = (path: string) => classify([path]).canary;

const lighthouseOnly = (path: string) => classify([path]).lighthouse;

const stageOf = (paths: string[]) => classify(paths).stage;

describe("the canary rule (Submission path)", () => {
  it.each([
    "packages/cloudflare/src/submit.ts",
    "infra/alchemy.run.ts",
    "infra/scripts/smoke.ts",
    "apps/web/answer.html",
    "apps/web/vite.config.ts",
    "apps/web/src/answer/Entry.ts",
    "apps/web/src/messages/en.ts",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    ".github/workflows/preview.yml",
    "scripts/ci/select.mjs",
    "scripts/ci/select.test.ts",
  ])("is required for %s", (path) => {
    expect(canaryOnly(path)).toBe(true);
  });

  it.each([
    "packages/cloudflared/x.ts",
    "packages/cloudflare.ts",
    "apps/web/src/answers/x.ts",
    "apps/web/src/answer.ts",
    "apps/web/index.html",
    "pnpm-lock.json",
    ".github/workflows/ci.yml",
    ".github/workflows/deploy.yml",
    "docs/infra.md",
    "scripts/fence/gate.mjs",
    "scripts/cix/x.mjs",
  ])("is not required for %s", (path) => {
    expect(canaryOnly(path)).toBe(false);
  });
});

describe("the Lighthouse rule (answer entry)", () => {
  it.each([
    "apps/web/answer.html",
    "apps/web/vite.config.ts",
    "apps/web/src/answer/Entry.ts",
    "apps/web/src/messages/en.ts",
    "infra/scripts/lighthouse-gate.ts",
    "infra/package.json",
  ])("is required for %s", (path) => {
    expect(lighthouseOnly(path)).toBe(true);
  });

  it.each([
    "apps/web/src/answers/x.ts",
    "apps/web/index.html",
    "infra/scripts/smoke.ts",
    "infra/package-lock.json",
    "packages/cloudflare/src/submit.ts",
  ])("is not required for %s", (path) => {
    expect(lighthouseOnly(path)).toBe(false);
  });
});

describe("the stage rule", () => {
  it.each([
    ["a markdown file under docs", ["docs/adr/0026-preview-stage-gates.md"]],
    ["markdown at the root", ["README.md", "GLOSSARY.md"]],
    ["markdown in an app", ["apps/web/README.md"]],
    ["an agent instruction dir", [".claude/settings.json"]],
    ["an agent instruction dir (.agents)", [".agents/skills/x/SKILL.md"]],
    ["a cursor rule", [".cursor/rules/x.mdc"]],
    ["the hooks", [".githooks/pre-commit"]],
    ["the skills lock", ["skills-lock.json"]],
    ["the root scripts", ["scripts/fence/gate.mjs"]],
    ["prose and tooling together", ["docs/infra.md", ".claude/x.json", "scripts/fence/gate.mjs"]],
  ])("skips the stage for %s", (_, paths) => {
    expect(stageOf(paths)).toBe(false);
  });

  it.each([
    ["a prose file next to code", ["docs/infra.md", "apps/web/src/x.ts"]],
    ["an empty list", []],
    ["a blank entry only", [""]],
    ["infra scripts (not the root scripts)", ["infra/scripts/x.ts"]],
    ["a file named like the root scripts", ["scripts.ts"]],
    ["a near-miss docs path", ["docsx/a.txt"]],
    ["a near-miss agent dir", [".agentsx/a.ts"]],
    ["a non-markdown file under docs-like name", ["docs-notes/x.ts"]],
    ["the preview workflow", [".github/workflows/preview.yml"]],
    ["the Lighthouse entry", ["apps/web/answer.html"]],
  ])("deploys for %s", (_, paths) => {
    expect(stageOf(paths)).toBe(true);
  });

  it("keeps the stage for a markdown file that is also a canary path", () => {
    expect(classify(["apps/web/src/messages/en.md"])).toEqual({
      stage: true,
      canary: true,
      lighthouse: true,
    });
  });

  it("keeps the stage and the canary for the classifier itself", () => {
    expect(classify(["scripts/ci/select.mjs"])).toEqual({
      stage: true,
      canary: true,
      lighthouse: false,
    });
  });

  it("classifies the preview workflow as canary and stage", () => {
    expect(classify([".github/workflows/preview.yml"])).toEqual({
      stage: true,
      canary: true,
      lighthouse: false,
    });
  });

  it("reports the prose-only classification with no gate", () => {
    expect(classify(["docs/infra.md", "README.md"])).toEqual({
      stage: false,
      canary: false,
      lighthouse: false,
    });
  });
});

describe("the command line", () => {
  it("prints the paths and the result, and appends the outputs to GITHUB_OUTPUT", () => {
    const dir = mkdtempSync(join(tmpdir(), "select-"));
    const output = join(dir, "github-output");

    const result = spawnSync(process.execPath, [SELECT], {
      input: "docs/infra.md\napps/web/answer.html\n",
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: output },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("docs/infra.md");
    expect(result.stdout).toContain("stage=true canary=true lighthouse=true");
    expect(readFileSync(output, "utf8")).toBe("stage=true\ncanary=true\nlighthouse=true\n");
  });

  it("prints the result without writing an output file when GITHUB_OUTPUT is unset", () => {
    const env = { ...process.env };
    delete env.GITHUB_OUTPUT;
    const result = spawnSync(process.execPath, [SELECT], { input: "docs/a.md\n", encoding: "utf8", env });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("stage=false canary=false lighthouse=false");
  });
});
