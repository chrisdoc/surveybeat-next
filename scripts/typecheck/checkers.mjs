import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

/** @typedef {{ references?: { path: string }[] }} RootConfig */

/** @param {RootConfig} config */
const projectConfigs = (config) =>
  (config.references ?? []).map((reference) => join(root, reference.path, "tsconfig.json"));

export const readProjects = () =>
  projectConfigs(JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8")));

/**
 * @param {string} command
 * @param {string[]} args
 */
export const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { status: result.status ?? 1, output };
};

/**
 * @param {string} left
 * @param {string} right
 */
export const byCode = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/** @param {string} output */
export const codesOf = (output) =>
  [...new Set([...output.matchAll(/\bTS(\d{4,6})\b/g)].map((match) => `TS${match[1]}`))].sort(byCode);

/** @param {string} config */
export const effectText = (config) =>
  run("pnpm", ["exec", "effect-tsrs", "diagnostics", "-p", config, "--strict", "--type-check"]);

/** @param {string} config */
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

/** @param {string} config */
export const typeScriptCodes = (config) => run("pnpm", ["exec", "effect-tsgo", "tsc", "-b", config]);

/** @param {string} config */
export const plainCodes = (config) => run("pnpm", ["exec", "tsrs", "-p", config, "--noEmit"]);
