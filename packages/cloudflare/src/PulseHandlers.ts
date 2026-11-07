import { SurveyBeatApi } from "@surveybeat/api";
import {
  NewIds,
  type OrganizationPulses,
  type PulseCommand,
  type PulseId,
  runPulseCommand,
  type TeamId,
  viewPulse,
  viewPulses,
} from "@surveybeat/domain";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { type AuthServices, currentMember, requireSameOrigin } from "./auth/AuthHandlers.ts";

/** Everything the Pulse editor endpoints need: sign-in's services and the Organization objects. */
export type PulseServices = AuthServices | OrganizationPulses;

/** A change to one Pulse: same origin only, as the signed-in Person, then the Pulse as it is now. */
const change = <R>(teamId: TeamId, pulseId: PulseId, command: Effect.Effect<PulseCommand, never, R>) =>
  Effect.gen(function* () {
    yield* requireSameOrigin;
    const member = yield* currentMember;
    yield* runPulseCommand(member, yield* command);
    return yield* viewPulse(member, teamId, pulseId);
  });

/** The `pulses` group of `SurveyBeatApi`: a Team's Pulses and the Pulse editor. */
export const pulseHandlers = <R>(services: Effect.Effect<Context.Context<PulseServices>, never, R>) => {
  const provide = <A, E, R2>(effect: Effect.Effect<A, E, R2>) =>
    Effect.flatMap(services, (context) => Effect.provideContext(effect, context));
  return HttpApiBuilder.group(SurveyBeatApi, "pulses", (handlers) =>
    handlers
      .handle("listPulses", ({ params }) =>
        provide(Effect.flatMap(currentMember, (member) => viewPulses(member, params.teamId))),
      )
      .handle("createPulse", ({ params }) =>
        provide(
          Effect.gen(function* () {
            const pulseId = yield* (yield* NewIds).pulseId;
            return yield* change(
              params.teamId,
              pulseId,
              Effect.succeed({ _tag: "CreatePulse", teamId: params.teamId, pulseId }),
            );
          }),
        ),
      )
      .handle("getPulse", ({ params }) =>
        provide(Effect.flatMap(currentMember, (member) => viewPulse(member, params.teamId, params.pulseId))),
      )
      .handle("updatePulseSettings", ({ params, payload }) =>
        provide(
          change(
            params.teamId,
            params.pulseId,
            Effect.succeed({ _tag: "UpdatePulseSettings", ...params, settings: payload }),
          ),
        ),
      )
      .handle("addQuestion", ({ params, payload }) =>
        provide(
          change(
            params.teamId,
            params.pulseId,
            Effect.map(
              Effect.flatMap(NewIds, (ids) => ids.questionId),
              (questionId) => ({ _tag: "AddQuestion", ...params, question: payload, questionId }),
            ),
          ),
        ),
      )
      .handle("editQuestion", ({ params, payload }) =>
        provide(
          change(
            params.teamId,
            params.pulseId,
            Effect.succeed({ _tag: "EditQuestion", ...params, content: payload }),
          ),
        ),
      )
      .handle("removeQuestion", ({ params }) =>
        provide(change(params.teamId, params.pulseId, Effect.succeed({ _tag: "RemoveQuestion", ...params }))),
      )
      .handle("reorderQuestions", ({ params, payload }) =>
        provide(
          change(
            params.teamId,
            params.pulseId,
            Effect.succeed({ _tag: "ReorderQuestions", ...params, order: payload.order }),
          ),
        ),
      ),
  );
};
