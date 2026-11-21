import { SurveyBeatApi } from "@surveybeat/api";
import { Policy } from "@surveybeat/domain";
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
  "ErasureNotConfirmed",
  "OrganizationNotConfirmed",
  "AccountStillInUse",
  "EmailTaken",
  "EmailUnusable",
  "EmailUnchanged",
  "EmailChangePending",
  "WrongEmailCode",
  "SignInAgainRequired",
  "PasskeySignInAgainRequired",
  "PasskeyAlreadyExists",
  "PersonHasAccount",
  "TeamNameTaken",
  "QuestionAlreadyInPulse",
  "QuestionHasAnswers",
  "PulseNeedsAQuestion",
  "PulseFull",
  "OrderMismatch",
  "TestSendLimitReached",
  "EmailNotResendable",
  "Invalid",
  "Unavailable",
]);

export type Failure = typeof Failure.Type;

export const failureMessage = (failure: Failure): string => {
  switch (failure) {
    case "Unauthenticated": {
      return message("error.Unauthenticated");
    }

    case "Forbidden": {
      return message("error.Forbidden");
    }

    case "NotFound": {
      return message("error.NotFound");
    }

    case "LastLead": {
      return message("error.LastLead");
    }

    case "LastAdmin": {
      return message("error.LastAdmin");
    }

    case "ErasureNotConfirmed": {
      return message("error.ErasureNotConfirmed");
    }

    case "OrganizationNotConfirmed": {
      return message("error.OrganizationNotConfirmed");
    }

    case "AccountStillInUse": {
      return message("error.AccountStillInUse");
    }

    case "EmailTaken": {
      return message("error.EmailTaken");
    }

    case "EmailUnusable": {
      return message("error.EmailUnusable");
    }

    case "EmailUnchanged": {
      return message("error.EmailUnchanged");
    }

    case "EmailChangePending": {
      return message("error.EmailChangePending");
    }

    case "WrongEmailCode": {
      return message("error.WrongEmailCode");
    }

    case "SignInAgainRequired": {
      return message("error.SignInAgainRequired");
    }

    case "PasskeySignInAgainRequired": {
      return message("error.PasskeySignInAgainRequired");
    }

    case "PasskeyAlreadyExists": {
      return message("error.PasskeyAlreadyExists");
    }

    case "PersonHasAccount": {
      return message("error.PersonHasAccount");
    }

    case "TeamNameTaken": {
      return message("error.TeamNameTaken");
    }

    case "QuestionAlreadyInPulse": {
      return message("error.QuestionAlreadyInPulse");
    }

    case "QuestionHasAnswers": {
      return message("error.QuestionHasAnswers");
    }

    case "PulseNeedsAQuestion": {
      return message("error.PulseNeedsAQuestion");
    }

    case "PulseFull": {
      return message("error.PulseFull");
    }

    case "OrderMismatch": {
      return message("error.OrderMismatch");
    }

    case "TestSendLimitReached": {
      return message("error.TestSendLimitReached", { perHour: Policy.testSend.perHour });
    }

    case "EmailNotResendable": {
      return message("error.EmailNotResendable");
    }

    case "Invalid": {
      return message("error.Invalid");
    }

    case "Unavailable": {
      return message("error.Unavailable");
    }
  }
};

export const failureOf = (error: unknown): Failure => {
  if (Predicate.isTagged(error, "Unauthenticated")) {
    return "Unauthenticated";
  }

  if (Predicate.isTagged(error, "Forbidden")) {
    return "Forbidden";
  }

  if (
    Predicate.isTagged(error, "TeamNotFound") ||
    Predicate.isTagged(error, "PersonNotFound") ||
    Predicate.isTagged(error, "PulseNotFound") ||
    Predicate.isTagged(error, "QuestionNotFound") ||
    Predicate.isTagged(error, "RoundNotFound") ||
    Predicate.isTagged(error, "ActionNotFound") ||
    Predicate.isTagged(error, "ResultsNotReady") ||
    Predicate.isTagged(error, "FailedEmailNotFound")
  ) {
    return "NotFound";
  }

  if (Predicate.isTagged(error, "OwnerNotInTeam")) {
    return "Invalid";
  }

  if (Predicate.isTagged(error, "LastLead")) {
    return "LastLead";
  }

  if (Predicate.isTagged(error, "LastAdmin")) {
    return "LastAdmin";
  }

  if (Predicate.isTagged(error, "ErasureNotConfirmed")) {
    return "ErasureNotConfirmed";
  }

  if (Predicate.isTagged(error, "AccountStillInUse")) {
    return "AccountStillInUse";
  }

  if (Predicate.isTagged(error, "TeamNameTaken")) {
    return "TeamNameTaken";
  }

  for (const tag of [
    "EmailTaken",
    "EmailUnusable",
    "EmailUnchanged",
    "EmailChangePending",
    "WrongEmailCode",
    "SignInAgainRequired",
    "PersonHasAccount",
    "QuestionAlreadyInPulse",
    "QuestionHasAnswers",
    "PulseNeedsAQuestion",
    "PulseFull",
    "OrderMismatch",
    "TestSendLimitReached",
    "EmailNotResendable",
  ] as const) {
    if (Predicate.isTagged(error, tag)) {
      return tag;
    }
  }

  if (Predicate.isTagged(error, "HttpApiSchemaError") || Predicate.isTagged(error, "SchemaError")) {
    return "Invalid";
  }

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
): Effect.Effect<M> => {
  const recover = (failure: unknown): Effect.Effect<M> => Effect.succeed(onFailure(failureOf(failure)));

  return clientEffect.pipe(
    Effect.flatMap(f),
    Effect.map(onSuccess),
    Effect.catch(recover),
    Effect.provide(FetchHttpClient.layer),
  );
};
