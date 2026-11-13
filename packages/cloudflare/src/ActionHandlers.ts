import { SurveyBeatApi } from "@surveybeat/api";
import { createAction, listActions, type OrganizationActions, updateAction } from "@surveybeat/domain";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { type AuthServices, currentMember, requireSameOrigin } from "./auth/AuthHandlers.ts";

/** Everything the Action endpoints need: sign-in's services and the Organization objects. */
export type ActionServices = AuthServices | OrganizationActions;

export const actionHandlers = <R>(services: Effect.Effect<Context.Context<ActionServices>, never, R>) => {
  const provide = <A, E, R2>(effect: Effect.Effect<A, E, R2>) =>
    Effect.flatMap(services, (context) => Effect.provideContext(effect, context));

  return HttpApiBuilder.group(SurveyBeatApi, "actions", (handlers) =>
    handlers
      .handle("listActions", ({ params }) =>
        provide(Effect.flatMap(currentMember, (member) => listActions(member, params.teamId))),
      )
      .handle("createAction", ({ params, payload }) =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const member = yield* currentMember;
            return yield* createAction(member, params.teamId, payload);
          }),
        ),
      )
      .handle("updateAction", ({ params, payload }) =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const member = yield* currentMember;
            return yield* updateAction(member, params.teamId, params.actionId, payload);
          }),
        ),
      ),
  );
};
