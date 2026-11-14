#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, "diagnostics-ledger.json");
const sourceFile = /\.(?:[cm]?[jt]sx?)$/;
const effectNextLine = /@effect-diagnostics-next-line\s+([A-Za-z]+):off\b/g;
const effectFile = /@effect-diagnostics\s+([A-Za-z]+):off\b/g;
const lintDisable = /oxlint-disable(-next-line|-line)?\b/g;

const trackedFiles = () =>
  execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\0")
    .filter((file) => file !== "" && sourceFile.test(file));

const countFile = (text, tally) => {
  const bump = (kind) => tally.set(kind, (tally.get(kind) ?? 0) + 1);
  for (const match of text.matchAll(effectNextLine)) bump(`effect-next-line:${match[1]}`);
  for (const match of text.matchAll(effectFile)) bump(`effect-file:${match[1]}`);
  for (const match of text.matchAll(lintDisable)) bump(`lint:${match[1] ?? "block"}`);
};

const collect = () => {
  const tally = new Map();
  for (const file of trackedFiles()) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    countFile(text, tally);
  }
  return tally;
};

const sorted = (tally) =>
  Object.fromEntries(
    [...tally.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );

const readBaseline = () => {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    return {};
  }
};

const main = () => {
  const tally = collect();
  const current = sorted(tally);

  if (process.argv.includes("--update")) {
    writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`ledger: wrote ${Object.keys(current).length} kinds to ${baselinePath}`);
    return 0;
  }

  const baseline = readBaseline();
  const problems = [];
  for (const [kind, count] of Object.entries(current)) {
    const allowed = baseline[kind] ?? 0;
    if (count > allowed) problems.push(`${kind}: ${allowed} -> ${count}`);
  }
  for (const [kind, count] of Object.entries(baseline)) {
    const now = current[kind] ?? 0;
    if (now < count) problems.push(`${kind}: ${count} -> ${now} (baseline is stale)`);
  }

  if (problems.length === 0) {
    const total = Object.values(current).reduce((sum, count) => sum + count, 0);
    console.log(`ledger: ${total} overrides across ${Object.keys(current).length} kinds, none added`);
    return 0;
  }

  console.error("ledger: the override counts changed, and the ledger only shrinks:");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "ledger: remove the override and fix the code, or run `pnpm check:ledger --update` when the count went down.",
  );
  return 1;
};

process.exitCode = main();
