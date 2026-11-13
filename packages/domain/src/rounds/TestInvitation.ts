import { redact, type Roster } from "../privacy/Redaction.ts";
import type { PulseId } from "../pulses/Pulse.ts";
import type { QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import { RoundId } from "./Round.ts";
import type { SubmissionAnswer, SubmissionRoundContext } from "./Submission.ts";

/**
 * The answer page's context for a test Invitation (ADR 0021). It has no Round: the Pulse stands in
 * for it, `hasAnswered` is always false, and the expiry is the close time. Only the Organization
 * builds it, from the Pulse's saved Questions and settings.
 */
export const testSubmissionContext = (input: {
  readonly pulseName: string;
  readonly minimumGroupSize: number;
  readonly pulseId: PulseId;
  readonly questions: ReadonlyArray<{
    readonly id: QuestionVersionId;
    readonly text: string;
    readonly type: QuestionType;
  }>;
  readonly actions: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly expiresAt: number;
  readonly aiProcessing: boolean;
}): SubmissionRoundContext => ({
  roundId: RoundId.make(`test-${input.pulseId}`),
  pulseName: input.pulseName,
  minimumGroupSize: input.minimumGroupSize,
  questions: input.questions.map((question, position) => ({
    id: question.id,
    position,
    text: question.text,
    type: question.type,
  })),
  actions: input.actions.slice(0, 3),
  closeTime: input.expiresAt,
  state: "open",
  hasAnswered: false,
  aiProcessing: input.aiProcessing,
  test: true,
});

/**
 * What the Lead would be shown for a test answer (ADR 0021): the last comment that survives
 * redaction, as the real path shows it (`SqlRounds.recordFirstAnswer`). Writes nothing.
 */
export const previewAnswers = (
  answers: ReadonlyArray<SubmissionAnswer>,
  roster: Roster,
): { readonly shownToLead: string | null } => {
  let shownToLead: string | null = null;
  for (const answer of answers) {
    const redacted = answer.comment ? redact(answer.comment, roster) : null;
    if (redacted !== null) shownToLead = redacted;
  }
  return { shownToLead };
};
