import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CANARY =
  /^(packages\/cloudflare\/|infra\/|scripts\/ci\/|apps\/web\/(answer\.html|vite\.config\.ts|src\/answer\/|src\/messages\/)|pnpm-workspace\.yaml|pnpm-lock\.yaml|\.github\/workflows\/preview\.yml)/;
const LIGHTHOUSE =
  /^(apps\/web\/(answer\.html|vite\.config\.ts|src\/answer\/|src\/messages\/)|infra\/scripts\/lighthouse|infra\/package\.json)/;
const PROSE = [
  /^docs\//,
  /\.md$/,
  /^\.(agents?|claude|cursor|factory|opencode|pi|entire)\//,
  /^\.githooks\//,
  /^skills-lock\.json$/,
  /^scripts\//,
];

/**
 * @param {RegExp} pattern
 * @param {string[]} paths
 */
const anyMatch = (pattern, paths) => paths.some((path) => pattern.test(path));

/** @param {string} path */
const isProse = (path) => PROSE.some((pattern) => pattern.test(path));

/**
 * @param {string[]} paths
 * @returns {{ stage: boolean, canary: boolean, lighthouse: boolean }}
 */
export const classify = (paths) => {
  const files = paths.filter((path) => path !== "");
  const canary = anyMatch(CANARY, files);
  const lighthouse = anyMatch(LIGHTHOUSE, files);
  const proseOnly = files.length > 0 && files.every(isProse);
  return { stage: !proseOnly || canary || lighthouse, canary, lighthouse };
};

const readStdin = async () => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
};

export const main = async () => {
  const paths = (await readStdin()).split("\n").map((line) => line.replace(/\r$/, ""));
  const result = classify(paths);
  for (const path of paths) if (path !== "") console.log(path);
  console.log(`stage=${result.stage} canary=${result.canary} lighthouse=${result.lighthouse}`);
  const output = process.env.GITHUB_OUTPUT;
  if (output !== undefined && output !== "") {
    appendFileSync(
      output,
      `stage=${result.stage}\ncanary=${result.canary}\nlighthouse=${result.lighthouse}\n`,
    );
  }
};

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) await main();
