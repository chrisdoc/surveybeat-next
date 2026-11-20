import { describe, expect, it } from "vitest";
import {
  jobMinutes,
  jobsQuery,
  parseArgs,
  requireCompleteRunSearch,
  RUN_SEARCH_CAP,
  summarize,
  toMarkdown,
  windowStart,
  workflowLabel,
} from "./runner-minutes.mjs";

const job = (
  run_id: number,
  name: string,
  started: string | null,
  completed: string | null,
  conclusion = "success",
) => ({
  run_id,
  name,
  conclusion,
  started_at: started,
  completed_at: completed,
});

const runs = [
  { id: 1, name: "CI" },
  { id: 2, name: "CI" },
  { id: 3, name: "Preview" },
];

const jobs = [
  job(1, "check", "2026-11-10T10:00:00Z", "2026-11-10T10:02:00Z"),
  job(1, "privacy", "2026-11-10T10:00:00Z", "2026-11-10T10:00:00Z", "skipped"),
  job(2, "check", "2026-11-10T11:00:00Z", "2026-11-10T11:01:30Z"),
  job(2, "privacy", "2026-11-10T11:00:00Z", "2026-11-10T11:00:30Z"),
  job(3, "deploy", "2026-11-10T12:00:00Z", "2026-11-10T12:01:00Z"),
  job(3, "destroy", null, null, "skipped"),
  job(99, "orphan", "2026-11-10T12:00:00Z", "2026-11-10T12:05:00Z"),
];

describe("windowStart", () => {
  it("is exactly the given number of 24-hour days back, not truncated to midnight", () => {
    const now = Date.parse("2026-11-19T15:37:42.123Z");
    expect(windowStart(now, 7)).toBe("2026-11-12T15:37:42Z");
    expect(windowStart(now, 0.5)).toBe("2026-11-19T03:37:42Z");
  });
});

describe("workflowLabel", () => {
  it("names a workflow by its name", () => {
    expect(workflowLabel({ name: "Preview", path: ".github/workflows/preview.yml" })).toBe("Preview");
  });

  it("groups a GitHub-managed run by its path, not its per-run title", () => {
    expect(
      workflowLabel({
        name: "npm_and_yarn in / for xstate - Update #1709883516",
        path: "dynamic/dependabot/dependabot-updates",
      }),
    ).toBe("dependabot/dependabot-updates");
  });
});

describe("jobMinutes", () => {
  it("is the duration of a finished job in minutes", () => {
    expect(jobMinutes(job(1, "check", "2026-11-10T10:00:00Z", "2026-11-10T10:01:30Z"))).toBe(1.5);
  });

  it("counts a skipped job as zero", () => {
    expect(jobMinutes(job(1, "x", "2026-11-10T10:00:00Z", "2026-11-10T10:05:00Z", "skipped"))).toBe(0);
  });

  it("counts a job without timestamps as zero", () => {
    expect(jobMinutes(job(1, "x", null, null, "cancelled"))).toBe(0);
  });
});

describe("summarize", () => {
  const summary = summarize(runs, jobs, { days: 1, price: 0.008 });

  it("sums runs and runner minutes per workflow, ignoring jobs with no run in the window", () => {
    expect(summary.rows).toEqual([
      {
        name: "CI",
        runs: 2,
        minutes: 4,
        perJob: [
          { name: "check", mean: 1.75 },
          { name: "privacy", mean: 0.5 },
        ],
      },
      { name: "Preview", runs: 1, minutes: 1, perJob: [{ name: "deploy", mean: 1 }] },
    ]);
  });

  it("averages per job over the executions that did not skip", () => {
    const privacy = summary.rows[0]?.perJob.find((perJob) => perJob.name === "privacy");
    expect(privacy?.mean).toBe(0.5);
  });

  it("totals the window and estimates the cost of 30 days at the price", () => {
    expect(summary.total).toEqual({ runs: 3, minutes: 5 });
    expect(summary.perDay).toBe(5);
    expect(summary.costPerBillingMonth).toBeCloseTo(1.2, 10);
  });

  it("returns zero for an empty window", () => {
    const empty = summarize([], [], { days: 7, price: 0.008 });
    expect(empty.rows).toEqual([]);
    expect(empty.total).toEqual({ runs: 0, minutes: 0 });
  });
});

describe("toMarkdown", () => {
  it("prints a table with one row per workflow and an All row", () => {
    const text = toMarkdown(summarize(runs, jobs, { days: 1, price: 0.008 }), {
      days: 1,
      price: 0.008,
      since: "2026-11-18T00:00:00Z",
    });

    expect(text).toContain("| Workflow | Runs | Runner minutes | Per job |");
    expect(text).toContain("created since 2026-11-18T00:00:00Z (1 days × 24 h)");
    expect(text).toContain("Minutes are unrounded job durations");
    expect(text).toContain("the cost is a lower bound");
    expect(text).toContain("| CI | 2 | 4.0 | check 1.8m, privacy 0.5m |");
    expect(text).toContain("| Preview | 1 | 1.0 | deploy 1.0m |");
    expect(text).toContain(
      "| **All** | 3 | **5.0** | 5.0 per day, about $1.20 per 30 days at $0.008/minute |",
    );
  });
});

describe("parseArgs", () => {
  it("defaults to seven days at $0.008 a minute", () => {
    expect(parseArgs([])).toEqual({ days: 7, price: 0.008 });
  });

  it("reads the window, the price and the repository", () => {
    expect(parseArgs(["--days", "3", "--price", "0.01", "--repo", "owner/name"])).toEqual({
      days: 3,
      price: 0.01,
      repo: "owner/name",
    });
  });

  it("refuses a missing value, an unknown flag and a non-positive window", () => {
    expect(() => parseArgs(["--days"])).toThrow("Missing value");
    expect(() => parseArgs(["--bogus", "1"])).toThrow("Unknown flag");
    expect(() => parseArgs(["--days", "0"])).toThrow("--days must be a positive number");
  });
});

describe("the Actions queries", () => {
  it("asks for every attempt of a job, including a rerun", () => {
    expect(jobsQuery("owner/name", 42)).toBe("repos/owner/name/actions/runs/42/jobs?per_page=100&filter=all");
  });

  it("refuses a run list that has reached the filtered-search cap", () => {
    expect(() => requireCompleteRunSearch(RUN_SEARCH_CAP)).toThrow(/cap/);
    expect(() => requireCompleteRunSearch(RUN_SEARCH_CAP - 1)).not.toThrow();
  });
});
