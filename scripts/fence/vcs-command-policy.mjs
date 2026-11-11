#!/usr/bin/env node
const NO_VERIFY = /(^|[\s;&|])git\b[^\n]*\s--no-verify\b/;
const HOOKS_PATH_OVERRIDE = /(^|[\s;&|])git\b[^\n]*\s-c\s+core\.hooksPath=/;

export const refusesHookBypass = (command) =>
  typeof command === "string" && (NO_VERIFY.test(command) || HOOKS_PATH_OVERRIDE.test(command));

const readStdin = async () => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
};

const reason =
  "The fence refuses this command: hooks are the gate that makes broken code hard to commit. Run `pnpm check && pnpm test`, fix any failure, and commit normally. Removing or editing a hook needs owner sign-off.";

const commandOf = (raw) => {
  try {
    const payload = JSON.parse(raw);
    return payload?.tool_input?.command ?? "";
  } catch {
    return "";
  }
};

const main = async () => {
  const command = commandOf(await readStdin());
  if (!refusesHookBypass(command)) return;
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
};

await main();
