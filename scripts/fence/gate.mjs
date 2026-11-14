#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const steps = [
  { name: "typecheck", args: ["run", "typecheck"] },
  { name: "check:ledger", args: ["run", "check:ledger"] },
  { name: "check:comments", args: ["run", "check:comments"] },
  { name: "format:check", args: ["run", "format:check"] },
  { name: "lint", args: ["run", "lint"] },
  { name: "test", args: ["run", "test"] },
  { name: "test:privacy", args: ["run", "test:privacy"] },
];

const git = (args) => spawnSync("git", args, { encoding: "utf8" });

for (const step of steps) {
  const result = spawnSync("pnpm", step.args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`fence: ${step.name} failed, so the commit is refused`);
    console.error("fence: fix the failure or use `git commit` again after it passes");
    process.exit(1);
  }
}

const tree = git(["write-tree"]);
const gitDir = git(["rev-parse", "--git-dir"]);
if (tree.status === 0 && gitDir.status === 0) {
  writeFileSync(join(gitDir.stdout.trim(), "surveybeat-fence"), `${tree.stdout.trim()}\n`);
}
