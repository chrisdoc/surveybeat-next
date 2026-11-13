import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { PulseId } from "../pulses/Pulse.ts";
import { QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import { previewAnswers, testSubmissionContext } from "./TestInvitation.ts";
import { SubmissionRoundContext } from "./Submission.ts";

const PULSE = PulseId.make("pulse-1");
const ratingType: QuestionType = { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: true };
const EXPIRES_AT = 1_700_000_000_000 + 7 * 24 * 60 * 60 * 1000;

const questions = [1, 2, 3, 4].map((n) => ({
  id: QuestionVersionId.make(`q-${n}.1`),
  text: `Question ${n}`,
  type: ratingType,
}));

const actions = [1, 2, 3, 4, 5].map((n) => ({ id: `action-${n}`, title: `Action ${n}` }));

const context = (overrides: { readonly actions?: ReadonlyArray<{ id: string; title: string }> } = {}) =>
  testSubmissionContext({
    pulseName: "Weekly team health",
    minimumGroupSize: 4,
    pulseId: PULSE,
    questions,
    actions: overrides.actions ?? actions,
    expiresAt: EXPIRES_AT,
    aiProcessing: false,
  });

describe("testSubmissionContext (ADR 0021, issue #136)", () => {
  it("marks the context as a test with no Round to answer", () => {
    const built = context();
    assert.strictEqual(built.test, true);
    assert.strictEqual(built.hasAnswered, false);
    assert.strictEqual(built.state, "open");
    assert.strictEqual(built.closeTime, EXPIRES_AT);
    assert.strictEqual(built.roundId.startsWith("test-"), true);
    assert.strictEqual(built.roundId, `test-${PULSE}`);
  });

  it("numbers the Questions from 0 in the Pulse's order", () => {
    const built = context();
    assert.deepStrictEqual(
      built.questions.map((question) => question.position),
      [0, 1, 2, 3],
    );
    assert.deepStrictEqual(
      built.questions.map((question) => question.id),
      questions.map((question) => question.id),
    );
  });

  it("shows at most three Actions", () => {
    assert.deepStrictEqual(
      context().actions.map((action) => action.id),
      ["action-1", "action-2", "action-3"],
    );
    assert.deepStrictEqual(context({ actions: [] }).actions, []);
  });

  it("carries the Organization's aiProcessing and minimum group size", () => {
    const built = testSubmissionContext({
      pulseName: "Pulse",
      minimumGroupSize: 7,
      pulseId: PULSE,
      questions: [],
      actions: [],
      expiresAt: EXPIRES_AT,
      aiProcessing: true,
    });
    assert.strictEqual(built.minimumGroupSize, 7);
    assert.strictEqual(built.aiProcessing, true);
  });
});

describe("SubmissionRoundContext test flag", () => {
  const base = {
    roundId: "round-1",
    pulseName: "Pulse",
    minimumGroupSize: 4,
    questions: [],
    actions: [],
    closeTime: EXPIRES_AT,
    state: "open",
    hasAnswered: false,
    aiProcessing: false,
  };

  it("decodes a real context without the test flag", () => {
    const decoded = Schema.decodeUnknownSync(SubmissionRoundContext)(base);
    assert.strictEqual(decoded.test, undefined);
  });

  it("decodes a test context with the test flag set to true", () => {
    const decoded = Schema.decodeUnknownSync(SubmissionRoundContext)({ ...base, test: true });
    assert.strictEqual(decoded.test, true);
  });

  it("refuses a test flag that is not true", () => {
    assert.throws(() => Schema.decodeUnknownSync(SubmissionRoundContext)({ ...base, test: false }));
  });
});

describe("previewAnswers (ADR 0021, issue #136)", () => {
  const roster = [{ email: "grace@example.com" }];

  it("shows the Lead the last comment with the roster name redacted, as the real path does", () => {
    const preview = previewAnswers(
      [
        {
          questionVersionId: QuestionVersionId.make("q-1.1"),
          value: 4,
          comment: "Grace, the sprint was hard",
        },
      ],
      roster,
    );
    assert.isNotNull(preview.shownToLead);
    assert.notInclude(preview.shownToLead ?? "", "Grace");
    assert.include(preview.shownToLead ?? "", "[name]");
  });

  it("shows nothing when no answer has a comment", () => {
    const preview = previewAnswers(
      [
        { questionVersionId: QuestionVersionId.make("q-1.1"), value: 4, comment: null },
        { questionVersionId: QuestionVersionId.make("q-2.1"), value: 2, comment: null },
      ],
      roster,
    );
    assert.deepStrictEqual(preview, { shownToLead: null });
  });

  it("shows nothing for an empty list of answers", () => {
    assert.deepStrictEqual(previewAnswers([], roster), { shownToLead: null });
  });
});
