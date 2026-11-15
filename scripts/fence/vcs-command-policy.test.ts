import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { evaluateCommand, gateHasPassed } from "./vcs-command-policy.mjs";

const denies = (command: string) => evaluateCommand(command, { gatePassed: false }).decision === "deny";
const allows = (command: string) => evaluateCommand(command, { gatePassed: false }).decision === "allow";

const BYPASSES = [
  "git commit --no-verify",
  "git commit --no-verify -m 'wip'",
  "git commit --no-verif -m wip",
  "git commit --no-v -m wip",
  "git commit -n",
  "git commit -nm 'wip'",
  "git commit -qan -m 'wip'",
  "git commit -m 'wip' -n",
  "git -c core.hooksPath=/dev/null commit -m 'wip'",
  "git config --local core.hooksPath .git/my-hooks",
  "git config core.hookspath .git/my-hooks",
  "LEFTHOOK=0 git commit -m 'wip'",
  "LEFTHOOK_EXCLUDE=pre-commit git commit -m 'wip'",
  "HUSKY=0 git commit -m 'wip'",
  "env LEFTHOOK=0 git commit -m 'wip'",
  "lefthook uninstall",
  "npx lefthook uninstall",
  "rm -f .git/hooks/pre-commit",
  "printf '#!/bin/sh\\n' > .git/hooks/pre-commit",
  "chmod +x .git/hooks/pre-commit",
  "pnpm test && git commit --no-verify",
  "git add -A; git commit -nm wip",
];

const ALLOWED = [
  "git commit -m 'fix -n handling'",
  "git commit -m 'never pass --no-verify, the hooks are the gate'",
  "git commit -m '-n'",
  "git commit -m 'document LEFTHOOK=0 and HUSKY=0'",
  "git commit -mn",
  "git commit -am 'a message'",
  "git commit --amend -m 'a message'",
  "echo 'git commit --no-verify'",
  "git log --oneline -n 5",
  "git status",
  "pnpm test",
  "bash -c 'pnpm test'",
  "git commit -m \"run bash -c 'git commit --no-verify'\"",
];

describe("the hook-bypass policy", () => {
  for (const command of BYPASSES) {
    it(`refuses: ${command}`, () => {
      expect(denies(command)).toBe(true);
    });
  }

  for (const command of ALLOWED) {
    it(`allows: ${command}`, () => {
      expect(allows(command)).toBe(true);
    });
  }

  for (const shell of ["bash", "sh"]) {
    for (const command of [
      "git commit --no-verify",
      "git commit -n",
      "git commit -nm wip",
      "LEFTHOOK=0 git commit -m wip",
      "git -c core.hooksPath=/dev/null commit -m wip",
      "git config core.hooksPath .git/hooks",
      "lefthook uninstall",
      "rm .git/hooks/pre-commit",
    ]) {
      it(`refuses inside ${shell} -c: ${command}`, () => {
        expect(denies(`${shell} -c "${command}"`)).toBe(true);
        expect(denies(`${shell} -lc '${command}'`)).toBe(true);
      });
    }
  }

  it("refuses but commit until the gate has passed", () => {
    expect(denies("but commit -m 'wip'")).toBe(true);
    expect(evaluateCommand("but commit -m 'wip'", { gatePassed: true }).decision).toBe("allow");
    expect(allows("but status")).toBe(true);
  });

  it("names the bypass in the denial reason", () => {
    const noVerify = evaluateCommand("git commit --no-verify", { gatePassed: false });
    const hooksPath = evaluateCommand("git config core.hooksPath /tmp/hooks", { gatePassed: false });
    expect(noVerify.decision).toBe("deny");
    expect(hooksPath.decision).toBe("deny");
    if (noVerify.decision === "deny") expect(noVerify.reason).toMatch(/no-verify/i);
    if (hooksPath.decision === "deny") expect(hooksPath.reason).toMatch(/core\.hooksPath/);
  });

  it("prints a deny decision and the reason on stdin, as the harnesses call it", () => {
    const result = spawnSync("node", ["scripts/fence/vcs-command-policy.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git commit --no-verify" } }),
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason).toMatch(/no-verify/);
  });

  it("prints a Cursor-shaped decide for Cursor's beforeShellExecution", () => {
    const result = spawnSync("node", ["scripts/fence/vcs-command-policy.mjs", "--format=cursor"], {
      cwd: process.cwd(),
      encoding: "utf8",
      input: JSON.stringify({ command: "git commit -n" }),
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).permission).toBe("deny");
  });

  it("exits 2 with the reason for harnesses that only read the exit code", () => {
    const result = spawnSync(
      "node",
      ["scripts/fence/vcs-command-policy.mjs", "--format=plain", "--command", "git commit -n"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/fence: The fence refuses this command/);
  });
});

describe("the gate record", () => {
  it("reads the tree the pre-commit gate recorded", () => {
    expect(typeof gateHasPassed()).toBe("boolean");
  });
});
