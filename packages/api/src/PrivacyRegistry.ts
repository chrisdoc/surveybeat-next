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
  "auth.login": { _tag: "NoResultData", why: "redirects to the AuthKit hosted sign-in page" },
  "auth.callback": { _tag: "NoResultData", why: "sets the session cookie and redirects to the app" },
  "auth.logout": { _tag: "NoResultData", why: "clears the session cookie and redirects to WorkOS logout" },
  "auth.session": {
    _tag: "NoResultData",
    why: "returns the sign-in state: Organization ids and names, a Person id, and the admin flag",
  },
  "auth.createOrganization": {
    _tag: "NoResultData",
    why: "returns the sign-in state of the new Organization's admin",
  },
  "auth.chooseOrganization": {
    _tag: "NoResultData",
    why: "returns the sign-in state in the chosen Organization",
  },
  "directory.listTeams": {
    _tag: "NoResultData",
    why: "returns Team ids, names, time zones, and the caller's role",
  },
  "directory.createTeam": {
    _tag: "NoResultData",
    why: "returns the new Team's roster: emails, roles, start dates",
  },
  "directory.getTeam": {
    _tag: "NoResultData",
    why: "returns a Team's active roster (emails, roles, start dates) and what the caller may do",
  },
  "directory.updateTeam": {
    _tag: "NoResultData",
    why: "renames a Team or changes its time zone; no content",
  },
  "directory.addMember": { _tag: "NoResultData", why: "adds a member by email; no content" },
  "directory.removeMember": { _tag: "NoResultData", why: "ends a Membership; no content" },
  "directory.assignLead": { _tag: "NoResultData", why: "assigns a Lead by email; no content" },
  "directory.removeLead": { _tag: "NoResultData", why: "ends a Lead's lead Membership; no content" },
  "directory.getSettings": {
    _tag: "NoResultData",
    why: "returns the Organization's name, minimum group size, and People with their admin flag",
  },
  "directory.updateSettings": { _tag: "NoResultData", why: "sets the minimum group size; no content" },
  "directory.grantAdmin": { _tag: "NoResultData", why: "makes a Person an Organization admin; no content" },
  "directory.revokeAdmin": {
    _tag: "NoResultData",
    why: "ends a Person's Organization admin role; no content",
  },
  "directory.removePerson": {
    _tag: "NoResultData",
    why: "removes a Person from the Organization; no content",
  },
  "pulses.listPulses": {
    _tag: "NoResultData",
    why: "returns a Team's Pulses: names, cadences, Question counts, and estimated answer times",
  },
  "pulses.createPulse": {
    _tag: "NoResultData",
    why: "returns the new Pulse's settings and Template Questions, the estimate, and the editor's warnings",
  },
  "pulses.getPulse": {
    _tag: "NoResultData",
    why: "returns a Pulse's settings and Questions, the estimate, and the editor's warnings (the Team's member count against N, never Answers)",
  },
  "pulses.updatePulseSettings": {
    _tag: "NoResultData",
    why: "sets a Pulse's name, cadence, answer window, and reminders; returns the Pulse as the editor shows it",
  },
  "pulses.addQuestion": {
    _tag: "NoResultData",
    why: "adds a Question to a Pulse; returns the Pulse as the editor shows it",
  },
  "pulses.editQuestion": {
    _tag: "NoResultData",
    why: "rewrites a Question without Answers; returns the Pulse as the editor shows it (hasAnswers is a flag, not Answer data)",
  },
  "pulses.removeQuestion": {
    _tag: "NoResultData",
    why: "takes a Question out of a Pulse; returns the Pulse as the editor shows it",
  },
  "pulses.reorderQuestions": {
    _tag: "NoResultData",
    why: "reorders a Pulse's Questions; returns the Pulse as the editor shows it",
  },
};
