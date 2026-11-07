import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const root = fileURLToPath(new URL("..", import.meta.url))
export function buildAll({ quiet = true } = {}) {
  for (const V of ["A", "B", "C", "D"])
    for (const NOSCHEMA of ["0", "1"])
      execFileSync("node_modules/.bin/vite", ["build", "--logLevel", "warn"], {
        cwd: root, stdio: quiet ? "pipe" : "inherit", env: { ...process.env, VARIANT: V, NOSCHEMA },
      })
}
if (import.meta.url === `file://${process.argv[1]}`) { buildAll({ quiet: false }); console.log("built A B C (+ -nos)") }
