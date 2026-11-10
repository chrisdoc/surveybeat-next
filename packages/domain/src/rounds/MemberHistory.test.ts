import { assert, describe, it } from "@effect/vitest";
import { TeamId } from "../people/Team.ts";
import { PulseId } from "../pulses/Pulse.ts";
import { QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import { buildMemberHistory, type MemberHistoryRoundInput } from "./MemberHistory.ts";
import { calculateRoundResult, type QuestionInput, type RoundResult } from "./Results.ts";
import { RoundId, type RoundStatus } from "./Round.ts";
import type { SubmissionAnswer } from "./Submission.ts";

const TEAM = TeamId.make("team-1");
const PULSE = PulseId.make("pulse-1");
const Q1 = QuestionVersionId.make("q-1.1");
const Q2 = QuestionVersionId.make("q-2.1");

const ratingType: QuestionType = { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: false };
const choiceType: QuestionType = { _tag: "SingleChoice", options: ["A", "B"] };

const WORKLOAD: QuestionInput = {
  id: Q1,
  position: 0,
  text: "Workload",
  type: ratingType,
  dimension: "workload",
};
const CLARITY: QuestionInput = {
  id: Q2,
  position: 1,
  text: "Clarity",
  type: ratingType,
  dimension: "clarity",
};
const BOTH: ReadonlyArray<QuestionInput> = [WORKLOAD, CLARITY];

/** Submissions that answer every given Question with the same value. */
const submissions = (
  count: number,
  questionIds: ReadonlyArray<QuestionVersionId>,
  value = 4,
): Array<{ id: string; answers: Array<SubmissionAnswer> }> =>
  Array.from({ length: count }, (_, i) => ({
    id: `sub-${i}`,
    answers: questionIds.map((questionVersionId) => ({ questionVersionId, value, comment: null })),
  }));

const computeResult = (params: {
  readonly roundId: string;
  readonly storedN: number;
  readonly submissions: ReadonlyArray<{ id: string; answers: ReadonlyArray<SubmissionAnswer> }>;
  readonly status?: RoundStatus;
  readonly questions?: ReadonlyArray<QuestionInput>;
}): RoundResult =>
  calculateRoundResult({
    roundId: RoundId.make(params.roundId),
    pulseId: PULSE,
    teamId: TEAM,
    status: params.status ?? "shared",
    plannedOpenDate: "2026-11-02",
    anonymityMode: "anonymous",
    closedAt: 1_731_000_000_000,
    effectiveMinimumGroupSize: params.storedN,
    eligibleMembersCount: 20,
    questions: params.questions ?? BOTH,
    submissions: params.submissions,
    pastRoundsHistory: [],
  });

const ROUND = RoundId.make("round-1");

const roundInput = (overrides: Partial<MemberHistoryRoundInput> = {}): MemberHistoryRoundInput => ({
  roundId: ROUND,
  teamId: TEAM,
  teamName: "Team",
  pulseName: "Pulse",
  plannedOpenDate: "2026-11-02",
  status: "shared",
  questions: BOTH,
  result: computeResult({ roundId: "round-1", storedN: 2, submissions: submissions(4, [Q1, Q2]) }),
  canViewResults: true,
  ...overrides,
});

const build = (rounds: ReadonlyArray<MemberHistoryRoundInput>, minimumGroupSize = 2) =>
  buildMemberHistory({ rounds, minimumGroupSize });

describe("buildMemberHistory", () => {
  it("shows the Team's score for each Rating Question of a shared Round that meets N", () => {
    const [round] = build([roundInput()]).rounds;
    assert.strictEqual(round?.teamResult, "shown");
    assert.deepStrictEqual(
      round?.questions.map((question) => [question.questionVersionId, question.teamScore]),
      [
        [Q1, 4],
        [Q2, 4],
      ],
    );
  });

  it("shows nothing when the Round is not shared, even if its stored Result is", () => {
    const [round] = build([roundInput({ status: "closed" })]).rounds;
    assert.strictEqual(round?.teamResult, "notShared");
    assert.deepStrictEqual(
      round?.questions.map((question) => question.teamScore),
      [null, null],
    );
  });

  it("shows nothing when the caller may not view the Team's Results", () => {
    const [round] = build([roundInput({ canViewResults: false })]).rounds;
    assert.strictEqual(round?.teamResult, "notShared");
    assert.deepStrictEqual(
      round?.questions.map((question) => question.teamScore),
      [null, null],
    );
  });

  it("shows nothing when the shared Round has no stored Result", () => {
    const [round] = build([roundInput({ result: null })]).rounds;
    assert.strictEqual(round?.teamResult, "notShared");
  });

  it("marks a Round below N as belowMinimumGroupSize with no scores", () => {
    const below = computeResult({ roundId: "round-1", storedN: 2, submissions: submissions(1, [Q1, Q2]) });
    const [round] = build([roundInput({ result: below })]).rounds;
    assert.strictEqual(round?.teamResult, "belowMinimumGroupSize");
    assert.deepStrictEqual(
      round?.questions.map((question) => question.teamScore),
      [null, null],
    );
  });

  it("hides a Question below N while the other Questions are shown", () => {
    const result = computeResult({
      roundId: "round-1",
      storedN: 2,
      submissions: [
        { id: "sub-0", answers: [{ questionVersionId: Q1, value: 4, comment: null }] },
        { id: "sub-1", answers: [{ questionVersionId: Q1, value: 4, comment: null }] },
        { id: "sub-2", answers: [{ questionVersionId: Q1, value: 4, comment: null }] },
        {
          id: "sub-3",
          answers: [
            { questionVersionId: Q1, value: 4, comment: null },
            { questionVersionId: Q2, value: 2, comment: null },
          ],
        },
      ],
    });
    const [round] = build([roundInput({ result })]).rounds;
    assert.strictEqual(round?.teamResult, "shown");
    assert.deepStrictEqual(
      round?.questions.map((question) => [question.questionVersionId, question.teamScore]),
      [
        [Q1, 4],
        [Q2, null],
      ],
    );
  });

  it("shows no score for a Question that is not a Rating", () => {
    const choice: QuestionInput = {
      id: Q2,
      position: 1,
      text: "Pick one",
      type: choiceType,
      dimension: null,
    };
    const result = computeResult({
      roundId: "round-1",
      storedN: 2,
      questions: [WORKLOAD, choice],
      submissions: Array.from({ length: 4 }, (_, i) => ({
        id: `sub-${i}`,
        answers: [
          { questionVersionId: Q1, value: 4, comment: null },
          { questionVersionId: Q2, value: 1, comment: null },
        ],
      })),
    });
    const [round] = build([roundInput({ questions: [WORKLOAD, choice], result })]).rounds;
    assert.strictEqual(round?.teamResult, "shown");
    assert.deepStrictEqual(
      round?.questions.map((question) => [question.questionVersionId, question.teamScore]),
      [
        [Q1, 4],
        [Q2, null],
      ],
    );
  });

  it("hides a shown Round when the Organization's N is raised above the stored N", () => {
    const [round] = build([roundInput()], 5).rounds;
    assert.strictEqual(round?.teamResult, "belowMinimumGroupSize");
    assert.deepStrictEqual(
      round?.questions.map((question) => question.teamScore),
      [null, null],
    );
  });

  it("returns the Questions in position order", () => {
    const [round] = build([roundInput({ questions: [CLARITY, WORKLOAD] })]).rounds;
    assert.deepStrictEqual(
      round?.questions.map((question) => question.position),
      [0, 1],
    );
  });

  it("lists the Rounds newest first, ties broken by Round id descending", () => {
    const older = roundInput({ roundId: RoundId.make("round-c"), plannedOpenDate: "2026-10-26" });
    const newerA = roundInput({ roundId: RoundId.make("round-a"), plannedOpenDate: "2026-11-02" });
    const newerB = roundInput({ roundId: RoundId.make("round-b"), plannedOpenDate: "2026-11-02" });
    const history = build([older, newerA, newerB]);
    assert.deepStrictEqual(
      history.rounds.map((round) => `${round.plannedOpenDate} ${round.roundId}`),
      ["2026-11-02 round-b", "2026-11-02 round-a", "2026-10-26 round-c"],
    );
  });

  it("returns no Rounds for a Person with no Participation", () => {
    assert.deepStrictEqual(build([]), { rounds: [] });
  });
});
