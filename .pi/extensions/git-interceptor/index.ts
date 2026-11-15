import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const policyPath = fileURLToPath(new URL("../../../scripts/fence/vcs-command-policy.mjs", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));

export default function gitInterceptor(pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return undefined;
    const command = event.input["command"];
    if (typeof command !== "string") return undefined;
    const result = spawnSync(process.execPath, [policyPath, "--format=plain", "--command", command], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    if (result.status !== 2) return undefined;
    return { block: true, reason: result.stderr.trim() };
  });
}
