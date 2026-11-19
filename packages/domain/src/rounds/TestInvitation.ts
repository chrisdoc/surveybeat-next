import { redact } from "../privacy/Redaction.ts";
import type { Roster } from "../privacy/Redaction.ts";
import type { PulseId } from "../pulses/Pulse.ts";
import type { QuestionType, QuestionVersionId } from "../pulses/Question.ts";
import { RoundId } from "./Round.ts";
import type { SubmissionAnswer, SubmissionRoundContext } from "./Submission.ts";

export const testSubmissionContext = (input: {
  readonly pulseName: string;
  readonly minimumGroupSize: number;
  readonly pulseId: PulseId;
  readonly questions: readonly {
    readonly id: QuestionVersionId;
    readonly text: string;
    readonly type: QuestionType;
  }[];
  readonly actions: readonly { readonly id: string; readonly title: string }[];
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

export const previewAnswers = (
  answers: readonly SubmissionAnswer[],
  roster: Roster,
): { readonly shownToLead: string | null } => {
  let shownToLead: string | null = null;

  for (const answer of answers) {
    const redacted = answer.comment ? redact(answer.comment, roster) : null;

    if (redacted !== null) {
      shownToLead = redacted;
    }
  }

  return { shownToLead };
};
