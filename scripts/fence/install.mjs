#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const probe = spawnSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
if (probe.status !== 0) {
  console.error("fence: not a git work tree, so no hooks were installed");
  process.exit(0);
}

const install = spawnSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
});
process.exit(install.status ?? 1);
