#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const PREFIX_COMMANDS = new Set([
  "npx",
  "bunx",
  "pnpm",
  "yarn",
  "bun",
  "npm",
  "corepack",
  "exec",
  "command",
  "time",
  "nice",
  "sudo",
  "doas",
]);
const SEGMENT_BREAKS = new Set([";", "&&", "||", "|", "&", "\n", "(", ")", "{", "}"]);
const ENV_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const SHORT_WITH_VALUE = new Set(["m", "F", "C", "c", "t"]);
const NO_VERIFY = /^--no-v(?:e(?:r(?:i(?:f(?:y)?)?)?)?)?$/;
const HOOK_ENV = new Set(["LEFTHOOK", "LEFTHOOK_EXCLUDE", "HUSKY"]);
const MAX_DEPTH = 5;

const REASON_GATE =
  "The fence refuses this command: a commit runs `pnpm check`, `pnpm test`, and `pnpm test:privacy`. Delegating the commit to a tool that skips the hooks is not allowed until the gate has passed on the current index. Run `node scripts/fence/gate.mjs`, then commit. Removing or weakening the gate needs owner sign-off.";
const REASON_NO_VERIFY =
  "The fence refuses this command: `--no-verify` and `-n` skip every check the commit gate runs. Run `pnpm check && pnpm test && pnpm test:privacy`, fix any failure, and commit normally. Removing or weakening the hooks needs owner sign-off.";
const REASON_HOOK_ENV =
  "The fence refuses this command: disabling the hooks through LEFTHOOK, LEFTHOOK_EXCLUDE, or HUSKY skips every check the commit gate runs. Run the gate, then commit normally. Removing or weakening the hooks needs owner sign-off.";
const REASON_HOOKS_PATH =
  "The fence refuses this command: `core.hooksPath` moves hook execution away from `.githooks`, which is the commit gate. Changing where hooks live needs owner sign-off.";
const REASON_HOOK_FILES =
  "The fence refuses this command: it touches `.git/hooks`, where installed hooks live. `.githooks` is the versioned gate. Editing hooks needs owner sign-off.";
const REASON_LEFTHOOK_UNINSTALL =
  "The fence refuses this command: uninstalling the hook manager leaves the commit gate in place but makes it look removable. Editing hooks needs owner sign-off.";

export const tokenize = (input) => {
  const tokens = [];
  let word = "";
  let started = false;
  let quoted = false;
  const pushWord = () => {
    if (started) tokens.push({ type: "word", value: word, quoted });
    word = "";
    started = false;
    quoted = false;
  };
  let i = 0;
  while (i < input.length) {
    const character = input[i];
    if (character === "\\") {
      if (i + 1 < input.length) {
        word += input[i + 1];
        started = true;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (character === "'") {
      const end = input.indexOf("'", i + 1);
      const stop = end === -1 ? input.length : end;
      word += input.slice(i + 1, stop);
      started = true;
      quoted = true;
      i = stop + 1;
      continue;
    }
    if (character === '"') {
      let j = i + 1;
      while (j < input.length && input[j] !== '"') {
        if (input[j] === "\\" && j + 1 < input.length) {
          word += input[j + 1];
          j += 2;
          continue;
        }
        word += input[j];
        j += 1;
      }
      started = true;
      quoted = true;
      i = j + 1;
      continue;
    }
    if (character === " " || character === "\t" || character === "\r" || character === "\n") {
      pushWord();
      i += 1;
      continue;
    }
    if (";&|()<>{}".includes(character)) {
      pushWord();
      const pair = input.slice(i, i + 2);
      if (pair === "&&" || pair === "||" || pair === ">>" || pair === "<<") {
        tokens.push({ type: "op", value: pair });
        i += 2;
        continue;
      }
      tokens.push({ type: "op", value: character });
      i += 1;
      continue;
    }
    word += character;
    started = true;
    i += 1;
  }
  pushWord();
  return tokens;
};

const segmentsOf = (tokens) => {
  const segments = [];
  let current = [];
  for (const token of tokens) {
    if (token.type === "op" && SEGMENT_BREAKS.has(token.value)) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    if (token.type === "word") current.push(token);
  }
  if (current.length > 0) segments.push(current);
  return segments;
};

const withoutPrefixes = (words) => {
  const assignments = [];
  let sawEnv = false;
  let i = 0;
  while (i < words.length) {
    const value = words[i].value;
    if (!sawEnv && basename(value) === "env") {
      sawEnv = true;
      i += 1;
      continue;
    }
    const assignment = ENV_ASSIGNMENT.exec(value);
    if (assignment !== null) {
      assignments.push({ name: assignment[1], value: assignment[2] });
      i += 1;
      continue;
    }
    if (sawEnv && value.startsWith("-")) {
      i += 1;
      continue;
    }
    if (value === "export" || value === "builtin") {
      i += 1;
      continue;
    }
    break;
  }
  return { assignments, rest: words.slice(i) };
};

const commandIndex = (words) => {
  let i = 0;
  while (i < words.length) {
    if (!PREFIX_COMMANDS.has(basename(words[i].value))) break;
    i += 1;
    while (i < words.length && words[i].value.startsWith("-")) {
      const flag = words[i].value;
      i += 1;
      if (flag === "-u" || flag === "-n" || flag === "--user" || flag === "-c") i += 1;
    }
  }
  return i;
};

const hooksPathMentioned = (words) => words.some((word) => word.value.toLowerCase().includes("hookspath"));

const hookFilesMentioned = (words) =>
  words.some((word) => {
    const value = word.value.toLowerCase();
    return value.includes(".git/hooks") || value.includes(".git\\hooks") || value.includes("git_dir/hooks");
  });

const disabledHookEnvironment = (assignments) =>
  assignments.some(({ name, value }) => {
    if (name === "GIT_CONFIG_PARAMETERS" || name === "GIT_CONFIG_COUNT") {
      return value.toLowerCase().includes("hookspath");
    }
    if (name === "LEFTHOOK_EXCLUDE") return true;
    if (!HOOK_ENV.has(name)) return false;
    return value === "0" || value.toLowerCase() === "false";
  });

const shellPayload = (words, start) => {
  const flagIndex = words.findIndex(
    (word, index) => index >= start && /^-[A-Za-z]*c[A-Za-z]*$/.test(word.value),
  );
  if (flagIndex === -1) return "";
  return words[flagIndex + 1]?.value ?? "";
};

const commitSkip = (args) => {
  let i = 0;
  while (i < args.length) {
    const value = args[i].value;
    if (value === "--") return null;
    if (value.startsWith("--")) {
      if (NO_VERIFY.test(value.split("=")[0])) return "no-verify";
      i += 1;
      continue;
    }
    if (value.startsWith("-") && value.length > 1) {
      const letters = value.slice(1);
      let consumesNext = false;
      for (let j = 0; j < letters.length; j += 1) {
        const letter = letters[j];
        if (letter === "n") return "no-verify";
        if (SHORT_WITH_VALUE.has(letter)) {
          consumesNext = j === letters.length - 1;
          break;
        }
      }
      i += consumesNext ? 2 : 1;
      continue;
    }
    i += 1;
  }
  return null;
};

const gitSubcommand = (args) => {
  let i = 0;
  while (i < args.length) {
    const value = args[i].value;
    if (value === "--") return { name: "", rest: [] };
    if (value === "-C" || value === "-c" || value === "-p" || value === "-P") {
      i += 2;
      continue;
    }
    if (value.startsWith("--")) {
      i += value.includes("=") ? 1 : 2;
      continue;
    }
    if (value.startsWith("-")) {
      i += 1;
      continue;
    }
    return { name: value, rest: args.slice(i + 1) };
  }
  return { name: "", rest: [] };
};

const evaluateSegment = (words, depth, gatePassed) => {
  if (hooksPathMentioned(words)) return { decision: "deny", reason: REASON_HOOKS_PATH };
  if (hookFilesMentioned(words)) return { decision: "deny", reason: REASON_HOOK_FILES };

  const { assignments, rest } = withoutPrefixes(words);
  if (disabledHookEnvironment(assignments)) return { decision: "deny", reason: REASON_HOOK_ENV };
  if (rest.length === 0) return { decision: "allow" };

  const index = commandIndex(rest);
  const command = rest[index];
  if (command === undefined) return { decision: "allow" };
  const name = basename(command.value);

  if (SHELLS.has(name)) {
    const payload = shellPayload(rest, index + 1);
    if (payload === "" || depth >= MAX_DEPTH) return { decision: "allow" };
    return evaluateCommand(payload, { gatePassed, depth: depth + 1 });
  }

  const args = rest.slice(index + 1);

  if (name === "lefthook" || name === "husky") {
    if (args.some((arg) => arg.value === "uninstall"))
      return { decision: "deny", reason: REASON_LEFTHOOK_UNINSTALL };
    return { decision: "allow" };
  }

  if (name === "but") {
    if (args.some((arg) => arg.value === "commit") && !gatePassed)
      return { decision: "deny", reason: REASON_GATE };
    return { decision: "allow" };
  }

  if (name !== "git") return { decision: "allow" };

  const subcommand = gitSubcommand(args);
  if (subcommand.name === "commit" && commitSkip(subcommand.rest) !== null) {
    return { decision: "deny", reason: REASON_NO_VERIFY };
  }

  return { decision: "allow" };
};

export const evaluateCommand = (command, options = {}) => {
  const { gatePassed = false, depth = 0 } = options;
  if (typeof command !== "string" || command.trim() === "") return { decision: "allow" };
  const segments = segmentsOf(tokenize(command));
  for (const segment of segments) {
    const result = evaluateSegment(segment, depth, gatePassed);
    if (result.decision === "deny") return result;
  }
  return { decision: "allow" };
};

const gitOutput = (args) => spawnSync("git", args, { encoding: "utf8" });

export const gateHasPassed = () => {
  const tree = gitOutput(["write-tree"]);
  const gitDir = gitOutput(["rev-parse", "--git-dir"]);
  if (tree.status !== 0 || gitDir.status !== 0) return false;
  try {
    const recorded = readFileSync(join(gitDir.stdout.trim(), "surveybeat-fence"), "utf8").trim();
    return recorded === tree.stdout.trim();
  } catch {
    return false;
  }
};

const readStdin = async () => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
};

const commandFromPayload = (payload) => {
  const candidates = [
    payload?.tool_input?.command,
    payload?.toolInput?.command,
    payload?.command,
    payload?.tool_input?.commands?.[0],
  ];
  return candidates.find((candidate) => typeof candidate === "string") ?? "";
};

const payloadCommand = async () => {
  const raw = await readStdin();
  try {
    return commandFromPayload(JSON.parse(raw));
  } catch {
    return "";
  }
};

const formatOf = (args) => {
  const flag = args.find((arg) => arg.startsWith("--format="));
  return flag === undefined ? "claude" : flag.slice("--format=".length);
};

const inlineCommand = (args) => {
  const index = args.indexOf("--command");
  return index === -1 ? undefined : (args[index + 1] ?? "");
};

export const main = async () => {
  const args = process.argv.slice(2);
  const format = formatOf(args);
  const command = inlineCommand(args) ?? (await payloadCommand());
  const gatePassed = /\bbut\b/.test(command) ? gateHasPassed() : false;
  const result = evaluateCommand(command, { gatePassed });

  if (format === "plain") {
    if (result.decision === "deny") {
      console.error(`fence: ${result.reason}`);
      process.exitCode = 2;
    }
    return;
  }

  if (result.decision === "deny") {
    const denial =
      format === "cursor"
        ? { permission: "deny", user_message: result.reason, agent_message: result.reason }
        : {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: result.reason,
            },
          };
    console.log(JSON.stringify(denial));
    return;
  }

  if (format === "cursor") console.log(JSON.stringify({ permission: "allow" }));
};

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) await main();
