import { SurveyBeatApi } from "@surveybeat/api";
import { Effect, Predicate } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

const client = HttpApiClient.make(SurveyBeatApi, { baseUrl: window.location.origin });
export type Client = Effect.Success<typeof client>;

/** Why a directory call failed, as the screens explain it. */
export type Failure =
  | "Unauthenticated"
  | "Forbidden"
  | "NotFound"
  | "LastLead"
  | "LastAdmin"
  | "TeamNameTaken"
  | "QuestionAlreadyInPulse"
  | "QuestionHasAnswers"
  | "PulseNeedsAQuestion"
  | "PulseFull"
  | "OrderMismatch"
  | "Invalid"
  | "Unavailable";

export type Outcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly failure: Failure };

const failureOf = (error: unknown): Failure => {
  if (Predicate.isTagged(error, "Unauthenticated")) return "Unauthenticated";
  if (Predicate.isTagged(error, "Forbidden")) return "Forbidden";
  if (
    Predicate.isTagged(error, "TeamNotFound") ||
    Predicate.isTagged(error, "PersonNotFound") ||
    Predicate.isTagged(error, "PulseNotFound") ||
    Predicate.isTagged(error, "QuestionNotFound")
  )
    return "NotFound";
  if (Predicate.isTagged(error, "LastLead")) return "LastLead";
  if (Predicate.isTagged(error, "LastAdmin")) return "LastAdmin";
  if (Predicate.isTagged(error, "TeamNameTaken")) return "TeamNameTaken";
  for (const tag of [
    "QuestionAlreadyInPulse",
    "QuestionHasAnswers",
    "PulseNeedsAQuestion",
    "PulseFull",
    "OrderMismatch",
  ] as const) {
    if (Predicate.isTagged(error, tag)) return tag;
  }
  if (Predicate.isTagged(error, "HttpApiSchemaError") || Predicate.isTagged(error, "SchemaError"))
    return "Invalid";
  return "Unavailable";
};

/** Runs one API call and reports its outcome; it never rejects. */
const run = <A, E>(f: (api: Client) => Effect.Effect<A, E>): Promise<Outcome<A>> =>
  Effect.runPromise(
    client.pipe(
      Effect.flatMap(f),
      Effect.map((value): Outcome<A> => ({ ok: true, value })),
      Effect.catch((error: unknown) => Effect.succeed<Outcome<A>>({ ok: false, failure: failureOf(error) })),
      Effect.provide(FetchHttpClient.layer),
    ),
  );

/** One call of the `directory` group. */
export const call = <A, E>(f: (api: Client["directory"]) => Effect.Effect<A, E>): Promise<Outcome<A>> =>
  run((api) => f(api.directory));

/** One call of the `pulses` group. */
export const callPulses = <A, E>(f: (api: Client["pulses"]) => Effect.Effect<A, E>): Promise<Outcome<A>> =>
  run((api) => f(api.pulses));
