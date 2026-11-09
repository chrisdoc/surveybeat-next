import { SurveyBeatApi } from "@surveybeat/api";
import {
  type OrganizationRounds,
  type RoundCommand,
  runRoundCommand,
  viewResults,
  viewRound,
  viewRounds,
} from "@surveybeat/domain";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { type AuthServices, currentMember, requireSameOrigin } from "./auth/AuthHandlers.ts";

/** Everything the Round lifecycle endpoints need: sign-in's services and the Organization objects. */
export type RoundServices = AuthServices | OrganizationRounds;

const change = <R>(command: Effect.Effect<RoundCommand, never, R>) =>
  Effect.gen(function* () {
    yield* requireSameOrigin;
    const member = yield* currentMember;
    yield* runRoundCommand(member, yield* command);
  });

export const roundHandlers = <R>(services: Effect.Effect<Context.Context<RoundServices>, never, R>) => {
  const provide = <A, E, R2>(effect: Effect.Effect<A, E, R2>) =>
    Effect.flatMap(services, (context) => Effect.provideContext(effect, context));

  return HttpApiBuilder.group(SurveyBeatApi, "rounds", (handlers) =>
    handlers
      .handle("listRounds", ({ params }) =>
        provide(Effect.flatMap(currentMember, (member) => viewRounds(member, params.teamId, params.pulseId))),
      )
      .handle("getRound", ({ params }) =>
        provide(Effect.flatMap(currentMember, (member) => viewRound(member, params.teamId, params.roundId))),
      )
      .handle("skipWeek", ({ params, payload }) =>
        provide(
          change(
            Effect.succeed({
              _tag: "SkipWeek",
              teamId: params.teamId,
              pulseId: params.pulseId,
              plannedOpenDate: payload.plannedOpenDate,
            }),
          ),
        ),
      )
      .handle("unskipWeek", ({ params, payload }) =>
        provide(
          change(
            Effect.succeed({
              _tag: "UnskipWeek",
              teamId: params.teamId,
              pulseId: params.pulseId,
              plannedOpenDate: payload.plannedOpenDate,
            }),
          ),
        ),
      )
      .handle("pausePulse", ({ params }) =>
        provide(
          change(
            Effect.succeed({
              _tag: "PausePulse",
              teamId: params.teamId,
              pulseId: params.pulseId,
            }),
          ),
        ),
      )
      .handle("resumePulse", ({ params }) =>
        provide(
          change(
            Effect.succeed({
              _tag: "ResumePulse",
              teamId: params.teamId,
              pulseId: params.pulseId,
            }),
          ),
        ),
      )
      .handle("closeRoundEarly", ({ params }) =>
        provide(
          Effect.gen(function* () {
            yield* change(
              Effect.succeed({
                _tag: "CloseRoundEarly",
                teamId: params.teamId,
                roundId: params.roundId,
              }),
            );
            const member = yield* currentMember;
            return yield* viewRound(member, params.teamId, params.roundId);
          }),
        ),
      )
      .handle("cancelRound", ({ params }) =>
        provide(
          Effect.gen(function* () {
            yield* change(
              Effect.succeed({
                _tag: "CancelRound",
                teamId: params.teamId,
                roundId: params.roundId,
              }),
            );
            const member = yield* currentMember;
            return yield* viewRound(member, params.teamId, params.roundId);
          }),
        ),
      )
      .handle("resendInvitation", ({ params }) =>
        provide(
          change(
            Effect.succeed({
              _tag: "ResendInvitation",
              teamId: params.teamId,
              roundId: params.roundId,
              personId: params.personId,
            }),
          ),
        ),
      )
      .handle("getResults", ({ params }) =>
        provide(
          Effect.flatMap(currentMember, (member) => viewResults(member, params.teamId, params.roundId)),
        ),
      ),
  );
};
