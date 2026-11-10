import {
  ActionId,
  type ActionItem,
  EmailAddress,
  type HistoryRound,
  type Locale,
  MinimumGroupSize,
  OrganizationId,
  PersonId,
  PulseId,
  QuestionId,
  QuestionVersionId,
  RoundId,
  type RoundDetail,
  type RoundResult,
  type RoundSummary,
  SendTime,
  TeamId,
  type TeamOverview,
  TemplateQuestionKey,
  TimeZone,
} from "@surveybeat/domain";
import { Option, Schema } from "effect";
import * as Scene from "foldkit/scene";
import { setup } from "foldkit/test/vitest";
import { fromString } from "foldkit/url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AddMember,
  AddQuestionCmd,
  AssignLead,
  ChooseOrganization,
  CreateActionCmd,
  CreateOrganization,
  CreatePulse,
  CancelRoundCmd,
  ClearKeptAnswersCmd,
  CloseRoundEarlyCmd,
  CreateTeam,
  GetRoundDetailCmd,
  GetRoundRateCmd,
  GetSettings,
  GetTeam,
  initialModel,
  ListRoundsCmd,
  ListTeams,
  LoadSession,
  localeOf,
  Message,
  Navigate,
  PausePulseCmd,
  RemoveMember,
  RemoveQuestionCmd,
  ResendInvitationCmd,
  ResumePulseCmd,
  SaveRoundNoteCmd,
  SkipWeekCmd,
  update,
  UpdateActionCmd,
  UpdatePulseSettingsCmd,
  UpdateAiProcessing,
  UpdateDefaultLanguage,
  UpdateOwnLanguage,
  UpdateSettings,
  UpdateTeam,
  view,
} from "./App.ts";
import { formatDate, message, setLocale } from "../messages/locale.ts";
import type { KeptAnswers } from "./keptAnswers.ts";
import type { SessionModel } from "./session.ts";

setup();

const decodeOrgId = Schema.decodeSync(OrganizationId);
const decodeTeamId = Schema.decodeSync(TeamId);
const decodePulseId = Schema.decodeSync(PulseId);
const decodePersonId = Schema.decodeSync(PersonId);
const decodeQuestionId = Schema.decodeSync(QuestionId);
const decodeVersionId = Schema.decodeSync(QuestionVersionId);
const decodeTemplateKey = Schema.decodeSync(TemplateQuestionKey);
const decodeTimeZone = Schema.decodeSync(TimeZone);
const decodeEmail = Schema.decodeSync(EmailAddress);
const decodeSize = Schema.decodeSync(MinimumGroupSize);
const decodeSendTime = Schema.decodeSync(SendTime);

const makeUrl = (str: string) => Option.getOrThrow(fromString(str));

beforeEach(() => {
  // No browser language unless a test sets one, so the default flows issue no language commands.
  vi.stubGlobal("navigator", { languages: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

const signedInAdmin: SessionModel = {
  _tag: "SignedIn",
  organization: { id: decodeOrgId("org-1"), name: "Acme" },
  organizationAdmin: true,
  locale: null,
  detectedLocale: null,
  organizationLocale: "en",
};

describe("App Scenes", () => {
  describe("Sign-in states", () => {
    it("renders signed out screen with sign-in button", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/")),
          session: { _tag: "SignedOut", failed: false },
        }),
        Scene.expect(Scene.role("heading", { name: "Sign in to SurveyBeat" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Sign in" })).toExist(),
      );
    });

    it("renders failed sign-in notice when query param is present", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/?signin=failed")),
          session: { _tag: "SignedOut", failed: true },
        }),
        Scene.expect(Scene.text("Signing in did not work. Please try again.")).toExist(),
      );
    });

    it("renders create organization screen and submits form", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/")),
          session: { _tag: "CreateOrganization", name: "", busy: false },
        }),
        Scene.expect(Scene.role("heading", { name: "Create an Organization" })).toExist(),
        Scene.type(Scene.label("Organization name"), "Acme Corp"),
        Scene.click(Scene.role("button", { name: "Create Organization" })),
        Scene.Command.expectHas(CreateOrganization),
        Scene.Command.resolve(
          CreateOrganization,
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization: { id: decodeOrgId("org-1"), name: "Acme Corp" },
              organizationAdmin: true,
              locale: null,
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Scene.Command.expectHas(ListTeams),
        Scene.Command.resolve(
          ListTeams,
          Message.GotTeams({
            outcome: { _tag: "Success", teams: [] },
          }),
        ),
        Scene.expect(Scene.role("heading", { name: "Teams" })).toExist(),
      );
    });

    it("renders not in organization screen", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/")),
          session: { _tag: "NotInOrganization" },
        }),
        Scene.expect(Scene.role("heading", { name: "You're not part of an Organization yet" })).toExist(),
      );
    });

    it("renders choose organization screen and picks an organization", () => {
      const orgA = { id: decodeOrgId("org-a"), name: "Org Alpha" };
      const orgB = { id: decodeOrgId("org-b"), name: "Org Beta" };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/")),
          session: {
            _tag: "ChooseOrganization",
            organizations: [orgA, orgB],
            busy: false,
          },
        }),
        Scene.expect(Scene.role("heading", { name: "Choose an Organization" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Org Alpha" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Org Beta" })).toExist(),
        Scene.click(Scene.role("button", { name: "Org Beta" })),
        Scene.Command.expectHas(ChooseOrganization),
        Scene.Command.resolve(
          ChooseOrganization,
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization: orgB,
              organizationAdmin: false,
              locale: null,
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Scene.Command.expectHas(ListTeams),
        Scene.Command.resolve(
          ListTeams,
          Message.GotTeams({
            outcome: { _tag: "Success", teams: [] },
          }),
        ),
      );
    });
  });

  describe("Teams screen", () => {
    it("renders teams list and creates team via form", () => {
      const teamId = decodeTeamId("team-1");
      const teamSummary = {
        id: teamId,
        name: "Engineering",
        timeZone: decodeTimeZone("Europe/Berlin"),
        yourRole: "lead" as const,
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/")),
          session: signedInAdmin,
          teams: { _tag: "Loaded", teams: [teamSummary] },
        }),
        Scene.expect(Scene.text("Engineering")).toExist(),
        Scene.expect(Scene.role("heading", { name: "Create a Team" })).toExist(),
        Scene.type(Scene.label("Team name"), "Design"),
        Scene.type(Scene.label("Time zone"), "UTC"),
        Scene.type(Scene.label("Lead's email"), "lead@acme.com"),
        Scene.click(Scene.role("button", { name: "Create Team" })),
        Scene.Command.expectHas(CreateTeam),
        Scene.Command.resolve(
          CreateTeam,
          Message.CreatedTeam({
            outcome: {
              _tag: "Success",
              detail: {
                team: {
                  id: decodeTeamId("team-2"),
                  name: "Design",
                  timeZone: decodeTimeZone("UTC"),
                  yourRole: "lead",
                },
                roster: [],
                may: {
                  update: true,
                  manageLeads: true,
                  manageMembers: true,
                  managePulses: true,
                  viewResults: true,
                },
              },
            },
          }),
        ),
        Scene.Command.expectHas(Navigate),
        Scene.Command.resolve(Navigate, Message.Navigated()),
      );
    });
  });

  describe("Team detail screen", () => {
    it("interacts with roster and team renaming", () => {
      const teamId = decodeTeamId("team-1");
      const personId = decodePersonId("person-1");
      const detail = {
        team: {
          id: teamId,
          name: "Old Team Name",
          timeZone: decodeTimeZone("UTC"),
          yourRole: "lead" as const,
        },
        roster: [
          {
            personId,
            email: decodeEmail("alice@acme.com"),
            role: "member" as const,
            since: 1700000000000,
          },
        ],
        may: {
          update: true,
          manageLeads: true,
          manageMembers: true,
          managePulses: true,
          viewResults: true,
        },
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}`)),
          session: signedInAdmin,
          teamDetail: { _tag: "Loaded", detail },
          renameName: detail.team.name,
          renameTimeZone: detail.team.timeZone,
        }),
        Scene.expect(Scene.role("heading", { name: "Old Team Name" })).toExist(),
        Scene.expect(Scene.text("alice@acme.com")).toExist(),
        Scene.expect(Scene.role("button", { name: "Remove" })).toExist(),
        // Rename team
        Scene.type(Scene.label("Team name"), "Renamed Team"),
        Scene.click(Scene.role("button", { name: "Save" })),
        Scene.Command.expectHas(UpdateTeam),
        Scene.Command.resolve(UpdateTeam, Message.UpdatedTeam({ outcome: { _tag: "Success" } })),
        Scene.Command.expectHas(GetTeam),
        Scene.Command.resolve(
          GetTeam,
          Message.GotTeam({
            outcome: {
              _tag: "Success",
              detail: { ...detail, team: { ...detail.team, name: "Renamed Team" } },
            },
          }),
        ),
        Scene.expect(Scene.role("heading", { name: "Renamed Team" })).toExist(),
        // Add member
        Scene.type(Scene.label("Add a member by email"), "bob@acme.com"),
        Scene.click(Scene.role("button", { name: "Add member" })),
        Scene.Command.expectHas(AddMember),
        Scene.Command.resolve(AddMember, Message.AddedMember({ outcome: { _tag: "Success" } })),
        Scene.Command.expectHas(GetTeam),
        Scene.Command.resolve(GetTeam, Message.GotTeam({ outcome: { _tag: "Success", detail } })),
        // Assign lead
        Scene.type(Scene.label("Assign a Lead by email"), "carol@acme.com"),
        Scene.click(Scene.role("button", { name: "Assign Lead" })),
        Scene.Command.expectHas(AssignLead),
        Scene.Command.resolve(AssignLead, Message.AssignedLead({ outcome: { _tag: "Success" } })),
        Scene.Command.expectHas(GetTeam),
        Scene.Command.resolve(GetTeam, Message.GotTeam({ outcome: { _tag: "Success", detail } })),
        // Remove member
        Scene.click(Scene.role("button", { name: "Remove" })),
        Scene.Command.expectHas(RemoveMember),
        Scene.Command.resolve(RemoveMember, Message.RemovedMember({ outcome: { _tag: "Success" } })),
        Scene.Command.expectHas(GetTeam),
        Scene.Command.resolve(
          GetTeam,
          Message.GotTeam({
            outcome: { _tag: "Success", detail: { ...detail, roster: [] } },
          }),
        ),
      );
    });

    describe("Team health overview", () => {
      const teamId = decodeTeamId("team-1");
      const roundA = Schema.decodeSync(RoundId)("round-a");
      const roundB = Schema.decodeSync(RoundId)("round-b");
      const roundC = Schema.decodeSync(RoundId)("round-c");
      const actionId = Schema.decodeSync(ActionId)("action-1");
      const committedAt = Date.parse("2026-10-28T09:00:00Z");
      const doneAt = Date.parse("2026-11-04T09:00:00Z");

      const overview: TeamOverview = {
        teamId,
        rounds: [
          { roundId: roundA, plannedOpenDate: "2026-10-26" },
          { roundId: roundB, plannedOpenDate: "2026-11-02" },
          { roundId: roundC, plannedOpenDate: "2026-11-09" },
        ],
        dimensions: [
          {
            dimension: "workload",
            points: [
              { roundId: roundA, score: 3.5 },
              { roundId: roundB, score: null },
              { roundId: roundC, score: 4 },
            ],
          },
          {
            dimension: "clarity",
            points: [
              { roundId: roundA, score: 3 },
              { roundId: roundB, score: 3.5 },
              { roundId: roundC, score: 4 },
            ],
          },
        ],
        markers: [
          { actionId, title: "Fix standups", kind: "committed", at: committedAt },
          { actionId, title: "Fix standups", kind: "done", at: doneAt },
        ],
      };

      const detailWith = (viewResults: boolean) => ({
        team: {
          id: teamId,
          name: "Platform",
          timeZone: decodeTimeZone("UTC"),
          yourRole: "member" as const,
        },
        roster: [],
        may: {
          update: false,
          manageLeads: false,
          manageMembers: false,
          managePulses: false,
          viewResults,
        },
      });

      const teamUrl = makeUrl(`https://app.surveybeat.com/teams/${teamId}`);

      it("shows Dimension lines, Action markers with titles, and a table view", () => {
        Scene.scene(
          { update, view },
          Scene.given({
            ...initialModel(teamUrl),
            session: signedInAdmin,
            teamDetail: { _tag: "Loaded", detail: detailWith(true) },
            teamOverview: { _tag: "Loaded", overview },
          }),
          Scene.expect(Scene.role("heading", { name: "Team health over time" })).toExist(),
          Scene.expect(Scene.role("img", { name: "Workload across all shared Rounds" })).toExist(),
          Scene.expect(Scene.role("img", { name: "Clarity across all shared Rounds" })).toExist(),
          Scene.expect(
            Scene.role("button", {
              name: `Committed ${formatDate(new Date(committedAt))}: Fix standups`,
            }),
          ).toExist(),
          Scene.expect(Scene.text(`Committed ${formatDate(new Date(committedAt))}: Fix standups`)).toExist(),
          Scene.expect(
            Scene.role("button", {
              name: `Done ${formatDate(new Date(doneAt))}: Fix standups`,
            }),
          ).toExist(),
          Scene.expect(Scene.text("Action committed")).toExist(),
          // Workload has a gap in the middle Round: two dots. Clarity has three. Five dots in all.
          Scene.expectAll(Scene.all.selector("circle")).toHaveCount(5),
          Scene.inside(
            Scene.role("img", { name: "Workload across all shared Rounds" }),
            Scene.expectAll(Scene.all.selector("circle")).toHaveCount(2),
          ),
          Scene.click(Scene.role("button", { name: "Table view" })),
          Scene.expect(Scene.role("button", { name: "Chart view" })).toExist(),
          Scene.expect(Scene.text("Too few answers")).toExist(),
          Scene.expect(Scene.text("Fix standups")).toExist(),
        );
      });

      it("hides the overview from people who may not see Results", () => {
        Scene.scene(
          { update, view },
          Scene.given({
            ...initialModel(teamUrl),
            session: signedInAdmin,
            teamDetail: { _tag: "Loaded", detail: detailWith(false) },
            teamOverview: { _tag: "Loaded", overview },
          }),
          Scene.expect(Scene.role("heading", { name: "Team health over time" })).toBeAbsent(),
        );
      });

      it("hides the overview when the server refuses it", () => {
        Scene.scene(
          { update, view },
          Scene.given({
            ...initialModel(teamUrl),
            session: signedInAdmin,
            teamDetail: { _tag: "Loaded", detail: detailWith(true) },
            teamOverview: { _tag: "Failed", failure: "Forbidden" },
          }),
          Scene.expect(Scene.role("heading", { name: "Team health over time" })).toBeAbsent(),
        );
      });

      it("ignores an overview that belongs to a Team the user has navigated away from", () => {
        const model = {
          ...initialModel(teamUrl),
          session: signedInAdmin,
          teamDetail: { _tag: "Loaded" as const, detail: detailWith(true) },
        };
        const stale = update(
          model,
          Message.GotTeamOverview({
            outcome: {
              _tag: "Success",
              overview: { ...overview, teamId: decodeTeamId("team-other") },
            },
          }),
        );
        expect(stale.model.teamOverview).toEqual({ _tag: "Loading" });

        const current = update(model, Message.GotTeamOverview({ outcome: { _tag: "Success", overview } }));
        expect(current.model.teamOverview).toEqual({ _tag: "Loaded", overview });
      });

      it("loads the overview alongside the Team when the Team page opens", () => {
        const result = update(
          { ...initialModel(teamUrl), session: signedInAdmin },
          Message.UrlChanged({ url: teamUrl }),
        );
        expect(result.model.teamOverview).toEqual({ _tag: "Loading" });
        expect(result.commands?.map((command) => command.name)).toEqual(["GetTeam", "GetTeamOverviewCmd"]);
      });
    });
  });

  describe("History screen", () => {
    const historyUrl = makeUrl("https://app.surveybeat.com/history");
    const teamId = decodeTeamId("team-1");
    const roundA = Schema.decodeSync(RoundId)("round-a");
    const roundB = Schema.decodeSync(RoundId)("round-b");
    const roundC = Schema.decodeSync(RoundId)("round-c");
    const ratingVersion = decodeVersionId("qv-rating");
    const choiceVersion = decodeVersionId("qv-choice");
    const longVersion = decodeVersionId("qv-long");

    const shownRound: HistoryRound = {
      roundId: roundA,
      teamId,
      teamName: "Platform",
      pulseName: "Weekly check-in",
      plannedOpenDate: "2026-11-02",
      teamResult: "shown",
      questions: [
        {
          questionVersionId: ratingVersion,
          position: 1,
          text: "How clear are the priorities?",
          type: { _tag: "Rating", lowLabel: "Unclear", highLabel: "Clear", comment: true },
          teamScore: 3.8,
        },
        {
          questionVersionId: choiceVersion,
          position: 2,
          text: "Which tool do you use most?",
          type: { _tag: "SingleChoice", options: ["Email", "Chat"] },
          teamScore: null,
        },
        {
          questionVersionId: longVersion,
          position: 3,
          text: "Anything else?",
          type: { _tag: "LongText" },
          teamScore: null,
        },
      ],
    };

    const soloRound = (
      roundId: RoundId,
      pulseName: string,
      teamResult: HistoryRound["teamResult"],
    ): HistoryRound => ({
      roundId,
      teamId,
      teamName: "Platform",
      pulseName,
      plannedOpenDate: "2026-10-26",
      teamResult,
      questions: [
        {
          questionVersionId: ratingVersion,
          position: 1,
          text: "How clear are the priorities?",
          type: { _tag: "Rating", lowLabel: "Unclear", highLabel: "Clear", comment: false },
          teamScore: null,
        },
      ],
    });

    // The kept answers this device holds for shownRound: a Rating with a comment, a choice, and a long text.
    const kept = {
      "round-a": {
        "qv-rating": { value: 4, comment: "Priorities keep changing" },
        "qv-choice": { value: 1 },
        "qv-long": { comment: "Nothing more" },
      },
    };

    const loaded = (rounds: ReadonlyArray<HistoryRound>, keptAnswers: KeptAnswers, cleared = false) => ({
      ...initialModel(historyUrl),
      session: signedInAdmin,
      history: {
        _tag: "Loaded" as const,
        history: { rounds },
        kept: keptAnswers,
        cleared,
      },
    });

    it("loads the history when the screen opens", () => {
      const result = update(
        { ...initialModel(makeUrl("https://app.surveybeat.com/teams")), session: signedInAdmin },
        Message.UrlChanged({ url: historyUrl }),
      );
      expect(result.model.history).toEqual({ _tag: "Loading" });
      expect(result.commands?.map((command) => command.name)).toEqual(["GetMyHistoryCmd"]);
    });

    it("ignores a history response after the user has left the screen", () => {
      const model = { ...initialModel(makeUrl("https://app.surveybeat.com/teams")), session: signedInAdmin };
      const stale = update(
        model,
        Message.GotMyHistory({ outcome: { _tag: "Success", history: { rounds: [shownRound] }, kept } }),
      );
      expect(stale.model.history).toEqual({ _tag: "Loading" });
    });

    it("shows the member's own answers beside the Team's score", () => {
      const meta = message("history.round.meta", {
        team: "Platform",
        date: formatDate(new Date("2026-11-02T12:00:00Z")),
      });
      Scene.scene(
        { update, view },
        Scene.given(loaded([shownRound], kept)),
        Scene.expect(Scene.role("heading", { name: "Weekly check-in" })).toExist(),
        Scene.expect(Scene.text(meta)).toExist(),
        Scene.expect(Scene.text("4 · Good")).toExist(),
        Scene.expect(Scene.text("3.8 of 5")).toExist(),
        Scene.expect(Scene.text("Your comment: Priorities keep changing")).toExist(),
        Scene.expect(Scene.text("Chat")).toExist(),
        Scene.expect(Scene.text("Nothing more")).toExist(),
        Scene.expect(Scene.text(message("history.noAnswersHere"))).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Clear my answers on this device" })).toExist(),
      );
    });

    it("says so when no Round's answers are on this device", () => {
      Scene.scene(
        { update, view },
        Scene.given(loaded([soloRound(roundB, "Monthly pulse", "shown")], {})),
        Scene.expect(Scene.text(message("history.noAnswersHere"))).toExist(),
        Scene.expect(Scene.text("Not on this device")).toExist(),
        Scene.expect(Scene.role("button", { name: "Clear my answers on this device" })).toBeAbsent(),
      );
    });

    it("shows the team result line and no score when the Team's scores are not shared or too few", () => {
      Scene.scene(
        { update, view },
        Scene.given(
          loaded(
            [
              soloRound(roundB, "Monthly pulse", "notShared"),
              soloRound(roundC, "Quarterly pulse", "belowMinimumGroupSize"),
            ],
            {},
          ),
        ),
        Scene.expect(Scene.text(message("history.team.notShared"))).toExist(),
        Scene.expect(Scene.text(message("history.team.belowMinimum"))).toExist(),
        Scene.expect(Scene.text(message("history.team.hidden"))).toBeAbsent(),
      );
    });

    it("clears the kept answers when asked and says so", () => {
      Scene.scene(
        { update, view },
        Scene.given(loaded([shownRound], kept)),
        Scene.click(Scene.role("button", { name: "Clear my answers on this device" })),
        Scene.Command.expectHas(ClearKeptAnswersCmd),
        Scene.Command.resolve(ClearKeptAnswersCmd, Message.ClearedKeptAnswers()),
        Scene.expect(Scene.text(message("history.cleared"))).toExist(),
        Scene.expect(Scene.text("Chat")).toBeAbsent(),
        Scene.expect(Scene.text("Priorities keep changing")).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Clear my answers on this device" })).toBeAbsent(),
      );
    });

    it("links to My history from the navigation", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/teams")),
          session: signedInAdmin,
          teams: { _tag: "Loaded", teams: [] },
        }),
        Scene.expect(Scene.role("link", { name: "My history" })).toExist(),
      );
    });
  });

  describe("Settings screen", () => {
    it("renders organization settings and updates minimum group size", () => {
      const personId = decodePersonId("person-1");
      const settings = {
        name: "Acme",
        minimumGroupSize: decodeSize(4),
        aiProcessing: false,
        defaultLocale: "en" as const,
        people: [
          {
            personId,
            email: decodeEmail("alice@acme.com"),
            organizationAdmin: false,
            linked: true,
          },
        ],
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings")),
          session: signedInAdmin,
          settings: { _tag: "Loaded", settings },
          size: "4",
        }),
        Scene.expect(Scene.role("heading", { name: "Organization settings" })).toExist(),
        Scene.expect(Scene.text("alice@acme.com")).toExist(),
        Scene.expect(Scene.role("button", { name: "Make admin" })).toExist(),
        Scene.type(Scene.label("Minimum group size"), "5"),
        Scene.click(Scene.role("button", { name: "Save" })),
        Scene.Command.expectHas(UpdateSettings),
        Scene.Command.resolve(UpdateSettings, Message.UpdatedSettings({ outcome: { _tag: "Success" } })),
        Scene.Command.expectHas(GetSettings),
        Scene.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: {
              _tag: "Success",
              settings: { ...settings, minimumGroupSize: decodeSize(5) },
            },
          }),
        ),
      );
    });
  });

  describe("AI processing setting", () => {
    it("turns AI processing on and reloads the settings", () => {
      const personId = decodePersonId("person-1");
      const settings = {
        name: "Acme",
        minimumGroupSize: decodeSize(4),
        aiProcessing: false,
        defaultLocale: "en" as const,
        people: [
          {
            personId,
            email: decodeEmail("alice@acme.com"),
            organizationAdmin: false,
            linked: true,
          },
        ],
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings")),
          session: signedInAdmin,
          settings: { _tag: "Loaded", settings },
          size: "4",
        }),
        Scene.expect(Scene.text("AI processing")).toExist(),
        Scene.click(Scene.role("checkbox", { name: "Turn on AI themes and discussion guides" })),
        Scene.Command.expectHas(UpdateAiProcessing),
        Scene.Command.resolve(
          UpdateAiProcessing,
          Message.UpdatedAiProcessing({ outcome: { _tag: "Success" } }),
        ),
        Scene.Command.expectHas(GetSettings),
        Scene.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: {
              _tag: "Success",
              settings: { ...settings, aiProcessing: true },
            },
          }),
        ),
      );
    });
  });

  describe("Pulses list screen", () => {
    it("renders pulse list and creates a pulse", () => {
      const teamId = decodeTeamId("team-1");
      const pulseId = decodePulseId("pulse-1");

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/pulses`)),
          session: signedInAdmin,
          pulses: {
            _tag: "Loaded",
            pulses: {
              team: {
                id: teamId,
                name: "Engineering",
                timeZone: decodeTimeZone("UTC"),
                yourRole: "lead",
              },
              pulses: [
                {
                  id: pulseId,
                  name: "Weekly Pulse",
                  cadence: { _tag: "Weekly", day: "friday", time: decodeSendTime("09:00") },
                  questionCount: 4,
                  estimatedSeconds: 60,
                },
              ],
            },
          },
        }),
        Scene.expect(Scene.text("Weekly Pulse")).toExist(),
        Scene.expect(Scene.role("button", { name: "Create a Pulse" })).toExist(),
        Scene.click(Scene.role("button", { name: "Create a Pulse" })),
        Scene.Command.expectHas(CreatePulse),
        Scene.Command.resolve(
          CreatePulse,
          Message.CreatedPulse({
            outcome: {
              _tag: "Success",
              detail: {
                id: decodePulseId("pulse-2"),
                team: {
                  id: teamId,
                  name: "Engineering",
                  timeZone: decodeTimeZone("UTC"),
                  yourRole: "lead",
                },
                settings: {
                  name: "Pulse 2",
                  cadence: { _tag: "Weekly", day: "friday", time: decodeSendTime("09:00") },
                  answerWindowDays: 3,
                  reminders: 1,
                  anonymityMode: "anonymous",
                  distribution: "invitation",
                },
                questions: [],
                estimatedSeconds: 0,
                warnings: [],
                templateQuestions: [],
              },
            },
          }),
        ),
        Scene.Command.expectHas(Navigate),
        Scene.Command.resolve(Navigate, Message.Navigated()),
      );
    });
  });

  describe("Pulse editor screen", () => {
    it("renders editor and interacts with questions and settings", () => {
      const teamId = decodeTeamId("team-1");
      const pulseId = decodePulseId("pulse-1");
      const q1Id = decodeQuestionId("q-1");

      const detail = {
        id: pulseId,
        team: {
          id: teamId,
          name: "Engineering",
          timeZone: decodeTimeZone("UTC"),
          yourRole: "lead" as const,
        },
        settings: {
          name: "Sprint Pulse",
          cadence: { _tag: "Weekly" as const, day: "monday" as const, time: decodeSendTime("09:00") },
          answerWindowDays: 3,
          reminders: 1,
          anonymityMode: "anonymous" as const,
          distribution: "invitation" as const,
        },
        questions: [
          {
            questionId: q1Id,
            versionId: decodeVersionId("v-1"),
            templateKey: decodeTemplateKey("workload"),
            text: "How was your workload this week?",
            type: { _tag: "Rating" as const, lowLabel: "Light", highLabel: "Heavy", comment: true },
            dimension: "workload" as const,
            hasAnswers: false,
            estimatedSeconds: 15,
          },
        ],
        estimatedSeconds: 15,
        warnings: [],
        templateQuestions: [
          {
            key: decodeTemplateKey("clarity"),
            text: "Goals were clear",
            dimension: "clarity" as const,
            type: { _tag: "Rating" as const, lowLabel: "Disagree", highLabel: "Agree", comment: true },
            estimatedSeconds: 15,
          },
        ],
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/pulses/${pulseId}`)),
          session: signedInAdmin,
          pulseDetail: { _tag: "Loaded", detail },
          settingsName: detail.settings.name,
          settingsDay: detail.settings.cadence.day,
          settingsTime: detail.settings.cadence.time,
          settingsWindow: detail.settings.answerWindowDays,
          settingsReminders: detail.settings.reminders,
        }),
        Scene.expect(Scene.text("How was your workload this week?")).toExist(),
        Scene.expect(Scene.role("heading", { name: "Settings" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Edit" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Remove" })).toExist(),
        // Add template question
        Scene.click(Scene.role("button", { name: "Add" })),
        Scene.Command.expectHas(AddQuestionCmd),
        Scene.Command.resolve(AddQuestionCmd, Message.UpdatedPulse({ outcome: { _tag: "Success", detail } })),
        // Remove question
        Scene.click(Scene.role("button", { name: "Remove" })),
        Scene.Command.expectHas(RemoveQuestionCmd),
        Scene.Command.resolve(
          RemoveQuestionCmd,
          Message.UpdatedPulse({
            outcome: { _tag: "Success", detail: { ...detail, questions: [] } },
          }),
        ),
        // Save settings
        Scene.type(Scene.label("Name"), "Updated Pulse Name"),
        Scene.click(Scene.role("button", { name: "Save settings" })),
        Scene.Command.expectHas(UpdatePulseSettingsCmd),
        Scene.Command.resolve(
          UpdatePulseSettingsCmd,
          Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
        ),
      );
    });
  });

  describe("Results screen", () => {
    it("renders results for a closed round with scores, trends, and comments", () => {
      const teamId = decodeTeamId("team-1");
      const roundId = Schema.decodeSync(RoundId)("round-1");
      const pulseId = decodePulseId("pulse-1");
      const qvId = decodeVersionId("qv-1");

      const mockResult: RoundResult = {
        roundId,
        pulseId,
        teamId,
        status: "closed",
        plannedOpenDate: "2026-11-09",
        anonymityMode: "anonymous",
        closedAt: 1731140000000,
        effectiveMinimumGroupSize: 4,
        meetsMinimumGroupSize: true,
        eligibleMembersCount: 8,
        submissionsCount: 6,
        responseRate: 0.75,
        delayed: false,
        questions: [
          {
            questionVersionId: qvId,
            position: 0,
            text: "How are you feeling?",
            type: { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: true },
            dimension: "clarity",
            contributors: 6,
            meetsMinimumGroupSize: true,
            score: 4.2,
            distribution: [
              { option: 3, count: 1 },
              { option: 4, count: 3 },
              { option: 5, count: 2 },
            ],
            change: {
              change: 0.4,
              previousRoundDate: "2026-11-02",
              previousRoundId: null,
              highlight: {
                isLargerThanUsual: true,
                direction: "rise",
                label: "Bigger change",
                explanation: "Score rose by 0.4",
              },
            },
            typicalChange: {
              status: "buildingBaseline",
              completedUsableRounds: 3,
              totalRequiredUsableRounds: 6,
              typicalChange: null,
            },
            trend: [
              {
                roundId,
                plannedOpenDate: "2026-11-09",
                score: 4.2,
                contributors: 6,
                hasGap: false,
              },
            ],
          },
        ],
        dimensions: [
          {
            dimension: "clarity",
            score: 4.2,
            usableQuestionCount: 1,
            contributors: 6,
            totalQuestionCount: 1,
            meetsMinimumGroupSize: true,
            change: {
              change: 0.4,
              previousRoundDate: "2026-11-02",
              previousRoundId: null,
              matchedQuestionCount: 1,
              currentQuestionCount: 1,
              annotation: null,
              highlight: null,
            },
            typicalChange: {
              status: "buildingBaseline",
              completedUsableRounds: 3,
              totalRequiredUsableRounds: 6,
              typicalChange: null,
            },
            trend: [
              {
                roundId,
                plannedOpenDate: "2026-11-09",
                score: 4.2,
                usableQuestionCount: 1,
                hasGap: false,
              },
            ],
          },
        ],
        comments: [
          {
            questionVersionId: qvId,
            text: "Great progress this week!",
          },
        ],
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`)),
          session: signedInAdmin,
          results: { _tag: "Loaded", result: mockResult },
        }),
        Scene.expect(Scene.role("heading", { name: "Results" })).toExist(),
        Scene.expect(Scene.text("75% response rate (6 of 8)")).toExist(),
        Scene.expect(
          Scene.text(
            "6 of 8 people checked in. This Team is still building its baseline, so no change is judged yet.",
          ),
        ).toExist(),
        Scene.expect(Scene.text("How are you feeling?")).toExist(),
        Scene.expect(Scene.text("Great progress this week!")).toExist(),
        Scene.expect(Scene.text("6 people, above your minimum of 4.")).toExist(),
        Scene.expect(Scene.role("heading", { name: "How this page protects people" })).toExist(),
        Scene.expect(Scene.text("Anonymous Rounds store answers without a name or a time.")).toExist(),
        Scene.expect(Scene.text("A number appears only when at least 4 people contributed to it.")).toExist(),
        Scene.expect(
          Scene.text(
            "Names, emails, phone numbers and links are removed from comments before they're saved.",
          ),
        ).toExist(),
        Scene.expect(
          Scene.text(
            "Only people in this Team see these Results. Organization admins don't, unless they're in the Team.",
          ),
        ).toExist(),
        // Toggle table view
        Scene.click(Scene.role("button", { name: "Table view" })),
        Scene.expect(Scene.role("button", { name: "Chart view" })).toExist(),
      );
    });

    it("renders sub-N placeholder when response count is below N", () => {
      const teamId = decodeTeamId("team-1");
      const roundId = Schema.decodeSync(RoundId)("round-subn");
      const pulseId = decodePulseId("pulse-1");

      const mockSubNResult: RoundResult = {
        roundId,
        pulseId,
        teamId,
        status: "closed",
        plannedOpenDate: "2026-11-09",
        anonymityMode: "anonymous",
        closedAt: 1731140000000,
        effectiveMinimumGroupSize: 4,
        meetsMinimumGroupSize: false,
        eligibleMembersCount: 8,
        submissionsCount: 2,
        responseRate: 0.25,
        delayed: false,
        questions: [],
        dimensions: [],
        comments: [],
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`)),
          session: signedInAdmin,
          results: { _tag: "Loaded", result: mockSubNResult },
        }),
        Scene.expect(Scene.text("Not enough answers to protect anonymity")).toExist(),
      );
    });

    it("renders open notice and response count only for open round", () => {
      const teamId = decodeTeamId("team-1");
      const roundId = Schema.decodeSync(RoundId)("round-open");
      const pulseId = decodePulseId("pulse-1");

      const mockOpenResult: RoundResult = {
        roundId,
        pulseId,
        teamId,
        status: "open",
        plannedOpenDate: "2026-11-09",
        anonymityMode: "anonymous",
        closedAt: null,
        effectiveMinimumGroupSize: 4,
        meetsMinimumGroupSize: true,
        eligibleMembersCount: 8,
        submissionsCount: 3,
        responseRate: 0.375,
        delayed: false,
        questions: [],
        dimensions: [],
        comments: [],
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`)),
          session: signedInAdmin,
          results: { _tag: "Loaded", result: mockOpenResult },
        }),
        Scene.expect(Scene.text("3 Submissions received so far.")).toExist(),
      );
    });

    it("renders Actions on Results screen and allows Lead to commit an action", () => {
      const teamId = decodeTeamId("team-1");
      const roundId = Schema.decodeSync(RoundId)("round-1");
      const pulseId = decodePulseId("pulse-1");
      const personId = decodePersonId("person-1");
      const actionId = Schema.decodeSync(ActionId)("action-1");

      const mockResult: RoundResult = {
        roundId,
        pulseId,
        teamId,
        status: "closed",
        plannedOpenDate: "2026-11-09",
        anonymityMode: "anonymous",
        closedAt: 1731140000000,
        effectiveMinimumGroupSize: 4,
        meetsMinimumGroupSize: true,
        eligibleMembersCount: 8,
        submissionsCount: 6,
        responseRate: 0.75,
        delayed: false,
        questions: [],
        dimensions: [],
        comments: [],
      };

      const mockTeamDetail = {
        team: {
          id: teamId,
          name: "Platform",
          timeZone: decodeTimeZone("Europe/Berlin"),
          yourRole: "lead" as const,
        },
        roster: [
          {
            personId,
            email: decodeEmail("grace@example.com"),
            role: "lead" as const,
            since: 1700000000000,
          },
        ],
        abilities: {
          update: true,
          manageLeads: true,
          manageMembers: true,
          managePulses: true,
          viewResults: true,
        },
      };

      const committedAction: ActionItem = {
        id: actionId,
        teamId,
        roundId,
        title: "Shorten pairing sessions",
        ownerId: personId,
        ownerEmail: decodeEmail("grace@example.com"),
        dueDate: "2026-11-20",
        dimension: "workload",
        status: "committed",
        createdAt: 1731145000000,
        updatedAt: 1731145000000,
        doneAt: null,
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`)),
          session: signedInAdmin,
          results: { _tag: "Loaded", result: mockResult },
          teamDetail: { _tag: "Loaded", detail: mockTeamDetail },
          actions: { _tag: "Loaded", actions: [] },
        }),
        Scene.expect(Scene.role("heading", { name: "Actions" })).toExist(),
        Scene.expect(Scene.text("No actions committed yet.")).toExist(),
        // Lead sees commit form
        Scene.expect(Scene.role("heading", { name: "Commit an action" })).toExist(),
        // Enter title
        Scene.type(Scene.label("Action title"), "Shorten pairing sessions"),
        // Submit
        Scene.click(Scene.role("button", { name: "Commit action" })),
        Scene.Command.expectHas(CreateActionCmd),
        Scene.Command.resolve(
          CreateActionCmd,
          Message.CreatedAction({
            outcome: { _tag: "Success", action: committedAction },
          }),
        ),
        Scene.expect(Scene.text("Shorten pairing sessions")).toExist(),
        Scene.expect(Scene.text("Committed")).toExist(),
        Scene.expect(Scene.role("button", { name: "Mark done" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Drop" })).toExist(),
        // Click Mark done
        Scene.click(Scene.role("button", { name: "Mark done" })),
        Scene.Command.expectHas(UpdateActionCmd),
        Scene.Command.resolve(
          UpdateActionCmd,
          Message.UpdatedAction({
            outcome: {
              _tag: "Success",
              action: { ...committedAction, status: "done", doneAt: 1731150000000 },
            },
          }),
        ),
        Scene.expect(Scene.text("Done")).toExist(),
        Scene.expect(Scene.role("button", { name: "Reopen" })).toExist(),
      );
    });

    it("renders Actions on sub-N results screen without gating", () => {
      const teamId = decodeTeamId("team-1");
      const roundId = Schema.decodeSync(RoundId)("round-subn");
      const pulseId = decodePulseId("pulse-1");

      const mockSubNResult: RoundResult = {
        roundId,
        pulseId,
        teamId,
        status: "closed",
        plannedOpenDate: "2026-11-09",
        anonymityMode: "anonymous",
        closedAt: 1731140000000,
        effectiveMinimumGroupSize: 4,
        meetsMinimumGroupSize: false,
        eligibleMembersCount: 8,
        submissionsCount: 2,
        responseRate: 0.25,
        delayed: false,
        questions: [],
        dimensions: [],
        comments: [],
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`)),
          session: signedInAdmin,
          results: { _tag: "Loaded", result: mockSubNResult },
          actions: { _tag: "Loaded", actions: [] },
        }),
        Scene.expect(Scene.text("Not enough answers to protect anonymity")).toExist(),
        Scene.expect(Scene.role("heading", { name: "Actions" })).toExist(),
      );
    });
  });

  describe("Note from your Lead", () => {
    const teamId = decodeTeamId("team-1");
    const roundId = Schema.decodeSync(RoundId)("round-note");
    const pulseId = decodePulseId("pulse-1");
    const personId = decodePersonId("person-1");
    const url = makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`);

    const closedResult: RoundResult = {
      roundId,
      pulseId,
      teamId,
      status: "closed",
      plannedOpenDate: "2026-11-09",
      anonymityMode: "anonymous",
      closedAt: 1731140000000,
      effectiveMinimumGroupSize: 4,
      meetsMinimumGroupSize: true,
      eligibleMembersCount: 8,
      submissionsCount: 6,
      responseRate: 0.75,
      delayed: false,
      questions: [],
      dimensions: [],
      comments: [],
    };

    const teamDetailFor = (yourRole: "lead" | "member") => ({
      team: {
        id: teamId,
        name: "Platform",
        timeZone: decodeTimeZone("Europe/Berlin"),
        yourRole,
      },
      roster: [
        {
          personId,
          email: decodeEmail("grace@example.com"),
          role: "lead" as const,
          since: 1700000000000,
        },
      ],
      abilities: {
        update: yourRole === "lead",
        manageLeads: yourRole === "lead",
        manageMembers: yourRole === "lead",
        managePulses: yourRole === "lead",
        viewResults: true,
      },
    });

    const noteText = "We agreed to shorten pairing sessions.";
    const updatedAt = 1731150000000;
    const savedNote = {
      roundId,
      text: noteText,
      updatedAt,
    };

    it("lets the Lead write a Note, save it, and then see it with its date", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(url),
          session: signedInAdmin,
          results: { _tag: "Loaded", result: closedResult },
          teamDetail: { _tag: "Loaded", detail: teamDetailFor("lead") },
          actions: { _tag: "Loaded", actions: [] },
          roundNote: { _tag: "Loaded", note: null },
        }),
        Scene.expect(Scene.role("heading", { name: "Note from your Lead" })).toExist(),
        Scene.expect(
          Scene.text("After you talk with the Team, write down what you agreed. The Team sees it here."),
        ).toExist(),
        Scene.click(Scene.role("button", { name: "Write note" })),
        Scene.type(Scene.label("Note"), noteText),
        Scene.click(Scene.role("button", { name: "Save note" })),
        Scene.Command.expectHas(SaveRoundNoteCmd({ teamId, roundId, text: noteText })),
        Scene.Command.resolve(
          SaveRoundNoteCmd,
          Message.SavedNote({ outcome: { _tag: "Success", view: { roundId, note: savedNote } } }),
        ),
        Scene.expect(Scene.text(noteText)).toExist(),
        Scene.expect(Scene.text(`Last changed ${formatDate(new Date(updatedAt))}`)).toExist(),
        Scene.expect(Scene.role("button", { name: "Edit note" })).toExist(),
      );
    });

    it("shows a member the Note text and date without any edit control", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(url),
          session: signedInAdmin,
          results: { _tag: "Loaded", result: closedResult },
          teamDetail: { _tag: "Loaded", detail: teamDetailFor("member") },
          actions: { _tag: "Loaded", actions: [] },
          roundNote: { _tag: "Loaded", note: savedNote },
        }),
        Scene.expect(Scene.role("heading", { name: "Note from your Lead" })).toExist(),
        Scene.expect(Scene.text(noteText)).toExist(),
        Scene.expect(Scene.text(`Last changed ${formatDate(new Date(updatedAt))}`)).toExist(),
        Scene.expect(Scene.role("button", { name: "Edit note" })).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Write note" })).toBeAbsent(),
      );
    });

    it("hides the Note section from a member when the Lead has written no Note", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(url),
          session: signedInAdmin,
          results: { _tag: "Loaded", result: closedResult },
          teamDetail: { _tag: "Loaded", detail: teamDetailFor("member") },
          actions: { _tag: "Loaded", actions: [] },
          roundNote: { _tag: "Loaded", note: null },
        }),
        Scene.expect(Scene.role("heading", { name: "Note from your Lead" })).toBeAbsent(),
        Scene.expect(
          Scene.text("After you talk with the Team, write down what you agreed. The Team sees it here."),
        ).toBeAbsent(),
      );
    });

    it("blocks saving and shows a too-long message when the Lead's draft exceeds 2,000 characters", () => {
      const tooLong = "x".repeat(2001);
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(url),
          session: signedInAdmin,
          results: { _tag: "Loaded", result: closedResult },
          teamDetail: { _tag: "Loaded", detail: teamDetailFor("lead") },
          actions: { _tag: "Loaded", actions: [] },
          roundNote: { _tag: "Loaded", note: null },
        }),
        Scene.click(Scene.role("button", { name: "Write note" })),
        Scene.type(Scene.label("Note"), tooLong),
        Scene.expect(Scene.text("2,001 of 2,000 characters")).toExist(),
        Scene.expect(Scene.text("Notes can be up to 2,000 characters. Shorten yours to save it.")).toExist(),
        Scene.expect(Scene.role("button", { name: "Save note" })).toBeDisabled(),
      );
    });

    it("hides the Note section on an open Round, even for the Lead", () => {
      const openResult: RoundResult = {
        ...closedResult,
        status: "open",
        closedAt: null,
        submissionsCount: 3,
        responseRate: 0.375,
      };
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(url),
          session: signedInAdmin,
          results: { _tag: "Loaded", result: openResult },
          teamDetail: { _tag: "Loaded", detail: teamDetailFor("lead") },
          actions: { _tag: "Loaded", actions: [] },
          roundNote: { _tag: "Loaded", note: savedNote },
        }),
        Scene.expect(Scene.text("3 Submissions received so far.")).toExist(),
        Scene.expect(Scene.role("heading", { name: "Note from your Lead" })).toBeAbsent(),
        Scene.expect(Scene.text(noteText)).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Edit note" })).toBeAbsent(),
      );
    });

    it("keeps the editor and draft open after a failed save and leaves Save enabled", () => {
      const draft = "We agreed to shorten pairing sessions.";
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(url),
          session: signedInAdmin,
          results: { _tag: "Loaded", result: closedResult },
          teamDetail: { _tag: "Loaded", detail: teamDetailFor("lead") },
          actions: { _tag: "Loaded", actions: [] },
          roundNote: { _tag: "Loaded", note: null },
        }),
        Scene.click(Scene.role("button", { name: "Write note" })),
        Scene.type(Scene.label("Note"), draft),
        Scene.click(Scene.role("button", { name: "Save note" })),
        Scene.Command.expectHas(SaveRoundNoteCmd({ teamId, roundId, text: draft })),
        Scene.Command.resolve(
          SaveRoundNoteCmd,
          Message.SavedNote({ outcome: { _tag: "Failure", failure: "Forbidden" } }),
        ),
        Scene.expect(Scene.text("You can't do that here.")).toExist(),
        Scene.expect(Scene.label("Note")).toHaveValue(draft),
        Scene.expect(Scene.role("button", { name: "Save note" })).toBeEnabled(),
        Scene.expect(Scene.role("button", { name: "Cancel" })).toBeEnabled(),
      );
    });
  });

  describe("Rounds screen", () => {
    const teamId = decodeTeamId("team-1");
    const pulseId = decodePulseId("pulse-1");
    const personId = decodePersonId("person-9");
    const openId = Schema.decodeSync(RoundId)("round-open");
    const closedId = Schema.decodeSync(RoundId)("round-closed");
    const scheduledId = Schema.decodeSync(RoundId)("round-scheduled");
    const url = makeUrl(`https://app.surveybeat.com/teams/${teamId}/pulses/${pulseId}/rounds`);

    const summary = (id: RoundId, status: RoundSummary["status"], plannedOpenDate: string): RoundSummary => ({
      id,
      pulseId,
      teamId,
      status,
      plannedOpenDate,
      plannedOpenAt: 1731140000000,
      openedAt: status === "scheduled" ? null : 1731140000000,
      plannedCloseAt: 1731400000000,
      closedAt: status === "closed" ? 1731400000000 : null,
      pulseName: "Weekly check-in",
    });
    const rounds = {
      pulseId,
      rounds: [
        summary(scheduledId, "scheduled", "2026-11-16"),
        summary(openId, "open", "2026-11-09"),
        summary(closedId, "closed", "2026-11-02"),
      ],
    };
    const teamAs = (yourRole: "lead" | "member" | null) => ({
      team: { id: teamId, name: "Platform", timeZone: decodeTimeZone("Europe/Berlin"), yourRole },
      roster: [],
      may: {
        update: false,
        manageLeads: false,
        manageMembers: false,
        managePulses: true,
        viewResults: false,
      },
    });
    const openDetail: RoundDetail = {
      id: openId,
      pulseId,
      team: teamAs("lead").team,
      status: "open",
      plannedOpenDate: "2026-11-09",
      plannedOpenAt: 1731140000000,
      openedAt: 1731140000000,
      plannedCloseAt: 1731400000000,
      closedAt: null,
      effectiveMinimumGroupSize: 4,
      pulseName: "Weekly check-in",
      answerWindowDays: 3,
      reminders: 1,
      anonymityMode: "anonymous",
      distribution: "invitation",
      questions: [],
      failedInvitations: [
        { personId, email: decodeEmail("ada@example.com"), reason: "Mailbox full", resendCount: 0 },
      ],
      createdAt: 1731100000000,
    };
    const given = (yourRole: "lead" | "member" | null) => ({
      ...initialModel(url),
      session: signedInAdmin,
      teamDetail: { _tag: "Loaded" as const, detail: teamAs(yourRole) },
      rounds: { _tag: "Loaded" as const, list: rounds },
      roundDetails: { [openId]: openDetail },
      roundRates: { [closedId]: 0.75 },
    });

    const reload = () =>
      Scene.Command.resolveAll(
        [ListRoundsCmd, Message.GotRounds({ outcome: { _tag: "Success", list: rounds } })],
        [
          GetRoundDetailCmd,
          Message.GotRoundDetail({
            roundId: openId,
            outcome: { _tag: "Success", detail: openDetail },
          }),
        ],
        [
          GetRoundRateCmd,
          Message.GotRoundRate({
            roundId: closedId,
            outcome: { _tag: "Failure", failure: "NotFound" },
          }),
        ],
      );

    it("lists Rounds for a Lead with status, response rate, and a link to Results", () => {
      Scene.scene(
        { update, view },
        Scene.given(given("lead")),
        Scene.expect(Scene.role("heading", { name: "Rounds" })).toExist(),
        Scene.expect(Scene.text("Round 2026-11-16")).toExist(),
        Scene.expect(Scene.text("Scheduled")).toExist(),
        Scene.expect(Scene.text("Open")).toExist(),
        Scene.expect(Scene.text("Closed")).toExist(),
        Scene.expect(Scene.text("75% response rate")).toExist(),
        Scene.expect(Scene.role("link", { name: "View Results" })).toExist(),
      );
    });

    it("shows a failed Invitation with its reason and Resend calls the resend endpoint", () => {
      Scene.scene(
        { update, view },
        Scene.given(given("lead")),
        Scene.expect(Scene.text("ada@example.com: Mailbox full")).toExist(),
        Scene.click(Scene.role("button", { name: "Resend" })),
        Scene.Command.expectHas(ResendInvitationCmd),
        Scene.Command.resolve(
          ResendInvitationCmd,
          Message.RoundCommandDone({ outcome: { _tag: "Success" } }),
        ),
        Scene.Command.expectHas(ListRoundsCmd),
        reload(),
      );
    });

    it("skips the Scheduled week, pauses, and resumes through the Rounds endpoints", () => {
      Scene.scene(
        { update, view },
        Scene.given(given("lead")),
        Scene.click(Scene.role("button", { name: "Skip this week" })),
        Scene.Command.expectHas(SkipWeekCmd),
        Scene.Command.resolve(SkipWeekCmd, Message.RoundCommandDone({ outcome: { _tag: "Success" } })),
        Scene.Command.expectHas(ListRoundsCmd),
        reload(),
        Scene.click(Scene.role("button", { name: "Pause Pulse" })),
        Scene.Command.expectHas(PausePulseCmd),
        Scene.Command.resolve(PausePulseCmd, Message.RoundCommandDone({ outcome: { _tag: "Success" } })),
        reload(),
        Scene.click(Scene.role("button", { name: "Resume Pulse" })),
        Scene.Command.expectHas(ResumePulseCmd),
        Scene.Command.resolve(ResumePulseCmd, Message.RoundCommandDone({ outcome: { _tag: "Success" } })),
        reload(),
      );
    });

    it("asks before closing a Round early and only then calls the endpoint", () => {
      Scene.scene(
        { update, view },
        Scene.given(given("lead")),
        Scene.click(Scene.role("button", { name: "Close early" })),
        Scene.Command.expectNone(),
        Scene.expect(
          Scene.text("Close this Round now? Members who were not yet invited are never invited."),
        ).toExist(),
        Scene.click(Scene.role("button", { name: "Yes, continue" })),
        Scene.Command.expectHas(CloseRoundEarlyCmd),
        Scene.Command.resolve(CloseRoundEarlyCmd, Message.RoundCommandDone({ outcome: { _tag: "Success" } })),
        reload(),
      );
    });

    it("asks before cancelling a Round, and Keep Round dismisses without a call", () => {
      Scene.scene(
        { update, view },
        Scene.given(given("lead")),
        Scene.click(Scene.role("button", { name: "Cancel Round" })),
        Scene.Command.expectNone(),
        Scene.expect(Scene.role("button", { name: "Keep Round" })).toExist(),
        Scene.click(Scene.role("button", { name: "Keep Round" })),
        Scene.Command.expectNone(),
        Scene.expect(Scene.role("button", { name: "Keep Round" })).toBeAbsent(),
        Scene.click(Scene.role("button", { name: "Cancel Round" })),
        Scene.click(Scene.role("button", { name: "Yes, continue" })),
        Scene.Command.expectHas(CancelRoundCmd),
        Scene.Command.resolve(CancelRoundCmd, Message.RoundCommandDone({ outcome: { _tag: "Success" } })),
        reload(),
      );
    });

    it("shows an Organization admin the list but no controls, Resend, or Results link", () => {
      Scene.scene(
        { update, view },
        Scene.given(given(null)),
        Scene.expect(Scene.text("Round 2026-11-09")).toExist(),
        Scene.expect(Scene.role("button", { name: "Close early" })).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Cancel Round" })).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Skip this week" })).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Pause Pulse" })).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Resend" })).toBeAbsent(),
        Scene.expect(Scene.role("link", { name: "View Results" })).toBeAbsent(),
      );
    });

    it("shows a Member the Forbidden problem and no controls", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...given("member"),
          rounds: { _tag: "Failed" as const, failure: "Forbidden" as const },
        }),
        Scene.expect(Scene.role("alert")).toExist(),
        Scene.expect(Scene.role("button", { name: "Close early" })).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Pause Pulse" })).toBeAbsent(),
      );
    });
  });

  describe("Privacy page", () => {
    it("renders privacy page when signed out", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy")),
          session: { _tag: "SignedOut", failed: false },
        }),
        Scene.expect(Scene.role("heading", { name: "Privacy at SurveyBeat" })).toExist(),
        Scene.expect(Scene.role("heading", { name: "Anonymous submissions" })).toExist(),
        Scene.expect(Scene.role("heading", { name: "Comment redaction" })).toExist(),
        Scene.expect(Scene.role("heading", { name: "30-day point-in-time restore window" })).toExist(),
        Scene.expect(Scene.role("heading", { name: "Changing your answers" })).toExist(),
        Scene.expect(Scene.role("heading", { name: "Who can trigger a restore" })).toExist(),
        Scene.expect(Scene.role("link", { name: "Back" })).toExist(),
      );
    });

    it("renders privacy link on sign in page", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/")),
          session: { _tag: "SignedOut", failed: false },
        }),
        Scene.expect(Scene.role("link", { name: "Privacy" })).toExist(),
      );
    });
  });

  describe("Language", () => {
    const teamsUrl = makeUrl("https://app.surveybeat.com/");
    const signedIn = (locale: Locale | null, organizationLocale: Locale): SessionModel => ({
      _tag: "SignedIn",
      organization: { id: decodeOrgId("org-1"), name: "Acme" },
      organizationAdmin: true,
      locale,
      detectedLocale: null,
      organizationLocale,
    });

    it("shows the screens in the Person's language", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(teamsUrl),
          session: { ...signedInAdmin, locale: "de" as const },
          teams: { _tag: "Loaded", teams: [] },
        }),
        Scene.expect(Scene.role("link", { name: "Organisationseinstellungen" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Abmelden" })).toExist(),
        Scene.expect(Scene.text("Du bist noch in keinem Team.")).toExist(),
        Scene.expect(Scene.label("Sprache")).toExist(),
      );
    });

    it("falls back to the Organization's default language when the Person has no choice", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(teamsUrl),
          browserLocale: null,
          session: { ...signedInAdmin, organizationLocale: "de" as const },
          teams: { _tag: "Loaded", teams: [] },
        }),
        Scene.expect(Scene.text("Du bist noch in keinem Team.")).toExist(),
        Scene.expect(Scene.label("Sprache")).toExist(),
      );
    });

    it("switches the screens when the Person picks a language", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(teamsUrl),
          session: signedInAdmin,
          teams: { _tag: "Loaded", teams: [] },
        }),
        Scene.change(Scene.label("Language"), "de"),
        Scene.Command.expectHas(UpdateOwnLanguage),
        Scene.expect(Scene.label("Sprache")).toExist(),
        Scene.Command.resolve(
          UpdateOwnLanguage,
          Message.UpdatedOwnLanguage({ chosen: true, outcome: { _tag: "Success" } }),
        ),
        Scene.Command.expectHas(LoadSession),
        Scene.Command.resolve(
          LoadSession,
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization: { id: decodeOrgId("org-1"), name: "Acme" },
              organizationAdmin: true,
              locale: "de",
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Scene.Command.expectHas(ListTeams),
        Scene.Command.resolve(ListTeams, Message.GotTeams({ outcome: { _tag: "Success", teams: [] } })),
        Scene.expect(Scene.label("Sprache")).toExist(),
      );
    });

    it("offers the Organization's default language on the settings screen", () => {
      const settings = {
        name: "Acme",
        minimumGroupSize: decodeSize(4),
        aiProcessing: false,
        defaultLocale: "en" as const,
        people: [],
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings")),
          session: signedInAdmin,
          settings: { _tag: "Loaded", settings },
          size: "4",
        }),
        Scene.expect(Scene.label("Default language")).toExist(),
        Scene.change(Scene.label("Default language"), "de"),
        Scene.Command.expectHas(UpdateDefaultLanguage),
        Scene.Command.resolve(
          UpdateDefaultLanguage,
          Message.UpdatedDefaultLanguage({ outcome: { _tag: "Failure", failure: "Forbidden" } }),
        ),
        Scene.expect(Scene.role("alert")).toExist(),
      );
    });

    describe("localeOf", () => {
      const modelWith = (browser: Locale | null, session: SessionModel) => ({
        ...initialModel(teamsUrl),
        browserLocale: browser,
        session,
      });

      it("prefers the Person's choice, then the browser's language, then the Organization's default", () => {
        expect(localeOf(modelWith("en", signedIn("de", "en")))).toBe("de");
        expect(localeOf(modelWith("de", signedIn(null, "en")))).toBe("de");
        expect(localeOf(modelWith("en", signedIn(null, "de")))).toBe("en");
        expect(localeOf(modelWith(null, signedIn(null, "de")))).toBe("de");
      });

      it("uses the browser's language, then English, when signed out", () => {
        expect(localeOf(modelWith("de", { _tag: "SignedOut", failed: false }))).toBe("de");
        expect(localeOf(modelWith(null, { _tag: "SignedOut", failed: false }))).toBe("en");
      });
    });
  });
});
