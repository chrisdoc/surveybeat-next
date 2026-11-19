import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const workspacePath = join(root, "pnpm-workspace.yaml");
const revisionPath = join(root, "scripts", "typecheck", "tsrs-revision.json");

/**
 * @param {string} pkg
 * @returns {string}
 */
const latest = (pkg) => execFileSync("npm", ["view", pkg, "version"], { encoding: "utf8" }).trim();

const effectTsrs = latest("@yielded/effect-tsrs");
const tsgo = latest("@effect/tsgo");

let workspace = readFileSync(workspacePath, "utf8");
workspace = workspace.replace(/(\n\s+"@yielded\/effect-tsrs": )\S+/, `$1${effectTsrs}`);
workspace = workspace.replace(/(\n\s+"@effect\/tsgo": )\S+/, `$1${tsgo}`);
writeFileSync(workspacePath, workspace);
console.log(`pinned @yielded/effect-tsrs ${effectTsrs}, @effect/tsgo ${tsgo}`);

const install = spawnSync("pnpm", ["install", "--ignore-scripts"], { cwd: root, stdio: "inherit" });
if (install.status !== 0) {
  console.error("bump:checkers: pnpm install failed");
  process.exit(1);
}

const version = execFileSync("pnpm", ["exec", "effect-tsrs", "--version"], { cwd: root, encoding: "utf8" });
const bundled = /\(tsrs ([0-9a-f]+)\)/.exec(version)?.[1] ?? "unknown";
const recorded = JSON.parse(readFileSync(revisionPath, "utf8")).revision;
console.log(
  `bundled tsrs revision ${bundled}; recorded ${recorded}; ${bundled === recorded ? "matches" : "differs"}`,
);

const parity = spawnSync("pnpm", ["run", "typecheck:parity"], { cwd: root, stdio: "inherit" });
process.exit(parity.status === 0 ? 0 : 1);
