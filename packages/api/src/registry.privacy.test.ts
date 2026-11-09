import { assert, describe, it } from "@effect/vitest";
import {
  calculateRoundResult,
  enforceEffectiveNOnResult,
  type HistoricalRoundData,
  PulseId,
  type QuestionInput,
  QuestionVersionId,
  RoundId,
  type RoundResult,
  roundDecimals,
  type SubmissionAnswer,
  TeamId,
} from "@surveybeat/domain";
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import { HttpApi } from "effect/http-api";
import * as Schema from "effect/Schema";
import { SurveyBeatApi } from "./index.ts";
import { privacyRegistry, RoundResultScenario } from "./PrivacyRegistry.ts";

/** Every endpoint of the runtime declaration, as `group.endpoint`. */
const declaredEndpoints = (): ReadonlyArray<string> => {
  const keys: Array<string> = [];
  HttpApi.reflect(SurveyBeatApi, {
    onGroup: () => {},
    onEndpoint: ({ group, endpoint }) => keys.push(`${group.identifier}.${endpoint.identifier}`),
  });
  return keys;
};

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

    // Property test over the registry's own generator: whatever Round the generator produces, the
    // endpoint's Result shows no aggregate computed from fewer than the effective N contributors.
    it.effect(`${key}: no aggregate below the effective N for any generated Round (ADR 0004)`, () =>
      Effect.gen(function* () {
        assert.isDefined(respond, `no Result check registered for ${key}`);
        const check = yield* Arbitrary.checkEffect(
          entry.inputs,
          (input) =>
            Effect.suspend(() => {
              const scenario = Schema.decodeUnknownSync(RoundResultScenario)(input);
              const failures = violations(scenario, respond(scenario));
              return failures.length > 0 ? Effect.fail(failures.join("; ")) : Effect.succeed(true);
            }),
          { runs: 500, seed: 20261109 },
        );
        assert.strictEqual(Arbitrary.formatCheckFailure(check), undefined);
        assert.strictEqual(check._tag, "Passed");
      }),
    );
  }
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
  /** The same Round computed from scratch at the effective N: the most that may ever be shown. */
  readonly direct: RoundResult;
}

const DIMENSIONS = ["workload", "psychologicalSafety", "clarity", "recognition"] as const;
const ROUND = RoundId.make("round-now");
const PULSE = PulseId.make("pulse-1");
const TEAM = TeamId.make("team-1");
const OPTIONS = ["Red", "Green", "Blue"];

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
      closedAt: scenario.status === "open" ? null : 1_731_140_000_000,
      effectiveMinimumGroupSize,
      eligibleMembersCount: scenario.eligibleMembers,
      questions,
      submissions,
      pastRoundsHistory: history,
    });
  return {
    effectiveN,
    questions,
    submissions,
    // What `Organization.viewResults` returns: the Result stored under the Round's own N, then the
    // current Organization N applied on read (Rule R9).
    result: enforceEffectiveNOnResult(compute(scenario.storedN), scenario.organizationN),
    direct: compute(effectiveN),
  };
};

const resultResponders: Record<string, (scenario: RoundResultScenario) => Built> = {
  "rounds.getResults": buildResult,
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

/** Every way the Result shows an aggregate that fewer than the effective N contributors stand behind. */
const violations = (scenario: RoundResultScenario, built: Built): ReadonlyArray<string> => {
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
    const usable = built.questions
      .map((question, index) => ({ question, index }))
      .filter(
        ({ question, index }) =>
          question.type._tag === "Rating" &&
          question.dimension === dimension.dimension &&
          roundMeetsN &&
          contributorsOf(built, index) >= n,
      );
    if (dimension.score === null) {
      if (dimension.contributors !== undefined && dimension.contributors !== null) {
        found.push(`${label} shows contributors without a score`);
      }
      if (dimension.change !== null || dimension.typicalChange !== null) {
        found.push(`${label} shows a change or typical change without a score`);
      }
    } else {
      const ids = new Set(usable.map(({ question }) => question.id));
      const contributors = built.submissions.filter((submission) =>
        submission.answers.some((answer) => answer.value !== null && ids.has(answer.questionVersionId)),
      ).length;
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
