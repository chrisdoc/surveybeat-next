import { Dimension } from "@surveybeat/domain";
import * as Arbitrary from "effect/Arbitrary";
import * as Schema from "effect/Schema";
import type { HttpApi, HttpApiGroup } from "effect/http-api";
import type { SurveyBeatApi } from "./index.ts";

/** `group.endpoint` for every endpoint of an HttpApi declaration. */
export type EndpointKey<Api> =
  Api extends HttpApi.HttpApi<infer _Id, infer Groups>
    ? Groups extends HttpApiGroup.Constraint
      ? `${Groups["identifier"]}.${HttpApiGroup.Endpoints<Groups>["identifier"]}`
      : never
    : never;

const between = (minimum: number, maximum: number) =>
  Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(minimum), Schema.isLessThanOrEqualTo(maximum)));

/** How many Questions a generated Round can have; every per-Question list below has this many slots. */
export const SCENARIO_QUESTION_SLOTS = 5;

const slots = <S extends Schema.Constraint>(item: S) =>
  Schema.Array(item).pipe(
    Schema.check(Schema.isMinLength(SCENARIO_QUESTION_SLOTS), Schema.isMaxLength(SCENARIO_QUESTION_SLOTS)),
  );

/** One Question of a generated Round. `kind` picks the Question type; `dimension` is null for none. */
const ScenarioQuestion = Schema.Struct({
  kind: Schema.Literals(["rating", "choice", "text"]),
  dimension: Schema.NullOr(Dimension),
});

/** What one generated Submission answered for one Question slot (`value` is read per the Question kind). */
const ScenarioAnswer = Schema.Struct({
  answered: Schema.Boolean,
  value: between(0, 4),
  comment: Schema.NullOr(Schema.Literals(["", "   ", "fine", "too much work", "Ask Anna"])),
});

/** An earlier Round's score for one Dimension, in `Dimension` order. */
const ScenarioDimension = Schema.Struct({
  score: Schema.NullOr(between(1, 5)),
  usableQuestionCount: between(0, 3),
  contributors: between(0, 14),
});

/** An earlier closed Round of the same Pulse, as the Result computation sees it. */
const ScenarioHistoryRound = Schema.Struct({
  effectiveMinimumGroupSize: between(1, 8),
  submissionsCount: between(0, 14),
  questions: slots(Schema.Struct({ score: Schema.NullOr(between(1, 5)), contributors: between(0, 14) })),
  dimensions: Schema.Tuple([ScenarioDimension, ScenarioDimension, ScenarioDimension, ScenarioDimension]),
});

/**
 * The raw material for one Round's Result: the Round's status, the minimum group size stored when
 * its Result was computed (`storedN`), the Organization's minimum group size now (`organizationN`,
 * which may have been raised since), its Team size, Questions, Submissions, and earlier Rounds. The
 * effective N is `max(storedN, organizationN)` (ADR 0004, Rule R9).
 *
 * `viewer` is who asks for the Result: a Lead sees the Lead-only fields, a member does not. `themes`
 * is the state of the Round's themes call: none (never requested), pending, ready, or failed
 * (ADR 0016, 0019).
 */
export const RoundResultScenario = Schema.Struct({
  status: Schema.Literals(["open", "closed", "ready", "shared"]),
  storedN: between(1, 8),
  organizationN: between(1, 10),
  eligibleMembers: between(0, 20),
  questions: Schema.Array(ScenarioQuestion).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(SCENARIO_QUESTION_SLOTS)),
  ),
  submissions: Schema.Array(slots(ScenarioAnswer)).pipe(Schema.check(Schema.isMaxLength(14))),
  history: Schema.Array(ScenarioHistoryRound).pipe(Schema.check(Schema.isMaxLength(12))),
  viewer: Schema.Literals(["lead", "member"]),
  themes: Schema.Literals(["none", "pending", "ready", "failed"]),
});
export type RoundResultScenario = typeof RoundResultScenario.Type;

/** Input generator for Result-bearing endpoints: Rounds with few and many Submissions, and raised N. */
export const roundResultScenarios: Arbitrary.Arbitrary<RoundResultScenario> =
  Arbitrary.schema(RoundResultScenario);

/** Result fields only a Team's Lead may receive (ADR 0004, ADR 0016, ADR 0019). */
export const LeadOnlyField = Schema.Literals(["comments", "themes.supportingComments", "discussionGuide"]);
export type LeadOnlyField = typeof LeadOnlyField.Type;

/**
 * Whether an endpoint's response can contain Result data (scores, distributions, comments, trends:
 * anything derived from Submissions). Those endpoints get an input generator that produces Rounds,
 * and a property test checks the minimum group size rules R1–R11 (ADR 0004) for each of them. The
 * same test checks that a member's response carries none of the `leadOnly` fields, and that no
 * Comment theme or discussion guide appears below N.
 */
export type EndpointPrivacy =
  | { readonly _tag: "NoResultData"; readonly why: string }
  | {
      readonly _tag: "ResultData";
      readonly inputs: Arbitrary.Arbitrary<unknown>;
      readonly leadOnly: ReadonlyArray<LeadOnlyField>;
    };

/**
 * Every endpoint of `SurveyBeatApi`, classified. A new endpoint does not typecheck until it is
 * listed here, and `registry.privacy.test.ts` checks the same against the runtime declaration.
 */
export const privacyRegistry: { readonly [K in EndpointKey<typeof SurveyBeatApi>]: EndpointPrivacy } = {
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
  "directory.listFailedEmails": {
    _tag: "NoResultData",
    why: "returns, for Organization admins, the kind, recipient address, reason code, and time of the last 50 failed sends; never a body, a token, or Result data",
  },
  "directory.updateSettings": {
    _tag: "NoResultData",
    why: "sets the minimum group size, AI processing, and the default language; no content",
  },
  "directory.updateOwnLanguage": {
    _tag: "NoResultData",
    why: "sets the caller's own language and the browser language; no content",
  },
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
  "pulses.sendTestInvitation": {
    _tag: "NoResultData",
    why: "emails the signed-in Person a test Invitation of the Pulse (ADR 0021); stores no Submission or Participation; returns the address and the send id",
  },
  "pulses.getTestInvitation": {
    _tag: "NoResultData",
    why: "returns the state of the signed-in Person's own test send (queued, sending, sent, or failed with a reason code and times); never a body, token, recipient, or Result data",
  },
  "rounds.listRounds": {
    _tag: "NoResultData",
    why: "returns Round lifecycle status and timestamps; no Results",
  },
  "rounds.getRound": {
    _tag: "NoResultData",
    why: "returns Round lifecycle detail and status; no Results",
  },
  "rounds.skipWeek": {
    _tag: "NoResultData",
    why: "skips a scheduled cadence week; no content",
  },
  "rounds.unskipWeek": {
    _tag: "NoResultData",
    why: "unskips a cadence week; no content",
  },
  "rounds.pausePulse": {
    _tag: "NoResultData",
    why: "pauses a Pulse, cancelling the scheduled round; no content",
  },
  "rounds.resumePulse": {
    _tag: "NoResultData",
    why: "resumes a paused Pulse, scheduling the next round; no content",
  },
  "rounds.closeRoundEarly": {
    _tag: "NoResultData",
    why: "closes an open round early; returns round detail, no Results",
  },
  "rounds.shareResults": {
    _tag: "NoResultData",
    why: "the Lead shares a Ready Round's Result with the Team; returns nothing",
  },
  "rounds.retryResult": {
    _tag: "NoResultData",
    why: "the Lead re-queues a Round's Result computation after it failed; returns nothing",
  },
  "rounds.cancelRound": {
    _tag: "NoResultData",
    why: "cancels a round; returns round detail, no Results",
  },
  "rounds.resendInvitation": {
    _tag: "NoResultData",
    why: "resends an invitation for a member; no content",
  },
  "rounds.getResults": {
    _tag: "ResultData",
    inputs: roundResultScenarios,
    leadOnly: ["comments", "themes.supportingComments", "discussionGuide"],
  },
  "rounds.getTeamOverview": { _tag: "ResultData", inputs: roundResultScenarios, leadOnly: [] },
  "rounds.getMyHistory": { _tag: "ResultData", inputs: roundResultScenarios, leadOnly: [] },
  "actions.listActions": {
    _tag: "NoResultData",
    why: "Actions have no minimum group size",
  },
  "actions.createAction": {
    _tag: "NoResultData",
    why: "creates an Action commitment; no Result data",
  },
  "actions.updateAction": {
    _tag: "NoResultData",
    why: "updates an Action; no Result data",
  },
  "notes.getRoundNote": {
    _tag: "NoResultData",
    why: "the Lead's Note is free text the Lead writes under their own name; no Result data",
  },
  "notes.saveRoundNote": {
    _tag: "NoResultData",
    why: "writes the Lead's Note; no Result data",
  },
};
