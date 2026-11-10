import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AiNotConfigured, AiUnavailable, type AiInput } from "../ai/AiClient.ts";
import { fakeAiClient } from "../ai/testing.ts";
import { PulseId } from "../pulses/Pulse.ts";
import { type QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import { TeamId } from "../people/Team.ts";
import type { Highlight, RoundResult } from "./Results.ts";
import { RoundId } from "./Round.ts";
import {
  buildThemesInput,
  checkThemesReply,
  nextThemesAttemptAt,
  repeatsCommentWords,
  runThemesAttempt,
  type RoundThemesRecord,
  shouldRequestThemes,
  THEMES_RETRY_WINDOW_MS,
  ThemesReplyInvalid,
  type ThemesJobDecision,
  viewRoundResult,
} from "./Themes.ts";

const MINUTE = 60_000;
const HOUR = 3600_000;
const REQUESTED_AT = 1_731_140_000_000;

const COMMENTS = [
  "Calendars fill up before anyone can plan deep work",
  "Too many meetings and no quiet time for focus",
  "Priorities keep changing, so the plan feels unclear",
  "Nobody protects the afternoons for real project work",
];

const QA = QuestionVersionId.make("qv-themes-a.1");
const QB = QuestionVersionId.make("qv-themes-b.1");
const ratingType: QuestionType = { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: true };

const highlight = (larger: boolean): Highlight => ({
  isLargerThanUsual: larger,
  direction: larger ? "drop" : null,
  label: larger ? "Larger drop" : "Usual",
  explanation: "Compared with the usual change.",
});

const sampleResult = (overrides: Partial<RoundResult> = {}): RoundResult => ({
  roundId: RoundId.make("round-themes-1"),
  pulseId: PulseId.make("pulse-themes"),
  teamId: TeamId.make("team-themes"),
  status: "closed",
  plannedOpenDate: "2026-11-09",
  anonymityMode: "anonymous",
  closedAt: REQUESTED_AT,
  effectiveMinimumGroupSize: 4,
  meetsMinimumGroupSize: true,
  eligibleMembersCount: 8,
  submissionsCount: 6,
  responseRate: 0.75,
  delayed: false,
  questions: [
    {
      questionVersionId: QA,
      position: 1,
      text: "How clear is the plan?",
      type: ratingType,
      dimension: "clarity",
      contributors: 6,
      meetsMinimumGroupSize: true,
      score: 3.4,
      distribution: null,
      change: {
        change: -0.8,
        previousRoundDate: "2026-10-26",
        previousRoundId: RoundId.make("round-prev"),
        highlight: highlight(true),
      },
      typicalChange: null,
      trend: [],
    },
    {
      questionVersionId: QB,
      position: 2,
      text: "How manageable is the workload?",
      type: ratingType,
      dimension: "workload",
      contributors: 2,
      meetsMinimumGroupSize: false,
      score: null,
      distribution: null,
      change: null,
      typicalChange: null,
      trend: [],
    },
  ],
  dimensions: [
    {
      dimension: "clarity",
      score: 3.4,
      usableQuestionCount: 1,
      totalQuestionCount: 1,
      contributors: 6,
      meetsMinimumGroupSize: true,
      change: {
        change: -0.8,
        previousRoundDate: "2026-10-26",
        previousRoundId: RoundId.make("round-prev"),
        matchedQuestionCount: 1,
        currentQuestionCount: 1,
        annotation: null,
        highlight: highlight(true),
      },
      typicalChange: null,
      trend: [],
    },
    {
      dimension: "workload",
      score: null,
      usableQuestionCount: 0,
      totalQuestionCount: 1,
      contributors: null,
      meetsMinimumGroupSize: false,
      change: null,
      typicalChange: null,
      trend: [],
    },
  ],
  comments: [
    { questionVersionId: QA, text: COMMENTS[0] ?? "" },
    { questionVersionId: QA, text: COMMENTS[1] ?? "" },
    { questionVersionId: QB, text: COMMENTS[2] ?? "" },
    { questionVersionId: QB, text: COMMENTS[3] ?? "" },
  ],
  ...overrides,
});

const guide = {
  whatStoodOut: ["Clarity scores dropped since the last Round"],
  whatPeopleRaised: ["Calendars fill up quickly"],
  actionsToCheckOn: ["Review standing meetings"],
  questions: ["What would give you protected time?"],
};

const theme = (label: string, sentence: string, supportingCommentIndexes: ReadonlyArray<number>) => ({
  label,
  sentence,
  supportingCommentIndexes,
});

const validReply = {
  themes: [theme("Meetings crowd out focus", "Meetings leave little quiet time for focused work.", [1, 2])],
  guide,
};

const input = (): AiInput => buildThemesInput(sampleResult(), ["Review standing meetings"], []);

describe("repeatsCommentWords (ADR 0016)", () => {
  const comment = ["We never get enough time for deep focused work at home"];

  it("hits an exact 6-word run", () => {
    expect(repeatsCommentWords("Honestly we never get enough time for deep work", comment)).toBe(true);
  });

  it("misses a 5-word run", () => {
    expect(repeatsCommentWords("we never get enough time and more", comment)).toBe(false);
  });

  it("ignores case, punctuation and diacritics", () => {
    expect(
      repeatsCommentWords("our CAFE planning sessions, keep running long!", [
        "Our Café planning sessions keep running long, honestly.",
      ]),
    ).toBe(true);
  });

  it("hits a run that spans a comment's sentence boundary", () => {
    expect(
      repeatsCommentWords("time, calendars fill up fast every single day", [
        "We lack time. Calendars fill up fast every week.",
      ]),
    ).toBe(true);
  });

  it("is false with no comments", () => {
    expect(repeatsCommentWords("We never get enough time for deep focused work", [])).toBe(false);
  });
});

describe("checkThemesReply (ADR 0016, 0019)", () => {
  it.effect("keeps a theme with two supporters and reports two", () =>
    Effect.gen(function* () {
      const stored = yield* checkThemesReply(validReply, COMMENTS);
      expect(stored.themes).toEqual([
        {
          label: "Meetings crowd out focus",
          sentence: "Meetings leave little quiet time for focused work.",
          supportingComments: 2,
        },
      ]);
    }),
  );

  it.effect("drops a theme with one supporter", () =>
    Effect.gen(function* () {
      const stored = yield* checkThemesReply({ themes: [theme("One", "One voice.", [0])], guide }, COMMENTS);
      expect(stored.themes).toEqual([]);
    }),
  );

  it.effect("counts duplicate indexes once", () =>
    Effect.gen(function* () {
      const stored = yield* checkThemesReply(
        { themes: [theme("Dup", "One voice again.", [1, 1, 1])], guide },
        COMMENTS,
      );
      expect(stored.themes).toEqual([]);
    }),
  );

  it.effect("ignores out-of-range and negative indexes", () =>
    Effect.gen(function* () {
      const onlyOneValid = yield* checkThemesReply(
        { themes: [theme("Out", "Out of range.", [1, 9, -1])], guide },
        COMMENTS,
      );
      expect(onlyOneValid.themes).toEqual([]);

      const twoValid = yield* checkThemesReply(
        { themes: [theme("Out", "Out of range.", [1, 2, 9, -1])], guide },
        COMMENTS,
      );
      expect(twoValid.themes).toEqual([{ label: "Out", sentence: "Out of range.", supportingComments: 2 }]);
    }),
  );

  it.effect("drops a theme whose sentence quotes 6 words and keeps its sibling", () =>
    Effect.gen(function* () {
      const stored = yield* checkThemesReply(
        {
          themes: [
            theme("Calendar", "Calendars fill up before anyone can plan deep work.", [0, 1]),
            theme("Afternoons", "Afternoons get no protection.", [2, 3]),
          ],
          guide,
        },
        COMMENTS,
      );
      expect(stored.themes.map((t) => t.label)).toEqual(["Afternoons"]);
    }),
  );

  it.effect("drops a theme whose label and sentence together quote 6 words", () =>
    Effect.gen(function* () {
      const stored = yield* checkThemesReply(
        { themes: [theme("Too many meetings", "and no quiet time.", [1, 2])], guide },
        COMMENTS,
      );
      expect(stored.themes).toEqual([]);
    }),
  );

  it.effect("keeps only the first 5 theme entries", () =>
    Effect.gen(function* () {
      const seven = Array.from({ length: 7 }, (_, i) =>
        theme(`Theme ${i + 1}`, `Point ${i + 1} is neutral.`, [0, 1]),
      );
      const stored = yield* checkThemesReply({ themes: seven, guide }, COMMENTS);
      expect(stored.themes.map((t) => t.label)).toEqual([
        "Theme 1",
        "Theme 2",
        "Theme 3",
        "Theme 4",
        "Theme 5",
      ]);
    }),
  );

  it.effect("drops a malformed entry and keeps its valid siblings", () =>
    Effect.gen(function* () {
      const stored = yield* checkThemesReply(
        {
          themes: [
            { label: "", sentence: "Empty label.", supportingCommentIndexes: [0, 1] },
            { label: "Only a label" },
            theme("Valid", "A valid neutral theme.", [0, 1]),
          ],
          guide,
        },
        COMMENTS,
      );
      expect(stored.themes.map((t) => t.label)).toEqual(["Valid"]);
    }),
  );

  it.effect("keeps a clean guide", () =>
    Effect.gen(function* () {
      const stored = yield* checkThemesReply(validReply, COMMENTS);
      expect(stored.guide).toEqual(guide);
    }),
  );

  it.effect("drops the whole guide when one action line quotes 6 words", () =>
    Effect.gen(function* () {
      const stored = yield* checkThemesReply(
        {
          themes: [],
          guide: { ...guide, actionsToCheckOn: ["Nobody protects the afternoons for real project work"] },
        },
        COMMENTS,
      );
      expect(stored.guide).toBeNull();
    }),
  );

  it.effect("drops the whole guide with four questions", () =>
    Effect.gen(function* () {
      const stored = yield* checkThemesReply(
        { themes: [], guide: { ...guide, questions: ["a?", "b?", "c?", "d?"] } },
        COMMENTS,
      );
      expect(stored.guide).toBeNull();
    }),
  );

  it.effect("sets the guide to null when it is missing or the wrong type", () =>
    Effect.gen(function* () {
      const missing = yield* checkThemesReply({ themes: [] }, COMMENTS);
      expect(missing.guide).toBeNull();

      const wrongType = yield* checkThemesReply({ themes: [], guide: "oops" }, COMMENTS);
      expect(wrongType.guide).toBeNull();
    }),
  );

  it.effect("fails when the top level is not an object with a themes array", () =>
    Effect.gen(function* () {
      const replies: ReadonlyArray<unknown> = ["oops", null, [], { themes: "x", guide }, { guide }];
      for (const reply of replies) {
        const error = yield* checkThemesReply(reply, COMMENTS).pipe(Effect.flip);
        expect(error).toBeInstanceOf(ThemesReplyInvalid);
      }
    }),
  );
});

describe("nextThemesAttemptAt (ADR 0016)", () => {
  it("first failure retries 5 minutes later", () => {
    expect(nextThemesAttemptAt(REQUESTED_AT, 1, REQUESTED_AT)).toBe(REQUESTED_AT + 5 * MINUTE);
  });

  it("doubles the wait and caps it at 4 hours", () => {
    const now = REQUESTED_AT;
    expect(nextThemesAttemptAt(REQUESTED_AT, 2, now)).toBe(now + 10 * MINUTE);
    expect(nextThemesAttemptAt(REQUESTED_AT, 3, now)).toBe(now + 20 * MINUTE);
    expect(nextThemesAttemptAt(REQUESTED_AT, 7, now)).toBe(now + 4 * HOUR);
    expect(nextThemesAttemptAt(REQUESTED_AT, 20, now)).toBe(now + 4 * HOUR);
  });

  it("gives up once the next attempt would fall after 24 hours", () => {
    expect(nextThemesAttemptAt(REQUESTED_AT, 1, REQUESTED_AT + THEMES_RETRY_WINDOW_MS - 5 * MINUTE)).toBe(
      REQUESTED_AT + THEMES_RETRY_WINDOW_MS,
    );
    expect(
      nextThemesAttemptAt(REQUESTED_AT, 1, REQUESTED_AT + THEMES_RETRY_WINDOW_MS - 4 * MINUTE),
    ).toBeNull();
  });
});

describe("buildThemesInput (ADR 0015, 0019)", () => {
  it("maps scores, changes and largerThanUsual, and hides scores below N", () => {
    const built = buildThemesInput(sampleResult(), [], []);
    expect(built.questions).toEqual([
      {
        position: 1,
        text: "How clear is the plan?",
        dimension: "clarity",
        score: 3.4,
        change: -0.8,
        largerThanUsual: true,
      },
      {
        position: 2,
        text: "How manageable is the workload?",
        dimension: "workload",
        score: null,
        change: null,
        largerThanUsual: false,
      },
    ]);
  });

  it("excludes dimensions below N", () => {
    const built = buildThemesInput(sampleResult(), [], []);
    expect(built.dimensions).toEqual([
      { dimension: "clarity", score: 3.4, change: -0.8, largerThanUsual: true },
    ]);
  });

  it("redacts Action titles with the roster", () => {
    const built = buildThemesInput(
      sampleResult(),
      ["Ask Anna Berg about @anna", ""],
      [{ name: "Anna Berg" }],
    );
    expect(built.actions).toHaveLength(1);
    const serialised = JSON.stringify(built.actions);
    expect(serialised).not.toContain("Anna");
    expect(serialised).not.toContain("Berg");
    expect(serialised).not.toContain("@anna");
  });

  it("returns no keys beyond the four sent fields", () => {
    expect(Object.keys(buildThemesInput(sampleResult(), [], [])).sort()).toEqual([
      "actions",
      "comments",
      "dimensions",
      "questions",
    ]);
  });

  it("sends no comments when the Result is below N", () => {
    const built = buildThemesInput(sampleResult({ meetsMinimumGroupSize: false }), [], []);
    expect(built.comments).toEqual([]);
  });
});

describe("shouldRequestThemes (ADR 0015, 0016)", () => {
  it("requests only with AI on, at N, not delayed, and for a closed or later Round", () => {
    expect(shouldRequestThemes(sampleResult(), true)).toBe(true);
    expect(shouldRequestThemes(sampleResult({ status: "ready" }), true)).toBe(true);
    expect(shouldRequestThemes(sampleResult({ status: "shared" }), true)).toBe(true);
  });

  it("does not request with AI off, below N, delayed, or while open", () => {
    expect(shouldRequestThemes(sampleResult(), false)).toBe(false);
    expect(shouldRequestThemes(sampleResult({ meetsMinimumGroupSize: false }), true)).toBe(false);
    expect(shouldRequestThemes(sampleResult({ delayed: true }), true)).toBe(false);
    expect(shouldRequestThemes(sampleResult({ status: "open" }), true)).toBe(false);
  });
});

/** Runs the job loop: one attempt, then the next at the RetryAt time, until Store or GiveUp. */
const driveThemesJob = (themesInput: AiInput, requestedAt: number) =>
  Effect.gen(function* () {
    const decisions: Array<ThemesJobDecision> = [];
    let attempts = 0;
    let now = requestedAt;
    for (let step = 0; step < 50; step++) {
      const decision = yield* runThemesAttempt({ input: themesInput, requestedAt, attempts, now });
      decisions.push(decision);
      if (decision._tag !== "RetryAt") break;
      attempts = decision.attempts;
      now = decision.dueAt;
    }
    return decisions;
  });

describe("themes job lifecycle (ADR 0016)", () => {
  it.effect("stores on the first try with exactly one request", () =>
    Effect.gen(function* () {
      const themesInput = input();
      const fake = yield* fakeAiClient([Effect.succeed(validReply)]);
      const decisions = yield* driveThemesJob(themesInput, REQUESTED_AT).pipe(Effect.provide(fake.layer));

      expect(decisions.map((d) => d._tag)).toEqual(["Store"]);
      const requests = yield* fake.requests;
      expect(requests).toHaveLength(1);
      expect(requests[0]?.input).toEqual(themesInput);
    }),
  );

  it.effect("retries after an unavailable call, then stores", () =>
    Effect.gen(function* () {
      const fake = yield* fakeAiClient([
        Effect.fail(new AiUnavailable({ reason: "timeout" })),
        Effect.succeed(validReply),
      ]);
      const decisions = yield* driveThemesJob(input(), REQUESTED_AT).pipe(Effect.provide(fake.layer));

      expect(decisions).toEqual([
        { _tag: "RetryAt", dueAt: REQUESTED_AT + 5 * MINUTE, attempts: 1 },
        {
          _tag: "Store",
          themes: {
            themes: [
              {
                label: "Meetings crowd out focus",
                sentence: "Meetings leave little quiet time for focused work.",
                supportingComments: 2,
              },
            ],
            guide,
          },
        },
      ]);
    }),
  );

  it.effect("gives up after the 24-hour window and never schedules past it", () =>
    Effect.gen(function* () {
      // Expected schedule, computed from the backoff rule: attempt k fails at time t_k, the next try
      // is at t_k + min(5 min * 2^(k-1), 4 h), and the job stops once that would pass 24 h.
      const gap = (k: number) => Math.min(5 * MINUTE * 2 ** (k - 1), 4 * HOUR);
      const attemptTimes: Array<number> = [REQUESTED_AT];
      while (attemptTimes.length <= 100) {
        const failures = attemptTimes.length;
        const next = (attemptTimes[failures - 1] ?? 0) + gap(failures);
        if (next > REQUESTED_AT + THEMES_RETRY_WINDOW_MS) break;
        attemptTimes.push(next);
      }

      const fake = yield* fakeAiClient(
        attemptTimes.map(() => Effect.fail(new AiUnavailable({ reason: "timeout" }))),
      );
      const decisions = yield* driveThemesJob(input(), REQUESTED_AT).pipe(Effect.provide(fake.layer));

      expect(decisions).toHaveLength(attemptTimes.length);
      expect(decisions.at(-1)?._tag).toBe("GiveUp");
      decisions.slice(0, -1).forEach((decision, i) => {
        expect(decision).toEqual({ _tag: "RetryAt", dueAt: attemptTimes[i + 1], attempts: i + 1 });
      });
      for (const time of attemptTimes) {
        expect(time).toBeLessThanOrEqual(REQUESTED_AT + THEMES_RETRY_WINDOW_MS);
      }
      const requests = yield* fake.requests;
      expect(requests).toHaveLength(attemptTimes.length);
    }),
  );

  it.effect("gives up after one call when AI is not configured", () =>
    Effect.gen(function* () {
      const fake = yield* fakeAiClient([Effect.fail(new AiNotConfigured())]);
      const decisions = yield* driveThemesJob(input(), REQUESTED_AT).pipe(Effect.provide(fake.layer));

      expect(decisions).toEqual([{ _tag: "GiveUp" }]);
      expect(yield* fake.requests).toHaveLength(1);
    }),
  );

  it.effect("retries an invalid reply", () =>
    Effect.gen(function* () {
      const fake = yield* fakeAiClient([Effect.succeed("oops")]);
      const decision = yield* runThemesAttempt({
        input: input(),
        requestedAt: REQUESTED_AT,
        attempts: 0,
        now: REQUESTED_AT,
      }).pipe(Effect.provide(fake.layer));

      expect(decision).toEqual({ _tag: "RetryAt", dueAt: REQUESTED_AT + 5 * MINUTE, attempts: 1 });
    }),
  );
});

describe("viewRoundResult: the Review window (issue 106)", () => {
  const VIEW_ROUND_ID = RoundId.make("round-view-4d2c");
  const VIEW_QV = QuestionVersionId.make("qv-view-8a1b.1");
  const REVIEW_ENDS_AT = 1_731_400_000_000;
  const VIEW_COMMENTS = [
    "Calendars fill up before anyone can plan deep work",
    "Too many meetings and no quiet time",
  ];
  const VIEW_GUIDE = {
    whatStoodOut: ["Clarity scores held steady"],
    whatPeopleRaised: ["Calendars fill up quickly"],
    actionsToCheckOn: [],
    questions: ["What would give you protected time?"],
  };
  const VIEW_STORED_THEMES = {
    themes: [
      {
        label: "Meetings crowd out focus",
        sentence: "Meetings leave little quiet time.",
        supportingComments: 2,
      },
    ],
    guide: VIEW_GUIDE,
  };
  const VIEW_THEMES: RoundThemesRecord = { status: "ready", themes: VIEW_STORED_THEMES };

  /** A Result with 6 submissions, stored under N = 4 with status closed, so it meets N. */
  const storedResult = (): RoundResult => ({
    roundId: VIEW_ROUND_ID,
    pulseId: PulseId.make("pulse-view-6e3f"),
    teamId: TeamId.make("team-view-9b7a"),
    status: "closed",
    plannedOpenDate: "2026-11-09",
    anonymityMode: "anonymous",
    closedAt: 1_731_140_000_000,
    effectiveMinimumGroupSize: 4,
    meetsMinimumGroupSize: true,
    eligibleMembersCount: 8,
    submissionsCount: 6,
    responseRate: 0.75,
    delayed: false,
    questions: [
      {
        questionVersionId: VIEW_QV,
        position: 1,
        text: "How clear is the plan?",
        type: { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: true },
        dimension: "clarity",
        contributors: 6,
        meetsMinimumGroupSize: true,
        score: 3.4,
        distribution: null,
        change: null,
        typicalChange: null,
        trend: [],
      },
    ],
    dimensions: [
      {
        dimension: "clarity",
        score: 3.4,
        usableQuestionCount: 1,
        totalQuestionCount: 1,
        contributors: 6,
        meetsMinimumGroupSize: true,
        change: null,
        typicalChange: null,
        trend: [],
      },
    ],
    comments: VIEW_COMMENTS.map((text) => ({ questionVersionId: VIEW_QV, text })),
  });

  const view = (
    status: "closed" | "ready" | "shared",
    isLead: boolean,
    reviewEndsAt: number | null = REVIEW_ENDS_AT,
    themes: RoundThemesRecord | null = VIEW_THEMES,
  ) =>
    viewRoundResult({
      stored: storedResult(),
      organizationN: 4,
      isLead,
      themes,
      round: { status, reviewEndsAt },
    });

  it("takes the status from the Round's current row, not the stored payload", () => {
    expect(view("ready", true).status).toBe("ready");
    expect(view("shared", true).status).toBe("shared");
    expect(view("closed", true).status).toBe("closed");
  });

  it("includes reviewEndsAt only while the Round is ready and the end is set", () => {
    expect(view("ready", true).reviewEndsAt).toBe(REVIEW_ENDS_AT);
    expect(view("ready", false).reviewEndsAt).toBe(REVIEW_ENDS_AT);
    expect(view("ready", true, null)).not.toHaveProperty("reviewEndsAt");
    expect(view("closed", true)).not.toHaveProperty("reviewEndsAt");
    expect(view("shared", true)).not.toHaveProperty("reviewEndsAt");
  });

  it.each(["closed", "ready"] as const)(
    "withholds the Result from a member while the Round is %s, keeping the counts",
    (status) => {
      const member = view(status, false);
      expect(member.questions).toEqual([]);
      expect(member.dimensions).toEqual([]);
      expect(member.comments).toEqual([]);
      expect(member.themesStatus).toBe("notRequested");
      expect(member.themes).toEqual([]);
      expect(member).not.toHaveProperty("discussionGuide");
      expect(member.meetsMinimumGroupSize).toBe(true);
      expect(member.submissionsCount).toBe(6);
      expect(member.eligibleMembersCount).toBe(8);
      expect(member.responseRate).toBe(0.75);
      expect(member.delayed).toBe(false);
      expect(member.roundId).toBe(VIEW_ROUND_ID);
      expect(member.closedAt).toBe(1_731_140_000_000);
      expect(member.effectiveMinimumGroupSize).toBe(4);
    },
  );

  it("withholds from a member even when the Round has no themes record", () => {
    const member = view("ready", false, REVIEW_ENDS_AT, null);
    expect(member.questions).toEqual([]);
    expect(member.dimensions).toEqual([]);
    expect(member).not.toHaveProperty("discussionGuide");
  });

  it("gives a member the full Result once the Round is shared, with label and sentence only", () => {
    const member = view("shared", false);
    expect(member.questions).toHaveLength(1);
    expect(member.dimensions).toHaveLength(1);
    expect(member.themesStatus).toBe("ready");
    expect(member.themes).toEqual([
      { label: "Meetings crowd out focus", sentence: "Meetings leave little quiet time." },
    ]);
    expect(member).not.toHaveProperty("discussionGuide");
  });

  it.each(["closed", "ready", "shared"] as const)(
    "leaves the Lead's view of a %s Round unchanged: questions, comments, themes and the guide",
    (status) => {
      const lead = view(status, true);
      expect(lead.questions).toHaveLength(1);
      expect(lead.dimensions).toHaveLength(1);
      expect(lead.comments).toHaveLength(2);
      expect(lead.themesStatus).toBe("ready");
      expect(lead.themes).toEqual(VIEW_STORED_THEMES.themes);
      expect(lead.discussionGuide).toEqual(VIEW_GUIDE);
    },
  );
});
