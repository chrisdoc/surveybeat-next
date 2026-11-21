import type { DirectoryState, PulseId, PulseState, QuestionVersionId, TeamId } from "@surveybeat/domain";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const AttemptsPayload = Schema.Struct({ attempts: Schema.Int });

export const parseAttempts = (payload: string | null): number => {
  if (payload === null) {
    return 0;
  }

  try {
    const p: unknown = JSON.parse(payload);
    const decoded = Schema.decodeUnknownOption(AttemptsPayload)(p);

    return Option.match(decoded, {
      onNone: () => 0,
      onSome: (val) => val.attempts,
    });
  } catch {
    return 0;
  }
};

export const reviewEndsAtOf = (pulseState: PulseState, pulseId: PulseId, now: number) => {
  const pulse = pulseState.pulses.find((p) => p.id === pulseId);

  return now + (pulse?.settings.reviewWindowDays ?? 0) * 86_400_000;
};

export const firstRatingQuestionOf = (
  questionVersionIds: readonly QuestionVersionId[],
  pulseState: PulseState,
) => {
  const firstVersionId = questionVersionIds[0];

  const firstVersion =
    firstVersionId !== undefined ? pulseState.versions.find((v) => v.id === firstVersionId) : undefined;

  return firstVersion && firstVersion.content.type._tag === "Rating"
    ? {
        text: firstVersion.content.text,
        lowLabel: firstVersion.content.type.lowLabel,
        highLabel: firstVersion.content.type.highLabel,
      }
    : null;
};

const InvitationJobPayload = Schema.Struct({
  personId: Schema.String,
  token: Schema.optionalKey(Schema.String),
});

const decodeInvitationJobPayload = Schema.decodeUnknownOption(InvitationJobPayload);

const ResultsReadyJobPayload = Schema.Struct({
  kind: Schema.Literal("resultsReady"),
  personId: Schema.String,
  roundId: Schema.String,
});

const decodeResultsReadyJobPayload = Schema.decodeUnknownOption(ResultsReadyJobPayload);

export const parseJobPayload = (
  raw: string | null,
): { readonly personId: string; readonly token?: string } | null => {
  if (raw === null) {
    return null;
  }

  try {
    return Option.getOrNull(decodeInvitationJobPayload(JSON.parse(raw)));
  } catch {
    return null;
  }
};

export const parseSendPayload = (
  raw: string | null,
):
  | { readonly kind: "resultsReady"; readonly personId: string; readonly roundId: string }
  | { readonly personId: string; readonly token?: string }
  | null => {
  if (raw === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const rr = Option.getOrNull(decodeResultsReadyJobPayload(parsed));

    if (rr !== null) {
      return rr;
    }

    return Option.getOrNull(decodeInvitationJobPayload(parsed));
  } catch {
    return null;
  }
};

export const activePersonsWithRole = (dirState: DirectoryState, teamId: TeamId, role: "lead" | "member") =>
  dirState.memberships
    .filter((m) => m.teamId === teamId && m.endedAt === null && m.role === role)
    .map((m) => m.personId);
