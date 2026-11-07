import type * as Arbitrary from "effect/Arbitrary";
import type { HttpApi, HttpApiGroup } from "effect/http-api";
import type { SurveyBeatApi } from "./index.ts";

/** `group.endpoint` for every endpoint of an HttpApi declaration. */
export type EndpointKey<Api> =
  Api extends HttpApi.HttpApi<infer _Id, infer Groups>
    ? Groups extends HttpApiGroup.Constraint
      ? `${Groups["identifier"]}.${HttpApiGroup.Endpoints<Groups>["identifier"]}`
      : never
    : never;

/**
 * Whether an endpoint's response can contain Result data (scores, distributions, comments, trends:
 * anything derived from Submissions). Those endpoints get an input generator that produces Rounds,
 * and a property test checks the minimum group size rules R1–R11 (ADR 0004) for each of them.
 */
export type EndpointPrivacy =
  | { readonly _tag: "NoResultData"; readonly why: string }
  | { readonly _tag: "ResultData"; readonly inputs: Arbitrary.Arbitrary<unknown> };

/**
 * Every endpoint of `SurveyBeatApi`, classified. A new endpoint does not typecheck until it is
 * listed here, and `registry.privacy.test.ts` checks the same against the runtime declaration.
 */
export const privacyRegistry: { readonly [K in EndpointKey<typeof SurveyBeatApi>]: EndpointPrivacy } = {
  "organizations.create": { _tag: "NoResultData", why: "returns the Organization's id and name" },
  "organizations.getById": { _tag: "NoResultData", why: "returns the Organization's id and name" },
};
