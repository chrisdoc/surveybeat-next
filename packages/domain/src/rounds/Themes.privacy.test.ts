import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { TeamId } from "../people/Team.ts";
import { PulseId } from "../pulses/Pulse.ts";
import { type QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import type { Roster } from "../privacy/Redaction.ts";
import type { DiscussionGuide, RoundResult } from "./Results.ts";
import { RoundId } from "./Round.ts";
import { buildThemesInput, checkThemesReply, type RoundThemesRecord, viewRoundResult } from "./Themes.ts";

const ratingType: QuestionType = { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: true };

const ROUND_ID = RoundId.make("round-distinct-9f3a");
const TEAM_ID = TeamId.make("team-distinct-7c1e");
const PULSE_ID = PulseId.make("pulse-distinct-2b8d");
const QV = QuestionVersionId.make("qv-distinct-5e6f.1");
const CLOSED_AT = 1731140123456;

const COMMENTS = [
  "Calendars fill up before anyone can plan deep work",
  "Too many meetings and no quiet time for focus",
  "Priorities keep changing, so the plan feels unclear",
  "Nobody protects the afternoons for real project work",
];

/** A Result with n submissions at the Organization's N = 4, every comment on one Question. */
const resultFor = (submissionsCount: number, comments: ReadonlyArray<string>): RoundResult => ({
  roundId: ROUND_ID,
  pulseId: PULSE_ID,
  teamId: TEAM_ID,
  status: "closed",
  plannedOpenDate: "2026-11-09",
  anonymityMode: "anonymous",
  closedAt: CLOSED_AT,
  effectiveMinimumGroupSize: 4,
  meetsMinimumGroupSize: submissionsCount >= 4,
  eligibleMembersCount: 8,
  submissionsCount,
  responseRate: 0.75,
  delayed: false,
  questions: [
    {
      questionVersionId: QV,
      position: 1,
      text: "How clear is the plan?",
      type: ratingType,
      dimension: "clarity",
      contributors: submissionsCount,
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
      contributors: submissionsCount,
      meetsMinimumGroupSize: true,
      change: null,
      typicalChange: null,
      trend: [],
    },
  ],
  comments: comments.map((text) => ({ questionVersionId: QV, text })),
});

const guide: DiscussionGuide = {
  whatStoodOut: ["Clarity scores held steady"],
  whatPeopleRaised: ["Calendars fill up quickly"],
  actionsToCheckOn: ["Review standing meetings"],
  questions: ["What would give you protected time?"],
};

/** The Round's current row for these tests: shared, so a member sees the full Result (ADR 0016, 0019). */
const SHARED = { status: "shared", reviewEndsAt: null } as const;

const readyRecord: RoundThemesRecord = {
  status: "ready",
  themes: {
    themes: [
      {
        label: "Meetings crowd out focus",
        sentence: "Meetings leave little quiet time.",
        supportingComments: 3,
      },
    ],
    guide,
  },
};

/** Lowercased words without diacritics, computed without the code under test. */
const wordsOf = (text: string): ReadonlyArray<string> =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];

const sixWordRuns = (text: string): ReadonlyArray<string> => {
  const words = wordsOf(text);
  const runs: Array<string> = [];
  for (let i = 0; i + 6 <= words.length; i++) runs.push(words.slice(i, i + 6).join(" "));
  return runs;
};

const hasCommentRun = (text: string, comments: ReadonlyArray<string>): boolean => {
  const commentRuns = new Set(comments.flatMap(sixWordRuns));
  return sixWordRuns(text).some((run) => commentRuns.has(run));
};

/** Deterministic pseudo-random numbers in [0, 1), so the generated cases are the same on every run. */
const seededRandom = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

const pick = <A>(random: () => number, items: ReadonlyArray<A>): A => {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error("pick from an empty list");
  return item;
};

/** Random replies: indexes in and out of range, duplicates, and sentences built from comment words. */
const generatedReply = (random: () => number, commentCount: number) => {
  const themeCount = Math.floor(random() * 8);
  const themes = Array.from({ length: themeCount }, () => {
    const indexCount = Math.floor(random() * 5);
    const indexes = Array.from({ length: indexCount }, () => Math.floor(random() * (commentCount + 4)) - 2);
    const source = pick(random, COMMENTS).split(" ");
    const start = Math.floor(random() * source.length);
    const quoted = source.slice(start, start + 6 + Math.floor(random() * 3)).join(" ");
    const sentence = random() < 0.5 ? quoted : `A neutral point number ${Math.floor(random() * 100)}.`;
    return { label: `Theme ${Math.floor(random() * 100)}`, sentence, supportingCommentIndexes: indexes };
  });
  return { themes, guide };
};

describe("Themes Privacy & Rule Table Invariants (ADR 0004, 0016, 0019)", () => {
  it("Invariant T1: no theme or guide is shown below N, to the Lead or to members", () => {
    // Stored at N = 4 with 6 submissions; the Organization raises N to 10, so the Round no longer meets it.
    const stored = resultFor(6, COMMENTS);
    for (const isLead of [true, false]) {
      const view = viewRoundResult({ stored, organizationN: 10, isLead, themes: readyRecord, round: SHARED });
      expect(view.meetsMinimumGroupSize).toBe(false);
      expect(view.themes).toEqual([]);
      expect(view.themesStatus).toBe("notRequested");
      const serialised = JSON.stringify(view);
      expect(serialised).not.toContain("Meetings crowd out focus");
      expect(serialised).not.toContain("Review standing meetings");
      if (isLead) {
        expect(view.discussionGuide).toBeNull();
      } else {
        expect(view).not.toHaveProperty("discussionGuide");
      }
    }
  });

  it("Invariant T2: no stored theme has fewer than 2 supporting comments", () => {
    const random = seededRandom(20260518);
    for (let trial = 0; trial < 300; trial++) {
      const reply = generatedReply(random, COMMENTS.length);
      const result = Effect.runSync(checkThemesReply(reply, COMMENTS));
      for (const theme of result.themes) {
        expect(theme.supportingComments).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("Invariant T3: no theme label, theme sentence, or guide string repeats 6 words of a comment", () => {
    const random = seededRandom(7);
    for (let trial = 0; trial < 300; trial++) {
      const reply = generatedReply(random, COMMENTS.length);
      const result = Effect.runSync(checkThemesReply(reply, COMMENTS));
      for (const theme of result.themes) {
        expect(hasCommentRun(theme.label, COMMENTS)).toBe(false);
        expect(hasCommentRun(theme.sentence, COMMENTS)).toBe(false);
      }
      if (result.guide !== null) {
        const guideStrings = [
          ...result.guide.whatStoodOut,
          ...result.guide.whatPeopleRaised,
          ...result.guide.actionsToCheckOn,
          ...result.guide.questions,
        ];
        for (const text of guideStrings) {
          expect(hasCommentRun(text, COMMENTS)).toBe(false);
        }
      }
    }
  });

  it("Invariant T4: members get only label and sentence, never counts", () => {
    const view = viewRoundResult({
      stored: resultFor(6, COMMENTS),
      organizationN: 4,
      isLead: false,
      themes: readyRecord,
      round: SHARED,
    });
    expect(view.themes).toHaveLength(1);
    for (const theme of view.themes ?? []) {
      expect(Object.keys(theme).sort()).toEqual(["label", "sentence"]);
    }
    expect(JSON.stringify(view)).not.toContain("supportingComments");
  });

  it("Invariant G1: the guide is never shown below N", () => {
    const view = viewRoundResult({
      stored: resultFor(2, COMMENTS),
      organizationN: 4,
      isLead: true,
      themes: readyRecord,
      round: SHARED,
    });
    expect(view.discussionGuide).toBeNull();
    expect(JSON.stringify(view)).not.toContain("Calendars fill up quickly");
  });

  it("Invariant G2: members never get a discussionGuide key, whatever the themes status", () => {
    const records: ReadonlyArray<RoundThemesRecord | null> = [
      readyRecord,
      { status: "pending", requestedAt: CLOSED_AT, attempts: 0 },
      { status: "failed" },
      null,
    ];
    for (const themes of records) {
      const view = viewRoundResult({
        stored: resultFor(6, COMMENTS),
        organizationN: 4,
        isLead: false,
        themes,
        round: SHARED,
      });
      expect(view).not.toHaveProperty("discussionGuide");
      expect(JSON.stringify(view)).not.toContain("Calendars fill up quickly");
    }
  });

  it("Invariant G3: a guide that repeats 6 words of a comment is dropped whole", () => {
    const quoting: DiscussionGuide = {
      ...guide,
      whatPeopleRaised: ["Nobody protects the afternoons for real project work"],
    };
    const stored = Effect.runSync(checkThemesReply({ themes: [], guide: quoting }, COMMENTS));
    expect(stored.guide).toBeNull();
  });

  it("Invariant G4: the model input never carries an Action owner, an id, or a time from the Result", () => {
    const roster: Roster = [{ name: "Owen Ridgeway", email: "owen.person@example.org" }];
    const stored = resultFor(6, COMMENTS);
    const input = buildThemesInput(
      stored,
      ["Check standing meetings with Owen Ridgeway", "Ask owen.person@example.org about planning"],
      roster,
    );
    const serialised = JSON.stringify(input);
    for (const forbidden of [
      "Owen",
      "Ridgeway",
      "owen.person@example.org",
      "owen.person",
      ROUND_ID,
      TEAM_ID,
      PULSE_ID,
      QV,
      String(CLOSED_AT),
      "2026-11-09",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
    expect(Object.keys(input).sort()).toEqual(["actions", "comments", "dimensions", "questions"]);
  });
});
