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
  | "Invalid"
  | "Unavailable";

export type Outcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly failure: Failure };

const failureOf = (error: unknown): Failure => {
  if (Predicate.isTagged(error, "Unauthenticated")) return "Unauthenticated";
  if (Predicate.isTagged(error, "Forbidden")) return "Forbidden";
  if (Predicate.isTagged(error, "TeamNotFound") || Predicate.isTagged(error, "PersonNotFound"))
    return "NotFound";
  if (Predicate.isTagged(error, "LastLead")) return "LastLead";
  if (Predicate.isTagged(error, "LastAdmin")) return "LastAdmin";
  if (Predicate.isTagged(error, "TeamNameTaken")) return "TeamNameTaken";
  if (Predicate.isTagged(error, "HttpApiSchemaError") || Predicate.isTagged(error, "SchemaError"))
    return "Invalid";
  return "Unavailable";
};

/** Runs one call of the `directory` group and reports its outcome; it never rejects. */
export const call = <A, E>(f: (api: Client["directory"]) => Effect.Effect<A, E>): Promise<Outcome<A>> =>
  Effect.runPromise(
    client.pipe(
      Effect.flatMap((api) => f(api.directory)),
      Effect.map((value): Outcome<A> => ({ ok: true, value })),
      Effect.catch((error: unknown) => Effect.succeed<Outcome<A>>({ ok: false, failure: failureOf(error) })),
      Effect.provide(FetchHttpClient.layer),
    ),
  );
