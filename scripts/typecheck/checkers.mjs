import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

export const readProjects = () => {
  const rootConfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
  return (rootConfig.references ?? []).map((reference) => join(root, reference.path, "tsconfig.json"));
};

export const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { status: result.status ?? 1, output };
};

export const byCode = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

export const codesOf = (output) =>
  [...new Set([...output.matchAll(/\bTS(\d{4,6})\b/g)].map((match) => `TS${match[1]}`))].sort(byCode);

export const effectText = (config) =>
  run("pnpm", ["exec", "effect-tsrs", "diagnostics", "-p", config, "--strict", "--type-check"]);

export const effectDiagnostics = (config) =>
  run("pnpm", [
    "exec",
    "effect-tsrs",
    "diagnostics",
    "-p",
    config,
    "--format",
    "json",
    "--strict",
    "--type-check",
  ]);

export const typeScriptCodes = (config) => run("pnpm", ["exec", "effect-tsgo", "tsc", "-b", config]);

export const plainCodes = (config) => run("pnpm", ["exec", "tsrs", "-p", config, "--noEmit"]);
