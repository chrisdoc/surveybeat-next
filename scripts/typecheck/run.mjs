import { dirname, relative } from "node:path";
import { effectText, readProjects, run } from "./checkers.mjs";

const fast = process.argv.includes("--fast");
const projects = readProjects();

let failed = false;
for (const config of projects) {
  const result = fast ? run("pnpm", ["exec", "tsrs", "-p", config, "--noEmit"]) : effectText(config);
  const name = relative(process.cwd(), dirname(config));
  const summary = fast ? "" : `  ${result.output.trim().split("\n").at(-1) ?? ""}`;
  console.log(`${result.status === 0 ? "ok  " : "FAIL"} ${name}${summary}`);
  if (result.status !== 0 && !fast) console.log(result.output.trimEnd());
  if (result.status !== 0) failed = true;
}

console.log(
  fast
    ? `typecheck:fast read ${projects.length} projects; plain tsrs reports no Effect diagnostics.`
    : `typecheck read ${projects.length} projects.`,
);
process.exit(failed ? 1 : 0);
