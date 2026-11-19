import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const DAYS_PER_BILLING_MONTH = 30;
const DEFAULT_DAYS = 7;
const DEFAULT_PRICE = 0.008;

/**
 * @typedef {{ id: number, name: string }} Run
 * @typedef {{ run_id: number, name: string, conclusion: string | null, started_at: string | null, completed_at: string | null }} Job
 * @typedef {{ days: number, price: number }} Window
 * @typedef {{ days: number, price: number, repo?: string }} Options
 */

/** @param {{ name: string, path: string }} run */
export const workflowLabel = (run) =>
  run.path.startsWith("dynamic/") ? run.path.slice("dynamic/".length) : run.name;

/**
 * @param {number} now
 * @param {number} days
 */
export const windowStart = (now, days) =>
  new Date(now - days * MS_PER_DAY).toISOString().replace(/\.\d{3}Z$/, "Z");

/** @param {Job} job */
export const jobMinutes = (job) => {
  if (job.conclusion === "skipped" || job.started_at === null || job.completed_at === null) {
    return 0;
  }
  return Math.max(0, (Date.parse(job.completed_at) - Date.parse(job.started_at)) / MS_PER_MINUTE);
};

/**
 * @param {Run[]} runs
 * @param {Job[]} jobs
 * @param {Window} window
 */
export const summarize = (runs, jobs, { days, price }) => {
  /** @type {Map<string, { runs: number, minutes: number, jobs: Map<string, { minutes: number, count: number }> }>} */
  const workflows = new Map();
  const workflowOf = new Map(runs.map((run) => [run.id, run.name]));
  /** @param {string} name */
  const entry = (name) => {
    const existing = workflows.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const created = { runs: 0, minutes: 0, jobs: new Map() };
    workflows.set(name, created);
    return created;
  };

  for (const run of runs) {
    entry(run.name).runs += 1;
  }

  for (const job of jobs) {
    const name = workflowOf.get(job.run_id);
    if (name === undefined) {
      continue;
    }
    const workflow = entry(name);
    const minutes = jobMinutes(job);
    workflow.minutes += minutes;
    if (job.conclusion === "skipped") {
      continue;
    }
    const perJob = workflow.jobs.get(job.name) ?? { minutes: 0, count: 0 };
    perJob.minutes += minutes;
    perJob.count += 1;
    workflow.jobs.set(job.name, perJob);
  }

  const rows = [...workflows.entries()]
    .map(([name, workflow]) => ({
      name,
      runs: workflow.runs,
      minutes: workflow.minutes,
      perJob: [...workflow.jobs.entries()]
        .map(([jobName, perJob]) => ({ name: jobName, mean: perJob.minutes / perJob.count }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalRuns = rows.reduce((sum, row) => sum + row.runs, 0);
  const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0);
  const perDay = totalMinutes / days;
  return {
    rows,
    total: { runs: totalRuns, minutes: totalMinutes },
    perDay,
    costPerBillingMonth: perDay * DAYS_PER_BILLING_MONTH * price,
  };
};

/**
 * @param {ReturnType<typeof summarize>} summary
 * @param {{ days: number, price: number, since: string }} context
 */
export const toMarkdown = (summary, { days, price, since }) => {
  const lines = [
    `Workflow runs created since ${since} (${days} days × 24 h). Minutes are unrounded job durations. GitHub bills each job rounded up to a whole minute, so the cost is a lower bound. Per job: mean minutes over the executions that did not skip.`,
    "",
    "| Workflow | Runs | Runner minutes | Per job |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of summary.rows) {
    const perJob = row.perJob.map((job) => `${job.name} ${job.mean.toFixed(1)}m`).join(", ");
    lines.push(`| ${row.name} | ${row.runs} | ${row.minutes.toFixed(1)} | ${perJob} |`);
  }
  lines.push(
    `| **All** | ${summary.total.runs} | **${summary.total.minutes.toFixed(1)}** | ${summary.perDay.toFixed(1)} per day, about $${summary.costPerBillingMonth.toFixed(2)} per 30 days at $${price}/minute |`,
  );
  return lines.join("\n");
};

/** @param {string[]} argv */
export const parseArgs = (argv) => {
  /** @type {Options} */
  const options = { days: DEFAULT_DAYS, price: DEFAULT_PRICE };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${flag ?? "a flag"}.`);
    }
    if (flag === "--days") {
      options.days = Number(value);
      if (!(options.days > 0)) {
        throw new Error("--days must be a positive number.");
      }
    } else if (flag === "--price") {
      options.price = Number(value);
      if (!(options.price >= 0)) {
        throw new Error("--price must be zero or more.");
      }
    } else if (flag === "--repo") {
      options.repo = value;
    } else {
      throw new Error(`Unknown flag ${flag}.`);
    }
  }
  return options;
};

/** @param {string[]} args */
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/**
 * @param {string} text
 * @returns {any[]}
 */
const jsonLines = (text) =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));

export const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const repo =
    options.repo ?? gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
  const since = windowStart(Date.now(), options.days);
  const query = `per_page=100&created=${encodeURIComponent(`>=${since}`)}`;
  const runs = jsonLines(
    gh(["api", "--paginate", `repos/${repo}/actions/runs?${query}`, "--jq", ".workflow_runs[]"]),
  ).map((run) => ({ id: run.id, name: workflowLabel(run) }));
  const jobs = runs.flatMap((run) =>
    jsonLines(
      gh(["api", "--paginate", `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, "--jq", ".jobs[]"]),
    ),
  );
  const summary = summarize(runs, jobs, { days: options.days, price: options.price });
  console.log(toMarkdown(summary, { days: options.days, price: options.price, since }));
};

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
