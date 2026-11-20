import { appendFileSync, readFileSync } from "node:fs";
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

export const COMPARE_FILE_CAP = 300;

const ALL_GATES = { stage: true, canary: true, lighthouse: true };

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * @param {unknown} payload
 * @returns {{ kind: "paths", paths: string[] } | { kind: "incomplete" }}
 */
const readCompareFiles = (payload) => {
  if (!isRecord(payload) || !Array.isArray(payload.files)) {
    return { kind: "incomplete" };
  }

  if (payload.files.length >= COMPARE_FILE_CAP) {
    return { kind: "incomplete" };
  }

  /** @type {string[]} */
  const paths = [];

  for (const file of payload.files) {
    if (!isRecord(file) || typeof file.filename !== "string") {
      return { kind: "incomplete" };
    }

    paths.push(file.filename);

    if (file.previous_filename !== undefined && file.previous_filename !== null) {
      if (typeof file.previous_filename !== "string") {
        return { kind: "incomplete" };
      }

      paths.push(file.previous_filename);
    }
  }

  return { kind: "paths", paths };
};

/**
 * @param {unknown} payload
 * @returns {{ stage: boolean, canary: boolean, lighthouse: boolean }}
 */
export const gatesFromCompare = (payload) => {
  const read = readCompareFiles(payload);

  if (read.kind === "incomplete") {
    return ALL_GATES;
  }

  return classify(read.paths);
};

const readStdin = async () => {
  let input = "";

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  return input;
};

/**
 * @param {{ stage: boolean, canary: boolean, lighthouse: boolean }} result
 * @param {string[]} paths
 */
const writeGates = (result, paths) => {
  for (const path of paths) {
    if (path !== "") {
      console.log(path);
    }
  }

  console.log(`stage=${result.stage} canary=${result.canary} lighthouse=${result.lighthouse}`);
  const output = process.env.GITHUB_OUTPUT;

  if (output !== undefined && output !== "") {
    appendFileSync(
      output,
      `stage=${result.stage}\ncanary=${result.canary}\nlighthouse=${result.lighthouse}\n`,
    );
  }
};

/**
 * @param {string[]} argv
 * @returns {{ compare?: string, unread: boolean }}
 */
export const parseSelectArgs = (argv) => {
  /** @type {{ compare?: string, unread: boolean }} */
  const options = { unread: false };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];

    if (flag === "--unread") {
      options.unread = true;
    } else if (flag === "--compare") {
      const value = argv[index + 1];
      index += 1;

      if (value === undefined || value.startsWith("--")) {
        throw new Error("--compare needs a file path.");
      }

      options.compare = value;
    } else {
      throw new Error(`Unknown flag ${flag ?? ""}.`);
    }
  }

  if (options.unread && options.compare !== undefined) {
    throw new Error("Pass either --compare or --unread.");
  }

  return options;
};

export const main = async () => {
  const args = parseSelectArgs(process.argv.slice(2));

  if (args.unread) {
    writeGates(ALL_GATES, []);

    return;
  }

  if (args.compare !== undefined) {
    /** @type {unknown} */
    let payload;

    try {
      payload = JSON.parse(readFileSync(args.compare, "utf8"));
    } catch {
      writeGates(ALL_GATES, []);

      return;
    }

    const read = readCompareFiles(payload);

    writeGates(gatesFromCompare(payload), read.kind === "paths" ? read.paths : []);

    return;
  }

  const paths = (await readStdin()).split("\n").map((line) => line.replace(/\r$/, ""));
  writeGates(classify(paths), paths);
};

const entry = process.argv[1];

if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
