import { SurveyBeatApi } from "@surveybeat/api";
import { getRoundNote, type OrganizationNotes, saveRoundNote } from "@surveybeat/domain";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { type AuthServices, currentMember, requireSameOrigin } from "./auth/AuthHandlers.ts";

/** Everything the Note endpoints need: sign-in's services and the Organization objects. */
export type NoteServices = AuthServices | OrganizationNotes;

export const noteHandlers = <R>(services: Effect.Effect<Context.Context<NoteServices>, never, R>) => {
  const provide = <A, E, R2>(effect: Effect.Effect<A, E, R2>) =>
    Effect.flatMap(services, (context) => Effect.provideContext(effect, context));

  return HttpApiBuilder.group(SurveyBeatApi, "notes", (handlers) =>
    handlers
      .handle("getRoundNote", ({ params }) =>
        provide(
          Effect.flatMap(currentMember, (member) => getRoundNote(member, params.teamId, params.roundId)),
        ),
      )
      .handle("saveRoundNote", ({ params, payload }) =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const member = yield* currentMember;
            return yield* saveRoundNote(member, params.teamId, params.roundId, payload);
          }),
        ),
      ),
  );
};
