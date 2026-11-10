import { SurveyBeatApi } from "@surveybeat/api";
import { Effect, Predicate, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { message } from "../messages/locale.ts";

export const Failure = Schema.Literals([
  "Unauthenticated",
  "Forbidden",
  "NotFound",
  "LastLead",
  "LastAdmin",
  "TeamNameTaken",
  "QuestionAlreadyInPulse",
  "QuestionHasAnswers",
  "PulseNeedsAQuestion",
  "PulseFull",
  "OrderMismatch",
  "TestSendLimitReached",
  "Invalid",
  "Unavailable",
]);
export type Failure = typeof Failure.Type;

export const failureMessage = (failure: Failure): string => {
  switch (failure) {
    case "Unauthenticated":
      return message("error.Unauthenticated");
    case "Forbidden":
      return message("error.Forbidden");
    case "NotFound":
      return message("error.NotFound");
    case "LastLead":
      return message("error.LastLead");
    case "LastAdmin":
      return message("error.LastAdmin");
    case "TeamNameTaken":
      return message("error.TeamNameTaken");
    case "QuestionAlreadyInPulse":
      return message("error.QuestionAlreadyInPulse");
    case "QuestionHasAnswers":
      return message("error.QuestionHasAnswers");
    case "PulseNeedsAQuestion":
      return message("error.PulseNeedsAQuestion");
    case "PulseFull":
      return message("error.PulseFull");
    case "OrderMismatch":
      return message("error.OrderMismatch");
    case "TestSendLimitReached":
      return message("error.TestSendLimitReached");
    case "Invalid":
      return message("error.Invalid");
    case "Unavailable":
      return message("error.Unavailable");
  }
};

export const failureOf = (error: unknown): Failure => {
  if (Predicate.isTagged(error, "Unauthenticated")) return "Unauthenticated";
  if (Predicate.isTagged(error, "Forbidden")) return "Forbidden";
  if (
    Predicate.isTagged(error, "TeamNotFound") ||
    Predicate.isTagged(error, "PersonNotFound") ||
    Predicate.isTagged(error, "PulseNotFound") ||
    Predicate.isTagged(error, "QuestionNotFound") ||
    Predicate.isTagged(error, "RoundNotFound") ||
    Predicate.isTagged(error, "ActionNotFound") ||
    Predicate.isTagged(error, "ResultsNotReady")
  )
    return "NotFound";
  if (Predicate.isTagged(error, "OwnerNotInTeam")) return "Invalid";
  if (Predicate.isTagged(error, "LastLead")) return "LastLead";
  if (Predicate.isTagged(error, "LastAdmin")) return "LastAdmin";
  if (Predicate.isTagged(error, "TeamNameTaken")) return "TeamNameTaken";
  for (const tag of [
    "QuestionAlreadyInPulse",
    "QuestionHasAnswers",
    "PulseNeedsAQuestion",
    "PulseFull",
    "OrderMismatch",
    "TestSendLimitReached",
  ] as const) {
    if (Predicate.isTagged(error, tag)) return tag;
  }
  if (Predicate.isTagged(error, "HttpApiSchemaError") || Predicate.isTagged(error, "SchemaError"))
    return "Invalid";
  return "Unavailable";
};

export const clientEffect = HttpApiClient.make(SurveyBeatApi, {
  baseUrl: typeof window !== "undefined" ? window.location.origin : "http://localhost",
});
export type ApiClient = Effect.Success<typeof clientEffect>;

export const runApi = <A, M>(
  f: (api: ApiClient) => Effect.Effect<A, unknown>,
  onSuccess: (value: A) => M,
  onFailure: (failure: Failure) => M,
): Effect.Effect<M> =>
  clientEffect.pipe(
    Effect.flatMap(f),
    Effect.map(onSuccess),
    Effect.catch((error: unknown) => Effect.succeed(onFailure(failureOf(error)))),
    Effect.provide(FetchHttpClient.layer),
  );
