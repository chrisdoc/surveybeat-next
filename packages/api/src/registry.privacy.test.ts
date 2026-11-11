import { assert, describe, it } from "@effect/vitest";
import {
  buildMemberHistory,
  buildTeamOverview,
  calculateRoundResult,
  type Dimension,
  type HistoricalRoundData,
  MemberHistory,
  PulseId,
  type QuestionInput,
  QuestionVersionId,
  RoundId,
  RoundResult,
  roundDecimals,
  type RoundThemesRecord,
  type StoredThemes,
  type SubmissionAnswer,
  TeamId,
  viewRoundResult,
} from "@surveybeat/domain";
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import { HttpApi, type HttpApiEndpoint } from "effect/http-api";
import * as Schema from "effect/Schema";
import { SurveyBeatApi } from "./index.ts";
import { pageRouteKeys } from "./PageRoutes.ts";
import {
  type LeadOnlyField,
  pageRoutePrivacy,
  privacyRegistry,
  RoundResultScenario,
} from "./PrivacyRegistry.ts";

/** Every endpoint of the runtime declaration, as `group.endpoint`. */
const declaredEndpoints = (): ReadonlyArray<string> => {
  const keys: Array<string> = [];
  HttpApi.reflect(SurveyBeatApi, {
    onGroup: () => {},
    onEndpoint: ({ group, endpoint }) => keys.push(`${group.identifier}.${endpoint.identifier}`),
  });
  return keys;
};

describe("page routes", () => {
  it("classifies every server-rendered page route", () => {
    const unclassified = pageRouteKeys.filter((key) => !Object.hasOwn(pageRoutePrivacy, key));
    assert.deepStrictEqual(
      unclassified,
      [],
      "add these page routes to pageRoutePrivacy in PrivacyRegistry.ts",
    );
  });

  it("carries no Result data on a page route", () => {
    for (const key of pageRouteKeys) assert.strictEqual(pageRoutePrivacy[key]._tag, "NoResultData");
  });

  it("lists no page route that the Worker does not serve", () => {
    assert.deepStrictEqual(Object.keys(pageRoutePrivacy).sort(), [...pageRouteKeys].sort());
    assert.deepStrictEqual([...pageRouteKeys], ["pages.delivery", "pages.unsubscribe"]);
  });
});

describe("privacy registry", () => {
  it("classifies every endpoint of SurveyBeatApi", () => {
    const unlisted = declaredEndpoints().filter((key) => !Object.hasOwn(privacyRegistry, key));
    assert.deepStrictEqual(unlisted, [], "add these endpoints to privacyRegistry in PrivacyRegistry.ts");
  });

  it("lists no endpoint that the declaration does not have", () => {
    const declared = new Set(declaredEndpoints());
    const stale = Object.keys(privacyRegistry).filter((key) => !declared.has(key));
    assert.deepStrictEqual(stale, []);
  });

  it("enumerates the declaration, so the checks above are not vacuous", () => {
    assert.include(declaredEndpoints(), "auth.session");
  });

  it("has an input generator for every Result-bearing endpoint, and a check that consumes it", () => {
    const resultEndpoints = Object.entries(privacyRegistry)
      .filter(([, entry]) => entry._tag === "ResultData")
      .map(([key]) => key)
      .sort();
    assert.deepStrictEqual(resultEndpoints, Object.keys(resultResponders).sort());
    assert.include(resultEndpoints, "rounds.getResults");
  });

  for (const [key, entry] of Object.entries(privacyRegistry)) {
    if (entry._tag !== "ResultData") continue;
    const respond = resultResponders[key];

    // Property test over the registry's own generator: whatever Round and viewer the generator produces,
    // the endpoint's Result shows no aggregate computed from fewer than the effective N contributors,
    // no Comment theme or discussion guide below N, and no Lead-only field to a member.
    it.effect(`${key}: no aggregate below the effective N for any generated Round (ADR 0004)`, () =>
      Effect.gen(function* () {
        assert.isDefined(respond, `no Result check registered for ${key}`);
        const check = yield* Arbitrary.checkEffect(
          entry.inputs,
          (input) =>
            Effect.suspend(() => {
              const scenario = Schema.decodeUnknownSync(RoundResultScenario)(input);
              const failures = respond(scenario, entry.leadOnly);
              return failures.length > 0 ? Effect.fail(failures.join("; ")) : Effect.succeed(true);
            }),
          { runs: 500, seed: 20261109 },
        );
        assert.strictEqual(Arbitrary.formatCheckFailure(check), undefined);
        assert.strictEqual(check._tag, "Passed");
      }),
    );
  }

  it("a ready Round that meets N: the Lead sees its Result and the Review window end; a member sees neither", () => {
    const readyScenario: RoundResultScenario = {
      status: "ready",
      storedN: 2,
      organizationN: 2,
      eligibleMembers: 5,
      questions: [
        { kind: "text", dimension: null },
        { kind: "rating", dimension: "workload" },
      ],
      submissions: [0, 1, 2, 3].map((s) => [
        { answered: true, value: 0, comment: s % 2 === 0 ? "too much work" : "fine" },
        { answered: true, value: 2, comment: null },
        { answered: false, value: 0, comment: null },
        { answered: false, value: 0, comment: null },
        { answered: false, value: 0, comment: null },
      ]),
      history: [],
      viewer: "lead",
      themes: "ready",
    };
    const asLead = buildResult(readyScenario).result;
    assert.strictEqual(asLead.status, "ready");
    assert.strictEqual(asLead.reviewEndsAt, READY_REVIEW_ENDS_AT);
    assert.isNotEmpty(asLead.questions);
    assert.isNotEmpty(asLead.dimensions);
    assert.isNotEmpty(asLead.themes ?? []);

    const asMember = buildResult({ ...readyScenario, viewer: "member" }).result;
    assert.strictEqual(asMember.status, "ready");
    assert.strictEqual(asMember.reviewEndsAt, READY_REVIEW_ENDS_AT);
    assert.deepStrictEqual(asMember.questions, []);
    assert.deepStrictEqual(asMember.dimensions, []);
    assert.deepStrictEqual(asMember.comments, []);
    assert.deepStrictEqual(asMember.themes, []);
    assert.strictEqual(asMember.themesStatus, "notRequested");
    assert.isFalse(Object.hasOwn(asMember, "discussionGuide"));
  });

  it("a Lead receives the Lead-only fields of a ready Round that meets N", () => {
    const lead: RoundResultScenario = {
      status: "closed",
      storedN: 2,
      organizationN: 2,
      eligibleMembers: 5,
      questions: [
        { kind: "text", dimension: null },
        { kind: "rating", dimension: "workload" },
      ],
      submissions: [0, 1, 2, 3].map((s) => [
        { answered: true, value: 0, comment: s % 2 === 0 ? "too much work" : "fine" },
        { answered: true, value: 2, comment: null },
        { answered: false, value: 0, comment: null },
        { answered: false, value: 0, comment: null },
        { answered: false, value: 0, comment: null },
      ]),
      history: [],
      viewer: "lead",
      themes: "ready",
    };
    const asLead = buildResult(lead).result;
    assert.isNotEmpty(asLead.comments);
    assert.isNotEmpty(asLead.themes ?? []);
    assert.isTrue((asLead.themes ?? []).every((theme) => theme.supportingComments !== undefined));
    assert.isNotNull(asLead.discussionGuide);

    // Members see the themes only once the Round is Shared (the Review window is over).
    const asMember = buildResult({ ...lead, status: "shared", viewer: "member" }).result;
    assert.deepStrictEqual(asMember.comments, []);
    assert.deepStrictEqual(
      (asMember.themes ?? []).map((theme) => Object.keys(theme).sort()),
      [
        ["label", "sentence"],
        ["label", "sentence"],
      ],
    );
    assert.isFalse(Object.hasOwn(asMember, "discussionGuide"));
  });

  it("a member's encoded Results response never carries counts, raw comments, or the guide", () => {
    for (const themes of ["none", "pending", "ready", "failed"] as const) {
      const member: RoundResultScenario = {
        status: "shared", // members see themes only once the Round is Shared (Review window)
        storedN: 2,
        organizationN: 2,
        eligibleMembers: 5,
        questions: [
          { kind: "text", dimension: null },
          { kind: "rating", dimension: "workload" },
        ],
        submissions: [0, 1, 2, 3].map((s) => [
          { answered: true, value: 0, comment: s % 2 === 0 ? "too much work" : "fine" },
          { answered: true, value: 2, comment: null },
          { answered: false, value: 0, comment: null },
          { answered: false, value: 0, comment: null },
          { answered: false, value: 0, comment: null },
        ]),
        history: [],
        viewer: "member",
        themes,
      };
      const { result } = buildResult(member);
      const wire = JSON.stringify(Schema.encodeSync(RoundResult)(result));
      if (themes === "ready") assert.isNotEmpty(result.themes ?? [], "the ready member view carries themes");

      assert.notInclude(wire, "supportingComments", `themes ${themes}`);
      assert.notInclude(wire, "discussionGuide", `themes ${themes}`);
      assert.deepStrictEqual(result.comments, [], `themes ${themes}`);
    }
  });
});

// --- The Result-shaped response of each Result-bearing endpoint, built the way the handler builds it ---

interface Built {
  readonly effectiveN: number;
  readonly questions: ReadonlyArray<QuestionInput>;
  readonly submissions: ReadonlyArray<{
    readonly id: string;
    readonly answers: ReadonlyArray<SubmissionAnswer>;
  }>;
  readonly result: RoundResult;
  /** The Result as stored under the Round's own N, before the current Organization N is applied. */
  readonly stored: RoundResult;
  /** The same Round computed from scratch at the effective N: the most that may ever be shown. */
  readonly direct: RoundResult;
}

const DIMENSIONS = ["workload", "psychologicalSafety", "clarity", "recognition"] as const;
const ROUND = RoundId.make("round-now");
const PULSE = PulseId.make("pulse-1");
const TEAM = TeamId.make("team-1");
const OPTIONS = ["Red", "Green", "Blue"];

/** The stored themes and discussion guide of a `ready` Round, fixed: their wording is not under test. */
const READY_THEMES: StoredThemes = {
  themes: [
    { label: "Workload", sentence: "Busy weeks leave little room for planned work.", supportingComments: 2 },
    { label: "Priorities", sentence: "Several people would like clearer priorities.", supportingComments: 3 },
  ],
  guide: {
    whatStoodOut: ["Workload moved more than usual."],
    whatPeopleRaised: ["Priorities came up in several comments."],
    actionsToCheckOn: ["Review the planning rhythm."],
    questions: ["What would make busy weeks easier?"],
  },
};

/** The themes record the Organization holds for a Round in the scenario's themes state (ADR 0016). */
const themesRecordOf = (themes: RoundResultScenario["themes"]): RoundThemesRecord | null => {
  switch (themes) {
    case "none":
      return null;
    case "pending":
      return { status: "pending", requestedAt: 0, attempts: 0 };
    case "failed":
      return { status: "failed" };
    case "ready":
      return { status: "ready", themes: READY_THEMES };
  }
};

/** When a ready Round's Review window ends, in the scenarios that have one (ADR: Review window, issue 106). */
const READY_REVIEW_ENDS_AT = 1_731_400_000_000;

const buildResult = (scenario: RoundResultScenario): Built => {
  const effectiveN = Math.max(scenario.storedN, scenario.organizationN);
  const questions: ReadonlyArray<QuestionInput> = scenario.questions.map((question, index) => ({
    id: QuestionVersionId.make(`q${index}.1`),
    position: index,
    text: `Question ${index}`,
    dimension: question.dimension,
    type:
      question.kind === "rating"
        ? { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: true }
        : question.kind === "choice"
          ? { _tag: "SingleChoice", options: OPTIONS }
          : { _tag: "LongText" },
  }));
  const submissions = scenario.submissions.map((submission, s) => ({
    id: `s${s}`,
    answers: questions.flatMap((question, index): ReadonlyArray<SubmissionAnswer> => {
      const answer = submission[index];
      if (answer === undefined || !answer.answered) return [];
      const kind = scenario.questions[index]?.kind;
      return [
        {
          questionVersionId: question.id,
          value:
            kind === "rating" ? answer.value + 1 : kind === "choice" ? answer.value % OPTIONS.length : null,
          comment: kind === "choice" ? null : answer.comment,
        },
      ];
    }),
  }));
  const history: ReadonlyArray<HistoricalRoundData> = scenario.history.map((past, i) => {
    const usable = (score: number | null, contributors: number) =>
      score !== null &&
      contributors >= past.effectiveMinimumGroupSize &&
      past.submissionsCount >= contributors
        ? score
        : null;
    return {
      roundId: RoundId.make(`past-${i}`),
      plannedOpenDate: new Date(Date.UTC(2025, 0, 6 + 7 * i)).toISOString().slice(0, 10),
      closedAt: 1_700_000_000_000 + i,
      effectiveMinimumGroupSize: past.effectiveMinimumGroupSize,
      submissionsCount: past.submissionsCount,
      questions: questions.map((question, index) => {
        const slot = past.questions[index];
        const score = usable(slot?.score ?? null, slot?.contributors ?? 0);
        return {
          questionVersionId: question.id,
          score,
          contributors: slot?.contributors ?? 0,
          meetsMinimumGroupSize: score !== null,
        };
      }),
      dimensions: DIMENSIONS.map((dimension, index) => {
        const slot = past.dimensions[index];
        const score = usable(slot?.score ?? null, slot?.contributors ?? 0);
        return {
          dimension,
          score,
          usableQuestionCount: slot?.usableQuestionCount ?? 0,
          contributors: slot?.contributors ?? 0,
          meetsMinimumGroupSize: score !== null,
        };
      }),
    };
  });
  const compute = (effectiveMinimumGroupSize: number): RoundResult =>
    calculateRoundResult({
      roundId: ROUND,
      pulseId: PULSE,
      teamId: TEAM,
      status: scenario.status,
      plannedOpenDate: "2026-11-09",
      anonymityMode: "anonymous",
      closedAt: scenario.status === "open" ? null : 1_731_140_000_000,
      effectiveMinimumGroupSize,
      eligibleMembersCount: scenario.eligibleMembers,
      questions,
      submissions,
      pastRoundsHistory: history,
    });
  const stored = compute(scenario.storedN);
  return {
    effectiveN,
    questions,
    submissions,
    stored,
    // What `Organization.viewResults` returns, through `viewRoundResult`, the single source of truth
    // shared with the Organization object: the Result stored under the Round's own N, then the current
    // Organization N applied on read (Rule R9), then the viewer's theme and guide fields (ADR 0016, 0019).
    result: viewRoundResult({
      stored,
      organizationN: scenario.organizationN,
      isLead: scenario.viewer === "lead",
      // Any record, even for an open Round: the view itself must hide themes until the Round closes.
      themes: themesRecordOf(scenario.themes),
      round: {
        status: scenario.status,
        reviewEndsAt: scenario.status === "ready" ? READY_REVIEW_ENDS_AT : null,
      },
    }),
    direct: compute(effectiveN),
  };
};

const resultResponders: Record<
  string,
  (scenario: RoundResultScenario, leadOnly: ReadonlyArray<LeadOnlyField>) => ReadonlyArray<string>
> = {
  "rounds.getResults": (scenario, leadOnly) => violations(scenario, buildResult(scenario), leadOnly),
  "rounds.getTeamOverview": (scenario) => overviewViolations(scenario),
  "rounds.getMyHistory": (scenario) => historyViolations(scenario),
};

/** Contributors to a Question counted from the raw Submissions, never from the Result under test. */
const contributorsOf = (built: Built, index: number): number => {
  const question = built.questions[index];
  if (question === undefined) return 0;
  return built.submissions.filter((submission) =>
    submission.answers.some(
      (answer) =>
        answer.questionVersionId === question.id &&
        (question.type._tag === "LongText"
          ? answer.comment !== null && answer.comment.trim().length > 0
          : answer.value !== null),
    ),
  ).length;
};

/**
 * The usable Rating Questions of one Dimension in a Round, and the Submissions that gave a value to
 * one of them: contributors counted from the raw Submissions. Usable only when the Round is shown
 * (not open, and at least N Submissions) and the Question has at least N contributors.
 */
const dimensionContributors = (
  built: Built,
  dimension: Dimension,
  n: number,
): {
  readonly usable: ReadonlyArray<{ readonly question: QuestionInput; readonly index: number }>;
  readonly contributors: number;
} => {
  const roundMeetsN = built.result.status !== "open" && built.result.submissionsCount >= n;
  const usable = built.questions
    .map((question, index) => ({ question, index }))
    .filter(
      ({ question, index }) =>
        question.type._tag === "Rating" &&
        question.dimension === dimension &&
        roundMeetsN &&
        contributorsOf(built, index) >= n,
    );
  const ids = new Set(usable.map(({ question }) => question.id));
  const contributors = built.submissions.filter((submission) =>
    submission.answers.some((answer) => answer.value !== null && ids.has(answer.questionVersionId)),
  ).length;
  return { usable, contributors };
};

/**
 * Every point of the Team overview: a score must equal a fresh computation at the effective N and
 * stand behind at least N contributors. The Result is built as stored, then enforced (ADR 0004).
 */
const overviewViolations = (scenario: RoundResultScenario): ReadonlyArray<string> => {
  const built = buildResult({ ...scenario, status: "shared" });
  const overview = buildTeamOverview({
    teamId: TEAM,
    results: [built.stored],
    minimumGroupSize: scenario.organizationN,
    actions: [],
  });
  const n = built.effectiveN;
  const found: Array<string> = [];
  if (overview.rounds.length !== 1) found.push(`overview has ${overview.rounds.length} rounds, expected 1`);
  for (const line of overview.dimensions) {
    const label = `overview ${line.dimension}`;
    const fresh = built.direct.dimensions.find((each) => each.dimension === line.dimension);
    const { usable, contributors } = dimensionContributors(built, line.dimension, n);
    for (const point of line.points) {
      if (point.score === null) continue;
      if (fresh?.score !== point.score) {
        found.push(`${label} differs from the Result computed at N=${n}`);
      }
      if (usable.length === 0 || contributors < n) {
        found.push(`${label} shows a score from ${contributors} contributors (N=${n})`);
      }
    }
  }
  return found;
};

/** Whether each Lead-only field of a Result is present, for a member's view (ADR 0004, 0016, 0019). */
const leadOnlyLeaks: { readonly [F in LeadOnlyField]: (result: RoundResult) => boolean } = {
  comments: (result) => result.comments.length > 0,
  "themes.supportingComments": (result) =>
    (result.themes ?? []).some((theme) => Object.hasOwn(theme, "supportingComments")),
  discussionGuide: (result) => Object.hasOwn(result, "discussionGuide"),
};

/**
 * Every way the Result shows an aggregate that fewer than the effective N contributors stand behind,
 * and every Lead-only field a member's view carries (`leadOnly` is the endpoint's registry entry).
 */
const violations = (
  scenario: RoundResultScenario,
  built: Built,
  leadOnly: ReadonlyArray<LeadOnlyField>,
): ReadonlyArray<string> => {
  const { result, direct, effectiveN: n } = built;
  const found: Array<string> = [];
  const open = scenario.status === "open";
  const roundMeetsN = !open && result.submissionsCount >= n;
  if (result.submissionsCount !== scenario.submissions.length) found.push("submissionsCount differs");

  if (!roundMeetsN && result.comments.length > 0) found.push("comments shown below N");
  if (roundMeetsN) {
    const raw = built.submissions
      .flatMap((submission) => submission.answers)
      .filter((a) => a.comment?.trim());
    if (result.comments.length > raw.length) found.push("more comments than the Submissions carry");
  }

  // ADR 0016: Comment themes are shown only to a Round that meets N, and only with two supporters.
  if (!roundMeetsN && (result.themes ?? []).length > 0) found.push("Comment themes shown below N");
  if (!roundMeetsN && result.discussionGuide != null) found.push("discussion guide shown below N");
  if (
    (result.themes ?? []).some(
      (theme) => theme.supportingComments !== undefined && theme.supportingComments < 2,
    )
  ) {
    found.push("theme with fewer than 2 supporting comments");
  }
  // The Review window (issue 106): a member sees no Result data until the Round is Shared.
  if (scenario.viewer === "member" && (scenario.status === "closed" || scenario.status === "ready")) {
    const shown =
      result.questions.length > 0 ||
      result.dimensions.length > 0 ||
      result.comments.length > 0 ||
      (result.themes ?? []).length > 0 ||
      Object.hasOwn(result, "discussionGuide");
    if (shown) found.push("Result data shown to a member before Shared");
  }
  if (scenario.viewer === "member") {
    for (const field of leadOnly) {
      if (leadOnlyLeaks[field](result)) found.push(`${field} shown to a member`);
    }
  }

  const visibleScore = new Map<string, number>();
  result.questions.forEach((question, index) => {
    const label = `question ${index}`;
    const expected = contributorsOf(built, index);
    const shown = question.score !== null || question.distribution !== null;
    if (shown && !(roundMeetsN && expected >= n)) {
      found.push(`${label} shows an aggregate from ${expected} contributors (N=${n})`);
    }
    if (!shown && (question.change !== null || question.typicalChange !== null)) {
      found.push(`${label} shows a change or typical change without a visible score`);
    }
    if (question.score !== null) visibleScore.set(question.questionVersionId, question.score);
    for (const point of question.trend) {
      if (point.score !== null && point.contributors < n) {
        found.push(
          `${label} trend point ${point.roundId} shows a score from ${point.contributors} contributors`,
        );
      }
      if (point.roundId === ROUND && point.score !== null && !shown) {
        found.push(`${label} current trend point shows a score the Question hides`);
      }
    }
    // Never more than a fresh computation at the effective N would show, and never different.
    const fresh = direct.questions[index];
    if (
      shown &&
      (question.score !== fresh?.score ||
        !Object.is(JSON.stringify(question.distribution), JSON.stringify(fresh?.distribution)))
    ) {
      found.push(`${label} differs from the Result computed at N=${n}`);
    }
    if (question.change !== null && JSON.stringify(question.change) !== JSON.stringify(fresh?.change)) {
      found.push(`${label} change differs from the Result computed at N=${n}`);
    }
    if (
      question.typicalChange !== null &&
      JSON.stringify(question.typicalChange) !== JSON.stringify(fresh?.typicalChange)
    ) {
      found.push(`${label} typical change differs from the Result computed at N=${n}`);
    }
    question.trend.forEach((point, p) => {
      const freshPoint = fresh?.trend[p];
      if (point.score !== null && point.score !== freshPoint?.score) {
        found.push(`${label} trend point ${point.roundId} differs from the Result computed at N=${n}`);
      }
    });
  });

  result.dimensions.forEach((dimension) => {
    const label = `dimension ${dimension.dimension}`;
    const { usable, contributors } = dimensionContributors(built, dimension.dimension, n);
    if (dimension.score === null) {
      if (dimension.contributors !== undefined && dimension.contributors !== null) {
        found.push(`${label} shows contributors without a score`);
      }
      if (dimension.change !== null || dimension.typicalChange !== null) {
        found.push(`${label} shows a change or typical change without a score`);
      }
    } else {
      if (usable.length === 0 || contributors < n) {
        found.push(`${label} shows a score from ${contributors} contributors (N=${n})`);
      }
      const scores = usable.map(({ question }) => visibleScore.get(question.id));
      if (scores.some((score) => score === undefined)) {
        found.push(`${label} is computed from a Question that is hidden`);
      } else {
        const mean = roundDecimals(
          scores.reduce<number>((sum, score) => sum + (score ?? 0), 0) / scores.length,
          2,
        );
        if (mean !== dimension.score)
          found.push(`${label} score ${dimension.score} is not the mean of the visible Questions ${mean}`);
      }
      if (
        dimension.contributors !== undefined &&
        dimension.contributors !== null &&
        dimension.contributors < n
      ) {
        found.push(`${label} reports ${dimension.contributors} contributors (N=${n})`);
      }
    }
    for (const point of dimension.trend) {
      if (point.score !== null && (point.contributors === undefined || point.contributors < n)) {
        found.push(
          `${label} trend point ${point.roundId} shows a score from ${point.contributors ?? "unknown"} contributors`,
        );
      }
    }
    const fresh = direct.dimensions.find((each) => each.dimension === dimension.dimension);
    if (dimension.score !== null && dimension.score !== fresh?.score) {
      found.push(`${label} differs from the Result computed at N=${n}`);
    }
    if (
      dimension.typicalChange !== null &&
      JSON.stringify(dimension.typicalChange) !== JSON.stringify(fresh?.typicalChange)
    ) {
      found.push(`${label} typical change differs from the Result computed at N=${n}`);
    }
    if (dimension.change !== null && JSON.stringify(dimension.change) !== JSON.stringify(fresh?.change)) {
      found.push(`${label} change differs from the Result computed at N=${n}`);
    }
  });
  return found;
};

/**
 * The member's history of one Round: a Team score shows only when the Round is shown and the Question
 * has at least N contributors, and it equals a fresh computation at the effective N (ADR 0004, ADR 0017).
 */
const historyViolations = (scenario: RoundResultScenario): ReadonlyArray<string> => {
  const built = buildResult({ ...scenario, status: "shared" });
  const history = buildMemberHistory({
    rounds: [
      {
        roundId: ROUND,
        teamId: TEAM,
        teamName: "T",
        pulseName: "P",
        plannedOpenDate: built.stored.plannedOpenDate,
        status: "shared",
        questions: built.questions,
        result: built.stored,
        canViewResults: true,
      },
    ],
    minimumGroupSize: scenario.organizationN,
  });
  const n = built.effectiveN;
  const found: Array<string> = [];
  for (const round of history.rounds) {
    if (round.teamResult === "shown" && built.result.submissionsCount < n) {
      found.push(`history shows the Round with ${built.result.submissionsCount} Submissions (N=${n})`);
    }
    for (const question of round.questions) {
      if (question.teamScore === null) continue;
      const index = built.questions.findIndex((each) => each.id === question.questionVersionId);
      if (
        round.teamResult !== "shown" ||
        built.result.submissionsCount < n ||
        contributorsOf(built, index) < n
      ) {
        found.push(`history shows a score for question ${index} from fewer than N=${n} contributors`);
      }
      if (question.teamScore !== built.direct.questions[index]?.score) {
        found.push(`history score for question ${index} differs from the Result computed at N=${n}`);
      }
    }
  }
  return found;
};

describe("member history endpoint (ADR 0017)", () => {
  it("takes no input: a GET with no path parameter, payload, params, query, or headers", () => {
    const endpoints: Array<HttpApiEndpoint.Top> = [];
    HttpApi.reflect(SurveyBeatApi, {
      onGroup: () => {},
      onEndpoint: ({ group, endpoint }) => {
        if (group.identifier === "rounds" && endpoint.identifier === "getMyHistory") endpoints.push(endpoint);
      },
    });
    assert.strictEqual(endpoints.length, 1);
    const [endpoint] = endpoints;
    assert.strictEqual(endpoint?.method, "GET");
    assert.strictEqual(endpoint?.path, "/api/me/history");
    assert.notInclude(endpoint?.path ?? "", ":");
    assert.strictEqual(endpoint?.params, undefined);
    assert.strictEqual(endpoint?.query, undefined);
    assert.strictEqual(endpoint?.headers, undefined);
    assert.strictEqual(endpoint?.payload.size, 0);
  });

  it("returns no Submission, answer, comment, contributor, distribution, or Person field", () => {
    const skipped = { answered: false, value: 0, comment: null } as const;
    const answered = (value: number, comment: "Ask Anna" | null) =>
      ({ answered: true, value, comment }) as const;
    const row = (
      first: typeof skipped | ReturnType<typeof answered>,
      second: typeof skipped | ReturnType<typeof answered>,
    ) => [first, second, skipped, skipped, skipped] as const;
    const scenario: RoundResultScenario = {
      status: "shared",
      storedN: 2,
      organizationN: 2,
      eligibleMembers: 10,
      questions: [
        { kind: "rating", dimension: "workload" },
        { kind: "text", dimension: null },
      ],
      submissions: [
        row(answered(3, null), answered(0, "Ask Anna")),
        row(answered(4, null), answered(0, "Ask Anna")),
        row(answered(2, null), skipped),
        row(answered(3, null), skipped),
      ],
      history: [],
      viewer: "member",
      themes: "ready",
    };
    const built = buildResult(scenario);
    const history = buildMemberHistory({
      rounds: [
        {
          roundId: ROUND,
          teamId: TEAM,
          teamName: "T",
          pulseName: "P",
          plannedOpenDate: built.stored.plannedOpenDate,
          status: "shared",
          questions: built.questions,
          result: built.stored,
          canViewResults: true,
        },
      ],
      minimumGroupSize: scenario.organizationN,
    });
    const json: unknown = Schema.encodeSync(MemberHistory)(history);
    const keys = keysOf(json);
    const forbidden = keys.filter((key) =>
      /submission|editkey|person|contributor|distribution|comments|answers|value|theme|guide/i.test(key),
    );
    assert.deepStrictEqual(forbidden, []);
    assert.include(keys, "teamScore");
    assert.isTrue(history.rounds[0]?.teamResult === "shown", "the shared Round with N answers is shown");
  });
});

/** Every object key in a JSON value, at any depth. */
const keysOf = (value: unknown): ReadonlyArray<string> => {
  if (Array.isArray(value)) return value.flatMap((item: unknown) => keysOf(item));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]: [string, unknown]) => [key, ...keysOf(child)]);
  }
  return [];
};
