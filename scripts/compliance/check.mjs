import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** @typedef {"all_compliance" | "gdpr" | "soc2"} ComplianceBenchmark */

/** @typedef {"text" | "brief" | "json" | "md" | "csv"} ComplianceOutput */

/** @typedef {{ readonly benchmark: ComplianceBenchmark; readonly output: ComplianceOutput; readonly stage?: string; readonly dryRun: boolean }} ComplianceOptions */

const VALID_BENCHMARKS = new Set(["all_compliance", "gdpr", "soc2"]);

const VALID_OUTPUTS = new Set(["text", "brief", "json", "md", "csv"]);

const MOD_LOCATION = path.resolve(import.meta.dirname, "../../infra/compliance");

const OBSERVABILITY_SCRIPT = path.resolve(import.meta.dirname, "../../infra/scripts/check-observability.ts");

/**
 * @param {readonly string[]} args
 * @param {number} index
 * @param {string} flag
 * @returns {string}
 */
const readFlagValue = (args, index, flag) => {
  const value = args[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
};

/**
 * @param {readonly string[]} args
 * @returns {ComplianceOptions}
 */
export const parseComplianceArgs = (args) => {
  /** @type {ComplianceBenchmark} */
  let benchmark = "all_compliance";
  /** @type {ComplianceOutput} */
  let output = "text";
  /** @type {string | undefined} */
  let stage;
  let dryRun = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--benchmark") {
      const value = readFlagValue(args, index, "--benchmark");
      index++;

      if (value === "all_compliance" || value === "gdpr" || value === "soc2") {
        benchmark = value;
      } else {
        throw new Error(`Unknown benchmark "${value}". Expected one of: ${[...VALID_BENCHMARKS].join(", ")}`);
      }
    } else if (arg === "--output") {
      const value = readFlagValue(args, index, "--output");
      index++;

      if (value === "text" || value === "brief" || value === "json" || value === "md" || value === "csv") {
        output = value;
      } else {
        throw new Error(`Unknown output "${value}". Expected one of: ${[...VALID_OUTPUTS].join(", ")}`);
      }
    } else if (arg === "--stage") {
      stage = readFlagValue(args, index, "--stage");
      index++;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`Unknown argument "${arg ?? ""}"`);
    }
  }

  return stage === undefined ? { benchmark, output, dryRun } : { benchmark, output, stage, dryRun };
};

/**
 * @param {ComplianceOptions} options
 * @returns {readonly string[]}
 */
export const buildPowerpipeArgs = (options) => [
  "benchmark",
  "run",
  "--mod-location",
  MOD_LOCATION,
  "--output",
  options.output,
  "--input=false",
  ...(options.dryRun ? ["--dry-run"] : []),
  options.benchmark,
];

/** @param {string} command */
const hasCommand = (command) => {
  const result = spawnSync("which", [command], { stdio: "ignore" });

  return result.status === 0;
};

/** @param {NodeJS.ProcessEnv} env */
const ensureSteampipeService = (env) => {
  const status = spawnSync("steampipe", ["service", "status"], { env, encoding: "utf8" });
  const running = status.status === 0 && !status.stdout.toLowerCase().includes("not running");
  const hasEnvToken = env.CLOUDFLARE_API_TOKEN !== undefined && env.CLOUDFLARE_API_TOKEN !== "";

  if (running && !hasEnvToken) {
    return 0;
  }

  const subcommand = running ? "restart" : "start";
  const started = spawnSync("steampipe", ["service", subcommand], { env, stdio: "inherit" });

  return started.status ?? 1;
};

export const main = () => {
  /** @type {ComplianceOptions} */
  let options;

  try {
    options = parseComplianceArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "Usage: check.mjs [--benchmark all_compliance|gdpr|soc2] [--output text|brief|json|md|csv] [--stage <stage>] [--dry-run]",
    );

    return 2;
  }

  if (!hasCommand("steampipe") || !hasCommand("powerpipe")) {
    console.error("Missing steampipe or powerpipe CLI. See infra/compliance/README.md for installation.");

    return 2;
  }

  const env = process.env;

  if (!options.dryRun && (env.CLOUDFLARE_API_TOKEN === undefined || env.CLOUDFLARE_API_TOKEN === "")) {
    console.error(
      "CLOUDFLARE_API_TOKEN is unset; Steampipe will rely on ~/.steampipe/config/cloudflare.spc if configured.",
    );
  }

  const serviceExit = ensureSteampipeService(env);

  if (serviceExit !== 0) {
    return serviceExit;
  }

  const ppResult = spawnSync("powerpipe", [...buildPowerpipeArgs(options)], {
    env,
    stdio: "inherit",
  });

  const ppExit = ppResult.status ?? 1;

  if (options.stage !== undefined && !options.dryRun) {
    const obsResult = spawnSync(process.execPath, [OBSERVABILITY_SCRIPT, "--stage", options.stage], {
      env,
      stdio: "inherit",
    });

    if (obsResult.status !== 0) {
      return obsResult.status ?? 1;
    }
  }

  return ppExit;
};

const entry = process.argv[1];

if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = main();
}
