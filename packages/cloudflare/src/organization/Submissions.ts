import {
  PersonId,
  previewAnswers,
  PulseId,
  RoundId,
  type SubmissionAnswer,
  testSubmissionContext,
} from "@surveybeat/domain";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type { makeSqlActions } from "../SqlActions.ts";
import type { makeSqlDirectory } from "../SqlDirectory.ts";
import type { makeSqlPulses } from "../SqlPulses.ts";
import type { makeSqlRounds } from "../SqlRounds.ts";

export const organizationSubmissions = ({
  rounds,
  directory,
  pulses,
  actions,
}: {
  rounds: ReturnType<typeof makeSqlRounds>;
  directory: ReturnType<typeof makeSqlDirectory>;
  pulses: ReturnType<typeof makeSqlPulses>;
  actions: ReturnType<typeof makeSqlActions>;
}) => {
  const both = Effect.all([directory.load, pulses.load]);

  return {
    getSubmissionRoundContext: (roundId: string, personId: string | null) =>
      Effect.gen(function* () {
        const dirState = yield* directory.load;
        return yield* rounds.getSubmissionRoundContext(
          RoundId.make(roundId),
          personId === null ? null : PersonId.make(personId),
          dirState.minimumGroupSize,
        );
      }),
    /**
     * The answer page's context for a test Invitation (ADR 0021). Read-only: no Round, no Submission,
     * and no Invitation row. Built from the Pulse's saved Questions and settings; `null` when the Pulse
     * is gone or has no Questions.
     */
    getTestSubmissionContext: (pulseId: string, expiresAt: number) =>
      Effect.gen(function* () {
        const [dirState, pulseState] = yield* both;
        const pulse = pulseState.pulses.find((p) => p.id === PulseId.make(pulseId));
        if (pulse === undefined || pulse.questions.length === 0) return null;
        const questions = pulse.questions.flatMap((versionId) => {
          const version = pulseState.versions.find((v) => v.id === versionId);
          return version === undefined
            ? []
            : [{ id: versionId, text: version.content.text, type: version.content.type }];
        });
        const now = yield* Clock.currentTimeMillis;
        const eligibleActions = yield* actions.getEligibleActionsForRound(pulse.teamId, pulse.id, now);
        return testSubmissionContext({
          pulseName: pulse.settings.name,
          minimumGroupSize: dirState.minimumGroupSize,
          pulseId: pulse.id,
          questions,
          actions: eligibleActions.map((action) => ({ id: action.id, title: action.title })),
          expiresAt,
          aiProcessing: dirState.aiProcessing,
        });
      }),
    /** What the Lead would be shown for test answers: redacted as the real path does, and written nowhere (ADR 0021). */
    previewTestAnswers: (answers: ReadonlyArray<SubmissionAnswer>) =>
      directory.load.pipe(Effect.map((dirState) => previewAnswers(answers, dirState.people))),
    recordFirstAnswer: (
      roundId: string,
      personId: string,
      editKeyHash: string,
      answers: ReadonlyArray<SubmissionAnswer>,
    ) =>
      Effect.gen(function* () {
        const dirState = yield* directory.load;
        return yield* rounds
          .recordFirstAnswer(
            RoundId.make(roundId),
            PersonId.make(personId),
            editKeyHash,
            answers,
            dirState.people,
          )
          .pipe(
            Effect.map((res) => ({ _tag: "Success" as const, ...res })),
            Effect.catchTags({
              AlreadyAnswered: () => Effect.succeed({ _tag: "AlreadyAnswered" as const }),
              RoundNotOpen: () => Effect.succeed({ _tag: "RoundNotOpen" as const }),
            }),
          );
      }),
    saveAnswer: (editKeyHash: string, answers: ReadonlyArray<SubmissionAnswer>) =>
      Effect.gen(function* () {
        const dirState = yield* directory.load;
        return yield* rounds.saveAnswer(editKeyHash, answers, dirState.people).pipe(
          Effect.map((res) => ({ _tag: "Success" as const, ...res })),
          Effect.catchTags({
            SubmissionNotFound: () => Effect.succeed({ _tag: "SubmissionNotFound" as const }),
            RoundNotOpen: () => Effect.succeed({ _tag: "RoundNotOpen" as const }),
          }),
        );
      }),
    deleteParticipationForPerson: (personId: string) =>
      rounds.deleteParticipationForPerson(PersonId.make(personId)),
  };
};
