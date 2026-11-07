import { SurveyBeatApi } from "@surveybeat/api";
import type { OrganizationId, SessionState } from "@surveybeat/domain";
import { Effect, Predicate } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

/** What the app shows: signed out, a failure, or one of the sign-in states the Main Worker reports. */
export type View = { readonly _tag: "SignedOut" } | { readonly _tag: "Failed" } | SessionState;

const client = HttpApiClient.make(SurveyBeatApi, { baseUrl: window.location.origin });
type Client = Effect.Success<typeof client>;

/** Runs one call. A missing or revoked session shows the sign-in screen; anything else, an error. */
const run = <E>(call: (api: Client) => Effect.Effect<SessionState, E>): Promise<View> =>
  Effect.runPromise(
    client.pipe(
      Effect.flatMap(call),
      Effect.map((state): View => state),
      Effect.catch((error: unknown) =>
        Effect.succeed<View>(
          Predicate.isTagged(error, "Unauthenticated") ? { _tag: "SignedOut" } : { _tag: "Failed" },
        ),
      ),
      Effect.provide(FetchHttpClient.layer),
    ),
  );

export const loadSession = () => run((api) => api.auth.session());

export const createOrganization = (name: string) =>
  run((api) => api.auth.createOrganization({ payload: { name } }));

export const chooseOrganization = (organizationId: OrganizationId) =>
  run((api) => api.auth.chooseOrganization({ payload: { organizationId } }));
