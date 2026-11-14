#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ledgerPath = join(here, "comment-debt.json");
const configPath = join(here, "comment-debt.oxlintrc.json");
const RULE = "no-comments(";

const IGNORED = [
  "**/dist/**",
  "**/dist-types/**",
  "**/node_modules/**",
  ".alchemy/**",
  "infra/tests/**",
  "tools/oxlint-plugin-surveybeat/fixtures/**",
  "**/*.test.ts",
  ".agents/**",
  ".claude/**",
  ".cursor/**",
  ".pi/**",
  ".entire/**",
  ".factory/**",
  ".opencode/**",
];

const oxlint = () => {
  const args = ["exec", "oxlint", "--config", configPath, "--format", "json"];
  for (const pattern of IGNORED) args.push("--ignore-pattern", pattern);
  args.push(".");
  try {
    return execFileSync("pnpm", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    return typeof error.stdout === "string" ? error.stdout : "";
  }
};

const packageOf = (filename) => {
  const parts = filename.replace(/^\.\//, "").replaceAll("\\", "/").split("/");
  const [first, second] = parts;
  if ((first === "packages" || first === "apps" || first === "tools") && second !== undefined) {
    return `${first}/${second}`;
  }
  return first ?? "";
};

const collect = () => {
  const output = oxlint();
  const report = JSON.parse(output === "" ? '{"diagnostics":[]}' : output);
  const current = {};
  for (const diagnostic of report.diagnostics) {
    if (typeof diagnostic.code !== "string" || !diagnostic.code.startsWith(RULE)) continue;
    const key = `${packageOf(diagnostic.filename)}:${diagnostic.code.slice(RULE.length, -1)}`;
    current[key] = (current[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(current).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
};

const readLedger = () => {
  try {
    return JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch {
    return {};
  }
};

const total = (counts) => Object.values(counts).reduce((sum, count) => sum + count, 0);

const main = () => {
  const current = collect();

  if (process.argv.includes("--update")) {
    writeFileSync(ledgerPath, `${JSON.stringify(current, null, 2)}\n`);
    console.log(
      `comments: wrote ${total(current)} hits across ${Object.keys(current).length} kinds to ${ledgerPath}`,
    );
    return 0;
  }

  const ledger = readLedger();
  const problems = [];
  for (const [kind, count] of Object.entries(current)) {
    const allowed = ledger[kind] ?? 0;
    if (count > allowed) problems.push(`${kind}: ${allowed} -> ${count}`);
  }
  for (const [kind, count] of Object.entries(ledger)) {
    const now = current[kind] ?? 0;
    if (now < count) problems.push(`${kind}: ${count} -> ${now} (ledger is stale)`);
  }

  if (problems.length === 0) {
    console.log(`comments: ${total(current)} prose comments, none added (docs/agents/comment-debt-plan.md)`);
    return 0;
  }

  console.error("comments: the count changed, and it may only shrink:");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "comments: move the reason into a name, a test, a commit subject, or an ADR; run `pnpm check:comments --update` after a batch lands.",
  );
  return 1;
};

process.exitCode = main();
