#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const git = (args) => spawnSync("git", args, { encoding: "utf8" });

const tree = git(["rev-parse", "HEAD^{tree}"]);
const gitDir = git(["rev-parse", "--git-dir"]);
if (tree.status !== 0 || gitDir.status !== 0) process.exit(0);

let gatedTree = "";
try {
  gatedTree = readFileSync(join(gitDir.stdout.trim(), "surveybeat-fence"), "utf8").trim();
} catch {
  gatedTree = "";
}

if (gatedTree === tree.stdout.trim()) process.exit(0);

console.error("fence: this commit skipped the pre-commit gate, most likely through --no-verify");
console.error("fence: run `pnpm check && pnpm test` and fix any failure before pushing");
process.exit(1);
