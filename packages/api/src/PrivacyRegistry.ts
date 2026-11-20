import { Dimension } from "@surveybeat/domain";
import type { PageRouteKey } from "./PageRoutes.ts";
import * as Arbitrary from "effect/Arbitrary";
import * as Schema from "effect/Schema";
import type { HttpApi, HttpApiGroup } from "effect/http-api";
import type { SurveyBeatApi } from "./index.ts";

export type EndpointKey<Api> =
  Api extends HttpApi.HttpApi<infer _Id, infer Groups>
    ? Groups extends HttpApiGroup.Constraint
      ? `${Groups["identifier"]}.${HttpApiGroup.Endpoints<Groups>["identifier"]}`
      : never
    : never;

const between = (minimum: number, maximum: number) =>
  Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(minimum), Schema.isLessThanOrEqualTo(maximum)));

export const SCENARIO_QUESTION_SLOTS = 5;

const slots = <S extends Schema.Constraint>(item: S) =>
  Schema.Array(item).pipe(
    Schema.check(Schema.isMinLength(SCENARIO_QUESTION_SLOTS), Schema.isMaxLength(SCENARIO_QUESTION_SLOTS)),
  );

const ScenarioQuestion = Schema.Struct({
  kind: Schema.Literals(["rating", "choice", "text"]),
  dimension: Schema.NullOr(Dimension),
});

const ScenarioAnswer = Schema.Struct({
  answered: Schema.Boolean,
  value: between(0, 4),
  comment: Schema.NullOr(Schema.Literals(["", "   ", "fine", "too much work", "Ask Anna"])),
});

const ScenarioDimension = Schema.Struct({
  score: Schema.NullOr(between(1, 5)),
  usableQuestionCount: between(0, 3),
  contributors: between(0, 14),
});

const ScenarioHistoryRound = Schema.Struct({
  effectiveMinimumGroupSize: between(1, 8),
  submissionsCount: between(0, 14),
  questions: slots(Schema.Struct({ score: Schema.NullOr(between(1, 5)), contributors: between(0, 14) })),
  dimensions: Schema.Tuple([ScenarioDimension, ScenarioDimension, ScenarioDimension, ScenarioDimension]),
});

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

export const roundResultScenarios: Arbitrary.Arbitrary<RoundResultScenario> =
  Arbitrary.schema(RoundResultScenario);

export const LeadOnlyField = Schema.Literals(["comments", "themes.supportingComments", "discussionGuide"]);

export type LeadOnlyField = typeof LeadOnlyField.Type;

export type EndpointPrivacy =
  | { readonly _tag: "NoResultData"; readonly why: string }
  | {
      readonly _tag: "ResultData";
      readonly inputs: Arbitrary.Arbitrary<unknown>;
      readonly leadOnly: readonly LeadOnlyField[];
    };

export const privacyRegistry: Readonly<Record<EndpointKey<typeof SurveyBeatApi>, EndpointPrivacy>> = {
  "auth.login": { _tag: "NoResultData", why: "redirects to the app's own email-code form" },
  "auth.sendSignInCode": { _tag: "NoResultData", why: "hands the email to Better Auth, which mails a code" },
  "auth.verifySignInCode": {
    _tag: "NoResultData",
    why: "checks the code and hands Better Auth's session cookie back to the browser",
  },
  "auth.logout": {
    _tag: "NoResultData",
    why: "clears the session cookie, revokes the session and redirects home",
  },
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
  "me.exportData": {
    _tag: "NoResultData",
    why: "returns only the caller's own personal records; never another Person's data, Team Results, Submissions or Answers",
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
  "directory.resendFailedEmail": {
    _tag: "NoResultData",
    why: "for Organization admins, sends a failed send again under the same id and content, and returns its state; never a body, a token, a recipient, or Result data",
  },
  "directory.getEmailStatus": {
    _tag: "NoResultData",
    why: "returns, for Organization admins, one send's state (queued, sending, sent, or failed with its reason and code); never a body, a token, a recipient, or Result data",
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
  "directory.erasePerson": {
    _tag: "NoResultData",
    why: "irreversibly scrubs one Person's personal data in this Organization on an Organization admin's request; returns no content",
  },
  "directory.exportOffboarding": {
    _tag: "NoResultData",
    why: "returns, for Organization admins, the Organization's settings, Teams, People, Memberships, Pulses and Questions; no Results, Submissions or Answers",
  },
  "directory.offboardOrganization": {
    _tag: "NoResultData",
    why: "irreversibly deletes the Organization and its index on an Organization admin's request; returns no content, and never reads a Result, Submission or Answer",
  },
  "me.erasePerson": {
    _tag: "NoResultData",
    why: "irreversibly scrubs the caller's own Person in the chosen Organization; returns no content",
  },
  "me.eraseAccount": {
    _tag: "NoResultData",
    why: "deletes the caller's own sign-in account once no Person is left; returns no content",
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
    why: "returns Round lifecycle status and timestamps, and invitation counts; no Results",
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

export const pageRoutePrivacy: Readonly<Record<PageRouteKey, EndpointPrivacy>> = {
  "pages.delivery": {
    _tag: "NoResultData",
    why: "server-rendered page that sets one Person's delivery time zone from an invitation token; returns no survey content",
  },
  "pages.unsubscribe": {
    _tag: "NoResultData",
    why: "server-rendered page that turns off one Person's reminders from an invitation token; returns no survey content",
  },
};
