import {
  ActionId,
  type ActionItem,
  EmailAddress,
  type EmailSendProgress,
  type FailedEmailStatus,
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
  SendId,
  SendTime,
  TeamId,
  type TeamOverview,
  type TestSendStatus,
  TemplateQuestionKey,
  TimeZone,
} from "@surveybeat/domain";
import { Popover } from "@foldkit/ui";
import { Option, Schema } from "effect";
import * as Scene from "foldkit/scene";
import { setup } from "foldkit/test/vitest";
import { fromString } from "foldkit/url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Model,
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
  CopyGuideTextCmd,
  CreateTeam,
  GetRoundDetailCmd,
  GetResultsCmd,
  GetRoundRateCmd,
  GetSettings,
  GetTeam,
  initialModel,
  ListRoundsCmd,
  ListTeams,
  LoadSession,
  localeOf,
  PollFailedEmailCmd,
  PollTestSendCmd,
  Message,
  Navigate,
  PausePulseCmd,
  RemoveMember,
  RemoveQuestionCmd,
  ResendFailedEmailCmd,
  ResendInvitationCmd,
  ResumePulseCmd,
  RetryResultCmd,
  SaveRoundNoteCmd,
  ShareResultsCmd,
  SkipWeekCmd,
  update,
  UpdateActionCmd,
  SendTestInvitationCmd,
  UpdatePulseSettingsCmd,
  UpdateAiProcessing,
  UpdateDefaultLanguage,
  UpdateOwnLanguage,
  UpdateSettings,
  UpdateTeam,
  view,
} from "./App.ts";
import { formatDate, formatRoundDate, message, setLocale } from "../messages/locale.ts";
import type { FailedEmailResend } from "./directory.ts";
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
const decodeSendId = Schema.decodeSync(SendId);

const makeUrl = (str: string) => Option.getOrThrow(fromString(str));

beforeEach(() => {
  // No browser language unless a test sets one, so the default flows issue no language commands.
  vi.stubGlobal("navigator", { languages: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

/** Opens the header's account menu, where the Language choice and Sign out are. */
const openAccountMenu = (organization: string, menu = "Account menu") => [
  Scene.click(Scene.role("button", { name: `${organization} ${menu}` })),
  Scene.Mount.resolve(Popover.AnchorPopover, Popover.Message.CompletedAnchorPopover()),
];

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
    it("opens the Create Team form from its button and closes it without doing anything", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/")),
          session: signedInAdmin,
          teams: { _tag: "Loaded", teams: [] },
        }),
        Scene.expect(Scene.role("heading", { name: "Create a Team" })).toBeAbsent(),
        Scene.expect(Scene.text("No Team yet")).toExist(),
        Scene.expect(Scene.text("You're not in any Team yet.")).toExist(),
        Scene.click(Scene.role("button", { name: "Create Team" })),
        Scene.expect(Scene.role("heading", { name: "Create a Team" })).toExist(),
        Scene.click(Scene.role("button", { name: "Cancel" })),
        Scene.expect(Scene.role("heading", { name: "Create a Team" })).toBeAbsent(),
      );
    });

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
        Scene.expect(Scene.role("heading", { name: "Create a Team" })).toBeAbsent(),
        Scene.click(Scene.role("button", { name: "Create Team" })),
        Scene.expect(Scene.role("heading", { name: "Create a Team" })).toExist(),
        Scene.type(Scene.label("Team name"), "Design"),
        Scene.change(Scene.label("Time zone"), "UTC"),
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
        Scene.click(Scene.role("button", { name: "Rename Team" })),
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
        Scene.click(Scene.role("button", { name: "Add member" })),
        Scene.type(Scene.label("Add a member by email"), "bob@acme.com"),
        Scene.click(Scene.role("button", { name: "Add member" })),
        Scene.Command.expectHas(AddMember),
        Scene.Command.resolve(AddMember, Message.AddedMember({ outcome: { _tag: "Success" } })),
        Scene.Command.expectHas(GetTeam),
        Scene.Command.resolve(GetTeam, Message.GotTeam({ outcome: { _tag: "Success", detail } })),
        // Assign lead
        Scene.click(Scene.role("button", { name: "Assign Lead" })),
        Scene.type(Scene.label("Assign a Lead by email"), "carol@acme.com"),
        Scene.click(Scene.role("button", { name: "Assign Lead" })),
        Scene.Command.expectHas(AssignLead),
        Scene.Command.resolve(AssignLead, Message.AssignedLead({ outcome: { _tag: "Success" } })),
        Scene.Command.expectHas(GetTeam),
        Scene.Command.resolve(GetTeam, Message.GotTeam({ outcome: { _tag: "Success", detail } })),
        // Remove member: the first press asks, the second one does it
        Scene.click(Scene.role("button", { name: "Remove" })),
        Scene.expect(Scene.role("alertdialog", { name: "Remove?" })).toExist(),
        Scene.expect(Scene.text("Remove alice@acme.com from this Team?")).toExist(),
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

    it("asks before removing a member, and Escape or Cancel leave the roster alone", () => {
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
        }),
        Scene.click(Scene.role("button", { name: "Remove" })),
        Scene.expect(Scene.role("alertdialog", { name: "Remove?" })).toExist(),
        Scene.keydown(Scene.role("alertdialog", { name: "Remove?" }), "Escape"),
        Scene.expect(Scene.role("alertdialog", { name: "Remove?" })).toBeAbsent(),
        Scene.expect(Scene.text("alice@acme.com")).toExist(),
        Scene.Command.expectNone(),
        Scene.click(Scene.role("button", { name: "Remove" })),
        Scene.click(Scene.role("button", { name: "Cancel" })),
        Scene.expect(Scene.role("alertdialog", { name: "Remove?" })).toBeAbsent(),
        Scene.expect(Scene.text("alice@acme.com")).toExist(),
        Scene.Command.expectNone(),
      );
    });

    describe("First-run checklist", () => {
      const teamId = decodeTeamId("team-1");
      const pulseId = Schema.decodeSync(PulseId)("pulse-1");
      const roundId = Schema.decodeSync(RoundId)("round-1");
      const detail = {
        team: {
          id: teamId,
          name: "Acme",
          timeZone: decodeTimeZone("UTC"),
          yourRole: "lead" as const,
        },
        roster: [
          {
            personId: decodePersonId("person-1"),
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
      const pulse = {
        id: pulseId,
        name: "Weekly check-in",
        cadence: { _tag: "Weekly" as const, day: "monday" as const, time: decodeSendTime("09:00") },
        questionCount: 3,
        estimatedSeconds: 90,
      };

      it("walks a new Team through members, Pulse, test and first Round", () => {
        Scene.scene(
          { update, view },
          Scene.given({
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}`)),
            session: signedInAdmin,
            teamDetail: { _tag: "Loaded", detail },
            pulses: {
              _tag: "Loaded",
              pulses: { team: detail.team, pulses: [] },
            },
          }),
          Scene.expect(Scene.role("heading", { name: "Get to your first Round" })).toExist(),
          Scene.expect(Scene.text("Add your Team")).toExist(),
          Scene.expect(Scene.text("1 so far")).toExist(),
          Scene.expect(Scene.text("Create a Pulse")).toExist(),
          Scene.expect(Scene.text("Send yourself a test")).toExist(),
          Scene.expect(Scene.text("First Round")).toExist(),
          Scene.expect(Scene.text("Done")).toExist(),
          Scene.expect(Scene.text("To do")).toExist(),
        );
      });

      it("marks the test done and names the first Round once one is scheduled", () => {
        const plannedOpenDate = "2026-11-09";
        Scene.scene(
          { update, view },
          Scene.given({
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}`)),
            session: signedInAdmin,
            teamDetail: { _tag: "Loaded", detail },
            pulses: {
              _tag: "Loaded",
              pulses: { team: detail.team, pulses: [pulse] },
            },
            rounds: {
              _tag: "Loaded",
              list: {
                pulseId,
                paused: false,
                rounds: [
                  {
                    id: roundId,
                    pulseId,
                    teamId,
                    status: "scheduled" as const,
                    plannedOpenDate,
                    plannedOpenAt: Date.parse("2026-11-09T09:00:00Z"),
                    openedAt: null,
                    plannedCloseAt: Date.parse("2026-11-13T09:00:00Z"),
                    closedAt: null,
                    pulseName: "Weekly check-in",
                  },
                ],
              },
            },
          }),
          Scene.expect(Scene.text(`First Round on ${formatRoundDate(plannedOpenDate)}`)).toExist(),
          Scene.expect(Scene.role("heading", { name: "Get to your first Round" })).toExist(),
        );
      });

      it("disappears once a Round has been shared", () => {
        Scene.scene(
          { update, view },
          Scene.given({
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}`)),
            session: signedInAdmin,
            teamDetail: { _tag: "Loaded", detail },
            pulses: {
              _tag: "Loaded",
              pulses: { team: detail.team, pulses: [pulse] },
            },
            rounds: {
              _tag: "Loaded",
              list: {
                pulseId,
                paused: false,
                rounds: [
                  {
                    id: roundId,
                    pulseId,
                    teamId,
                    status: "closed" as const,
                    plannedOpenDate: "2026-11-02",
                    plannedOpenAt: Date.parse("2026-11-02T09:00:00Z"),
                    openedAt: Date.parse("2026-11-02T09:00:00Z"),
                    plannedCloseAt: Date.parse("2026-11-06T09:00:00Z"),
                    closedAt: Date.parse("2026-11-06T09:00:00Z"),
                    pulseName: "Weekly check-in",
                  },
                ],
              },
            },
          }),
          Scene.expect(Scene.role("heading", { name: "Get to your first Round" })).toBeAbsent(),
        );
      });
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
          { roundId: roundA, plannedOpenDate: "2026-10-26", pulseName: "Weekly check-in" },
          { roundId: roundB, plannedOpenDate: "2026-11-02", pulseName: "Weekly check-in" },
          { roundId: roundC, plannedOpenDate: "2026-11-09", pulseName: "Weekly check-in" },
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
        expect(result.commands?.map((command) => command.name)).toEqual([
          "GetTeam",
          "GetTeamOverviewCmd",
          "ListPulses",
        ]);
      });

      it("links the newest shared Round from the Team page and lists the recent ones", () => {
        Scene.scene(
          { update, view },
          Scene.given({
            ...initialModel(teamUrl),
            session: signedInAdmin,
            teamDetail: { _tag: "Loaded", detail: detailWith(true) },
            teamOverview: { _tag: "Loaded", overview },
          }),
          Scene.expect(Scene.role("heading", { name: "Latest Results" })).toExist(),
          Scene.expect(Scene.role("link", { name: "View Results" })).toExist(),
          Scene.expect(Scene.role("heading", { name: "Recent Rounds" })).toExist(),
          Scene.expect(
            Scene.role("link", { name: `Weekly check-in · ${formatRoundDate("2026-11-09")}` }),
          ).toExist(),
          Scene.expect(
            Scene.role("link", { name: `Weekly check-in · ${formatRoundDate("2026-10-26")}` }),
          ).toExist(),
        );
      });

      it("shows no Results entry point to someone who may not read Results", () => {
        Scene.scene(
          { update, view },
          Scene.given({
            ...initialModel(teamUrl),
            session: signedInAdmin,
            teamDetail: { _tag: "Loaded", detail: detailWith(false) },
            teamOverview: { _tag: "Loaded", overview },
          }),
          Scene.expect(Scene.role("heading", { name: "Latest Results" })).toBeAbsent(),
          Scene.expect(Scene.role("link", { name: "View Results" })).toBeAbsent(),
        );
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
        "qv-rating": { value: 5, comment: "Priorities keep changing" },
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
        Scene.expect(Scene.text("5 · Clear")).toExist(),
        Scene.expect(Scene.text("3.8 of 5")).toExist(),
        Scene.expect(Scene.text("Your comment: Priorities keep changing")).toExist(),
        Scene.expect(Scene.text("Chat")).toExist(),
        Scene.expect(Scene.text("Nothing more")).toExist(),
        Scene.expect(Scene.text(message("history.noAnswersHere"))).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Clear my answers on this device" })).toExist(),
      );
    });

    it("shows the Question's own labels at 1 and 5 and a plain number from 2 to 4", () => {
      const expectations: ReadonlyArray<readonly [number, string]> = [
        [1, "1 · Unclear"],
        [3, "3"],
        [5, "5 · Clear"],
      ];
      for (const [value, text] of expectations) {
        Scene.scene(
          { update, view },
          Scene.given(
            loaded([soloRound(roundB, "Monthly pulse", "shown")], { "round-b": { "qv-rating": { value } } }),
          ),
          Scene.expect(Scene.text(text)).toExist(),
        );
      }
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

    it("links a shared Round to its Results", () => {
      Scene.scene(
        { update, view },
        Scene.given(loaded([shownRound], kept)),
        Scene.expect(Scene.role("link", { name: message("history.viewResults") })).toExist(),
      );
    });

    it("does not link a Round whose Results the member may not see", () => {
      Scene.scene(
        { update, view },
        Scene.given(loaded([soloRound(roundB, "Monthly pulse", "notShared")], {})),
        Scene.expect(Scene.role("link", { name: message("history.viewResults") })).toBeAbsent(),
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
        Scene.expect(Scene.label("Minimum group size")).toBeAbsent(),
        Scene.click(Scene.role("button", { name: "Change minimum group size" })),
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

  describe("Failed emails", () => {
    const settings = {
      name: "Acme",
      minimumGroupSize: decodeSize(4),
      aiProcessing: false,
      defaultLocale: "en" as const,
      people: [],
    };
    const failedAt = 1_800_000_000_000;

    it("shows that no email has failed", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings")),
          session: signedInAdmin,
          settings: { _tag: "Loaded", settings },
          size: "4",
          failedEmails: { _tag: "Loaded", list: { emails: [] } },
        }),
        Scene.expect(Scene.role("heading", { name: "Failed emails" })).toExist(),
        Scene.expect(Scene.text("No failed emails.")).toExist(),
      );
    });

    it("lists each failed send with its kind, recipient, reason, code, and time", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings")),
          session: signedInAdmin,
          settings: { _tag: "Loaded", settings },
          size: "4",
          failedEmails: {
            _tag: "Loaded",
            list: {
              emails: [
                {
                  sendId: decodeSendId("send-1"),
                  kind: "TestInvitationEmail",
                  recipient: decodeEmail("ada@acme.com"),
                  reason: "rejected",
                  code: "E_SENDER_NOT_VERIFIED",
                  failedAt,
                  resendable: true,
                },
                {
                  sendId: decodeSendId("send-2"),
                  kind: "ReminderEmail",
                  recipient: decodeEmail("grace@acme.com"),
                  reason: "unknown",
                  code: null,
                  failedAt,
                  resendable: false,
                },
              ],
            },
          },
        }),
        Scene.expect(Scene.role("heading", { name: "Failed emails" })).toExist(),
        Scene.expect(Scene.text("Test invitation")).toExist(),
        Scene.expect(Scene.text("ada@acme.com")).toExist(),
        Scene.expect(Scene.text("the email service refused it (E_SENDER_NOT_VERIFIED)")).toExist(),
        Scene.expect(Scene.text("Reminder")).toExist(),
        Scene.expect(Scene.text("grace@acme.com")).toExist(),
        Scene.expect(Scene.text("the outcome is unknown")).toExist(),
        Scene.expect(
          Scene.text(formatDate(new Date(failedAt), { dateStyle: "medium", timeStyle: "short" })),
        ).toExist(),
        Scene.expect(Scene.text("No failed emails.")).toBeAbsent(),
      );
    });

    it("shows a load failure as a short error line", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings")),
          session: signedInAdmin,
          settings: { _tag: "Loaded", settings },
          size: "4",
          failedEmails: { _tag: "Failed", failure: "Unavailable" },
        }),
        Scene.expect(Scene.role("heading", { name: "Failed emails" })).toExist(),
        Scene.expect(Scene.text("Something went wrong. Try again in a moment.")).toExist(),
      );
    });

    describe("resending a failed send", () => {
      const sendId = decodeSendId("send-1");
      const failedRow = (resendable: boolean) => ({
        sendId,
        kind: "ReminderEmail" as const,
        recipient: decodeEmail("ada@acme.com"),
        reason: "rejected" as const,
        code: "E_SENDER_NOT_VERIFIED",
        failedAt,
        resendable,
      });
      const listedModel = (resendable = true, resends: Record<string, FailedEmailResend> = {}) => ({
        ...initialModel(makeUrl("https://app.surveybeat.com/settings")),
        session: signedInAdmin,
        settings: { _tag: "Loaded" as const, settings },
        size: "4",
        failedEmails: { _tag: "Loaded" as const, list: { emails: [failedRow(resendable)] } },
        failedEmailResends: resends,
      });
      const resendStatus = (state: EmailSendProgress): FailedEmailStatus => ({ sendId, state });
      const resent = (state: EmailSendProgress) =>
        Message.ResentFailedEmail({ sendId, outcome: { _tag: "Success", status: resendStatus(state) } });
      const polled = (state: EmailSendProgress) =>
        Message.PolledFailedEmail({ sendId, outcome: { _tag: "Success", status: resendStatus(state) } });
      const resendClick = Scene.click(Scene.role("button", { name: "Resend" }));
      const queued: EmailSendProgress = { _tag: "Queued", attempts: 0, lastCode: null };

      it("offers Resend only on a row that can be resent", () => {
        Scene.scene(
          { update, view },
          Scene.given(listedModel(false)),
          Scene.expect(Scene.text("ada@acme.com")).toExist(),
          Scene.expect(Scene.role("button", { name: "Resend" })).toBeAbsent(),
        );
      });

      it("sends the Resend once, and shows it as busy while it is in flight", () => {
        Scene.scene(
          { update, view },
          Scene.given(listedModel()),
          resendClick,
          Scene.Command.expectHas(ResendFailedEmailCmd({ sendId })),
          Scene.expect(Scene.role("button", { name: "Resending…" })).toBeDisabled(),
          Scene.Command.resolve(
            ResendFailedEmailCmd({ sendId }),
            Message.ResentFailedEmail({ sendId, outcome: { _tag: "Failure", failure: "Unavailable" } }),
          ),
        );
      });

      it("ignores a second Resend while the first is in flight or still queued", () => {
        const first = update(listedModel(), Message.ResendFailedEmailClicked({ sendId }));
        expect(first.commands?.map((command) => command.name)).toEqual(["ResendFailedEmailCmd"]);
        const second = update(first.model, Message.ResendFailedEmailClicked({ sendId }));
        expect(second.commands?.length ?? 0).toBe(0);
        const queuedModel = update(first.model, resent(queued));
        const third = update(queuedModel.model, Message.ResendFailedEmailClicked({ sendId }));
        expect(third.commands?.length ?? 0).toBe(0);
      });

      it("shows a queued Resend, checks it again, and shows that it was sent", () => {
        Scene.scene(
          { update, view },
          Scene.given(listedModel()),
          resendClick,
          Scene.Command.resolve(ResendFailedEmailCmd({ sendId }), resent(queued)),
          Scene.expect(Scene.text("Queued…")).toExist(),
          Scene.expect(Scene.role("button", { name: "Resend" })).toBeAbsent(),
          Scene.Command.expectHas(PollFailedEmailCmd({ sendId })),
          Scene.Command.resolve(PollFailedEmailCmd({ sendId }), polled({ _tag: "Sent", sentAt: failedAt })),
          Scene.expect(Scene.text("Sent")).toExist(),
          Scene.Command.expectNone(),
        );
      });

      it("shows that a resent email is being sent", () => {
        Scene.scene(
          { update, view },
          Scene.given(listedModel()),
          resendClick,
          Scene.Command.resolve(ResendFailedEmailCmd({ sendId }), resent(queued)),
          Scene.Command.resolve(PollFailedEmailCmd({ sendId }), polled({ _tag: "Sending", attempt: 1 })),
          Scene.expect(Scene.text("Sending…")).toExist(),
          Scene.Command.expectHas(PollFailedEmailCmd({ sendId })),
          Scene.Command.resolve(PollFailedEmailCmd({ sendId }), polled({ _tag: "Sent", sentAt: failedAt })),
        );
      });

      it("shows why a resent email failed again, and offers Resend again", () => {
        Scene.scene(
          { update, view },
          Scene.given(listedModel()),
          resendClick,
          Scene.Command.resolve(ResendFailedEmailCmd({ sendId }), resent(queued)),
          Scene.Command.resolve(
            PollFailedEmailCmd({ sendId }),
            polled({ _tag: "Failed", reason: "rejected", code: "E_SENDER_NOT_VERIFIED", failedAt }),
          ),
          Scene.expect(
            Scene.text("Not sent: the email service refused it (E_SENDER_NOT_VERIFIED)"),
          ).toExist(),
          Scene.expect(Scene.role("button", { name: "Resend" })).toBeEnabled(),
          Scene.Command.expectNone(),
        );
      });

      it("says the email can no longer be sent when the server refuses the Resend", () => {
        Scene.scene(
          { update, view },
          Scene.given(listedModel()),
          resendClick,
          Scene.Command.resolve(
            ResendFailedEmailCmd({ sendId }),
            Message.ResentFailedEmail({
              sendId,
              outcome: { _tag: "Failure", failure: "EmailNotResendable" },
            }),
          ),
          Scene.expect(Scene.text("This email can no longer be sent.")).toExist(),
          Scene.expect(Scene.role("button", { name: "Resend" })).toBeAbsent(),
          Scene.Command.expectNone(),
        );
      });

      it("says the Resend failed and re-enables Resend when the request fails", () => {
        Scene.scene(
          { update, view },
          Scene.given(listedModel()),
          resendClick,
          Scene.Command.resolve(
            ResendFailedEmailCmd({ sendId }),
            Message.ResentFailedEmail({ sendId, outcome: { _tag: "Failure", failure: "Unavailable" } }),
          ),
          Scene.expect(Scene.text("Couldn't resend. Try again.")).toExist(),
          Scene.expect(Scene.role("button", { name: "Resend" })).toBeEnabled(),
          Scene.Command.expectNone(),
        );
      });

      it("says the status could not be read and stops checking when a read fails", () => {
        Scene.scene(
          { update, view },
          Scene.given(listedModel()),
          resendClick,
          Scene.Command.resolve(ResendFailedEmailCmd({ sendId }), resent(queued)),
          Scene.Command.resolve(
            PollFailedEmailCmd({ sendId }),
            Message.PolledFailedEmail({ sendId, outcome: { _tag: "Failure", failure: "NotFound" } }),
          ),
          Scene.expect(Scene.text("Couldn't check the status. Reload the page to check again.")).toExist(),
          Scene.Command.expectNone(),
        );
      });

      it("stops checking a resent email that is still queued after fifteen minutes", () => {
        const waiting = listedModel(true, {
          [sendId]: { _tag: "Resent", state: queued, polls: 299, statusUnavailable: false },
        });
        const last = update(waiting, polled(queued));
        expect(last.commands?.length ?? 0).toBe(0);
        // Still queued when it gives up: the row says to reload.
        expect(last.model.failedEmailResends[sendId]).toMatchObject({ statusUnavailable: true });
        const earlier = update(
          listedModel(true, {
            [sendId]: { _tag: "Resent", state: queued, polls: 298, statusUnavailable: false },
          }),
          polled(queued),
        );
        expect(earlier.commands?.map((command) => command.name)).toEqual(["PollFailedEmailCmd"]);
      });
    });

    it("loads the failed emails when the settings screen opens", () => {
      const result = update(
        { ...initialModel(makeUrl("https://app.surveybeat.com/teams")), session: signedInAdmin },
        Message.UrlChanged({ url: makeUrl("https://app.surveybeat.com/settings") }),
      );
      expect(result.model.failedEmails).toEqual({ _tag: "Loading" });
      expect(result.commands?.map((command) => command.name)).toEqual(["GetSettings", "ListFailedEmails"]);
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
    it("names the empty state instead of showing a blank list", () => {
      const teamId = decodeTeamId("team-1");
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
              pulses: [],
            },
          },
        }),
        Scene.expect(Scene.text("No Pulse yet")).toExist(),
        Scene.expect(Scene.text("This Team has no Pulse yet.")).toExist(),
      );
    });

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
                  reviewWindowDays: 3,
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
          reviewWindowDays: 3,
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
          settingsReviewWindow: detail.settings.reviewWindowDays,
          settingsReminders: detail.settings.reminders,
        }),
        Scene.expect(Scene.text("1. How was your workload this week?")).toExist(),
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
        Scene.expect(Scene.label("Review window")).toExist(),
        Scene.change(Scene.label("Review window"), "0"),
        Scene.type(Scene.label("Name"), "Updated Pulse Name"),
        Scene.click(Scene.role("button", { name: "Save settings" })),
        Scene.Command.expectHas(
          UpdatePulseSettingsCmd({
            teamId,
            pulseId,
            settings: {
              ...detail.settings,
              name: "Updated Pulse Name",
              reviewWindowDays: 0,
            },
          }),
        ),
        Scene.Command.resolve(
          UpdatePulseSettingsCmd,
          Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
        ),
      );
    });
  });

  describe("Send me a test", () => {
    const teamId = decodeTeamId("team-1");
    const pulseId = decodePulseId("pulse-1");
    const detail = {
      id: pulseId,
      team: { id: teamId, name: "Engineering", timeZone: decodeTimeZone("UTC"), yourRole: "lead" as const },
      settings: {
        name: "Sprint Pulse",
        cadence: { _tag: "Weekly" as const, day: "monday" as const, time: decodeSendTime("09:00") },
        answerWindowDays: 3,
        reviewWindowDays: 3,
        reminders: 1,
        anonymityMode: "anonymous" as const,
        distribution: "invitation" as const,
      },
      questions: [
        {
          questionId: decodeQuestionId("q-1"),
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
      templateQuestions: [],
    };
    const editorModel = () => ({
      ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/pulses/${pulseId}`)),
      session: signedInAdmin,
      pulseDetail: { _tag: "Loaded" as const, detail },
      settingsName: detail.settings.name,
      settingsDay: detail.settings.cadence.day,
      settingsTime: detail.settings.cadence.time,
      settingsWindow: detail.settings.answerWindowDays,
      settingsReviewWindow: detail.settings.reviewWindowDays,
      settingsReminders: detail.settings.reminders,
    });

    const sendId = decodeSendId("send-1");
    /** Queue and read times of a send read `minutes` after it was queued (server clock). */
    const waited = (minutes: number) => {
      const queuedAt = 1_800_000_000_000;
      return { queuedAt, checkedAt: queuedAt + minutes * 60_000 };
    };
    const polled = (state: TestSendStatus["state"], times = waited(0), id = sendId) =>
      Message.PolledTestSend({ sendId: id, outcome: { _tag: "Success", status: { ...times, state } } });
    const pollCmd = () => PollTestSendCmd({ teamId, pulseId, sendId });
    /** Sends a test and lets the send succeed, so the editor's first status read is pending. */
    const sentSteps = [
      Scene.click(Scene.role("button", { name: "Send me a test" })),
      Scene.Command.resolve(
        SendTestInvitationCmd,
        Message.SentTestInvitation({
          outcome: { _tag: "Success", email: decodeEmail("ada@acme.com"), sendId, pulseId },
        }),
      ),
    ];

    it("sends the test to the sender, shows the address it went to, and checks its state", () => {
      Scene.scene(
        { update, view },
        Scene.given(editorModel()),
        Scene.click(Scene.role("button", { name: "Send me a test" })),
        Scene.Command.expectHas(SendTestInvitationCmd({ teamId, pulseId })),
        Scene.expect(Scene.role("button", { name: "Send me a test" })).toBeDisabled(),
        Scene.Command.resolve(
          SendTestInvitationCmd,
          Message.SentTestInvitation({
            outcome: { _tag: "Success", email: decodeEmail("ada@acme.com"), sendId, pulseId },
          }),
        ),
        Scene.expect(
          Scene.text("Test email to ada@acme.com requested. Answers to a test are never saved."),
        ).toExist(),
        Scene.expect(Scene.text("Queued…")).toExist(),
        Scene.expect(Scene.role("button", { name: "Send me a test" })).toBeEnabled(),
        Scene.Command.expectHas(pollCmd()),
        Scene.Command.resolve(pollCmd(), polled({ _tag: "Sent", sentAt: 1_800_000_000_000 })),
      );
    });

    it("shows a queued test and checks it again", () => {
      Scene.scene(
        { update, view },
        Scene.given(editorModel()),
        ...sentSteps,
        Scene.Command.resolve(pollCmd(), polled({ _tag: "Queued", attempts: 0, lastCode: null })),
        Scene.expect(Scene.text("Queued…")).toExist(),
        Scene.Command.expectHas(pollCmd()),
        Scene.Command.resolve(pollCmd(), polled({ _tag: "Sent", sentAt: 1_800_000_000_000 })),
      );
    });

    it("says when a test has been queued for five minutes or more, and keeps checking", () => {
      Scene.scene(
        { update, view },
        Scene.given(editorModel()),
        ...sentSteps,
        Scene.Command.resolve(pollCmd(), polled({ _tag: "Queued", attempts: 0, lastCode: null }, waited(6))),
        Scene.expect(
          Scene.text("Still queued after 6 minutes. The email service may not be processing sends."),
        ).toExist(),
        Scene.Command.expectHas(pollCmd()),
        Scene.Command.resolve(pollCmd(), polled({ _tag: "Sent", sentAt: 1_800_000_000_000 })),
      );
    });

    it("shows that a test is being sent", () => {
      Scene.scene(
        { update, view },
        Scene.given(editorModel()),
        ...sentSteps,
        Scene.Command.resolve(pollCmd(), polled({ _tag: "Sending", attempt: 1 })),
        Scene.expect(Scene.text("Sending…")).toExist(),
        Scene.Command.expectHas(pollCmd()),
        Scene.Command.resolve(pollCmd(), polled({ _tag: "Sent", sentAt: 1_800_000_000_000 })),
      );
    });

    it("shows that a test was sent and stops checking", () => {
      Scene.scene(
        { update, view },
        Scene.given(editorModel()),
        ...sentSteps,
        Scene.Command.resolve(pollCmd(), polled({ _tag: "Sent", sentAt: 1_800_000_000_000 })),
        Scene.expect(Scene.text("Sent. Check your inbox (and spam folder).")).toExist(),
        Scene.Command.expectNone(),
      );
    });

    it("shows why a test failed, with its code, and stops checking", () => {
      Scene.scene(
        { update, view },
        Scene.given(editorModel()),
        ...sentSteps,
        Scene.Command.resolve(
          pollCmd(),
          polled({ _tag: "Failed", reason: "rejected", code: "E_SENDER_NOT_VERIFIED", failedAt: 1 }),
        ),
        Scene.expect(Scene.text("Not sent: the email service refused it (E_SENDER_NOT_VERIFIED)")).toExist(),
        Scene.Command.expectNone(),
      );
    });

    it("stops checking a test that is still queued after fifteen minutes", () => {
      Scene.scene(
        { update, view },
        Scene.given(editorModel()),
        ...sentSteps,
        Scene.Command.resolve(pollCmd(), polled({ _tag: "Queued", attempts: 0, lastCode: null }, waited(15))),
        Scene.expect(
          Scene.text("Still queued after 15 minutes. The email service may not be processing sends."),
        ).toExist(),
        Scene.Command.expectNone(),
      );
    });

    it("ignores a read for a test that is no longer the one on screen", () => {
      Scene.scene(
        { update, view },
        Scene.given(editorModel()),
        ...sentSteps,
        Scene.Command.resolve(
          pollCmd(),
          polled({ _tag: "Sent", sentAt: 1_800_000_000_000 }, waited(0), decodeSendId("send-0")),
        ),
        Scene.expect(Scene.text("Queued…")).toExist(),
        Scene.Command.expectNone(),
      );
    });

    it("says the state could not be read and stops checking when the read fails", () => {
      Scene.scene(
        { update, view },
        Scene.given(editorModel()),
        ...sentSteps,
        Scene.Command.resolve(
          pollCmd(),
          Message.PolledTestSend({ sendId, outcome: { _tag: "Failure", failure: "NotFound" } }),
        ),
        Scene.expect(
          Scene.text(
            "Couldn't check this test's status. Check your inbox, or see Failed emails in Organization settings.",
          ),
        ).toExist(),
        Scene.Command.expectNone(),
      );
    });

    it("shows why a test was refused when the hourly limit is reached", () => {
      Scene.scene(
        { update, view },
        Scene.given(editorModel()),
        Scene.click(Scene.role("button", { name: "Send me a test" })),
        Scene.Command.expectHas(SendTestInvitationCmd({ teamId, pulseId })),
        Scene.Command.resolve(
          SendTestInvitationCmd,
          Message.SentTestInvitation({
            outcome: { _tag: "Failure", failure: "TestSendLimitReached" },
          }),
        ),
        Scene.expect(Scene.text("You've sent 5 tests in the last hour. Try again later.")).toExist(),
        Scene.expect(Scene.role("button", { name: "Send me a test" })).toBeEnabled(),
        Scene.Command.expectNone(),
      );
    });
  });

  describe("Results screen", () => {
    const leadTeamDetail = (teamId: TeamId, yourRole: "lead" | "member" = "lead") => ({
      team: { id: teamId, name: "Platform", timeZone: decodeTimeZone("Europe/Berlin"), yourRole },
      roster: [],
      abilities: {
        update: true,
        manageLeads: true,
        manageMembers: true,
        managePulses: true,
        viewResults: true,
      },
    });

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
          teamDetail: { _tag: "Loaded", detail: leadTeamDetail(teamId) },
        }),
        Scene.expect(Scene.role("heading", { name: "Results" })).toExist(),
        Scene.expect(Scene.role("navigation", { name: message("breadcrumb.label") })).toExist(),
        Scene.expect(Scene.role("link", { name: "Platform" })).toExist(),
        Scene.expect(
          Scene.text(message("results.roundDate", { date: formatRoundDate("2026-11-09") })),
        ).toExist(),
        // The response rate is in the aside once, not repeated above the scores.
        Scene.expect(Scene.text("75%")).toExist(),
        Scene.expect(Scene.text("6 of 8")).toExist(),
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
        status: "shared",
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
          teamDetail: { _tag: "Loaded", detail: leadTeamDetail(teamId) },
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
        // Lead sees the button, and the form only once it is asked for
        Scene.expect(Scene.role("heading", { name: "Commit an action" })).toBeAbsent(),
        Scene.click(Scene.role("button", { name: "Commit an action" })),
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

    it("asks before dropping an action, and cancelling leaves it untouched", () => {
      const actionId = Schema.decodeSync(ActionId)("action-1");
      const base = {
        ...initialModel(makeUrl("https://app.surveybeat.com/teams/team-1/rounds/round-1")),
        session: signedInAdmin,
      };
      const asked = update(base, Message.AskDropAction({ actionId }));
      expect(Option.getOrUndefined(asked.model.pendingDropId)).toBe(actionId);
      expect(asked.commands ?? []).toHaveLength(0);

      const cancelled = update(asked.model, Message.DismissDropAction());
      expect(Option.getOrUndefined(cancelled.model.pendingDropId)).toBeUndefined();
      expect(cancelled.commands ?? []).toHaveLength(0);

      const confirmed = update(asked.model, Message.ConfirmDropAction());
      expect(confirmed.commands?.map((command) => command.name)).toEqual(["UpdateActionCmd"]);
    });

    it("renders Actions on sub-N results screen without gating", () => {
      const teamId = decodeTeamId("team-1");
      const roundId = Schema.decodeSync(RoundId)("round-subn");
      const pulseId = decodePulseId("pulse-1");

      const mockSubNResult: RoundResult = {
        roundId,
        pulseId,
        teamId,
        status: "shared",
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
          teamDetail: { _tag: "Loaded", detail: leadTeamDetail(teamId) },
          actions: { _tag: "Loaded", actions: [] },
        }),
        Scene.expect(Scene.text("Not enough answers to protect anonymity")).toExist(),
        Scene.expect(Scene.role("heading", { name: "Actions" })).toExist(),
      );
    });

    const trendResult = (rounds: number): RoundResult => {
      const teamId = decodeTeamId("team-1");
      const roundId = Schema.decodeSync(RoundId)("round-trend");
      const trend = Array.from({ length: rounds }, (_, i) => ({
        roundId,
        plannedOpenDate: `2026-11-${String(9 + i).padStart(2, "0")}`,
        score: 4,
        contributors: 6,
        hasGap: false,
      }));
      return {
        roundId,
        pulseId: decodePulseId("pulse-1"),
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
            questionVersionId: decodeVersionId("qv-trend"),
            position: 0,
            text: "How are you feeling?",
            type: { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: false },
            dimension: "clarity",
            contributors: 6,
            meetsMinimumGroupSize: true,
            score: 4,
            distribution: [],
            change: null,
            typicalChange: {
              status: "buildingBaseline",
              completedUsableRounds: 0,
              totalRequiredUsableRounds: 6,
              typicalChange: null,
            },
            trend,
          },
        ],
        dimensions: [
          {
            dimension: "clarity",
            score: 4,
            usableQuestionCount: 1,
            contributors: 6,
            totalQuestionCount: 1,
            meetsMinimumGroupSize: true,
            change: null,
            typicalChange: null,
            trend: trend.map((point) => ({ ...point, usableQuestionCount: 1 })),
          },
        ],
        comments: [],
      };
    };

    const trendScene = (rounds: number) =>
      Scene.given({
        ...initialModel(makeUrl("https://app.surveybeat.com/teams/team-1/rounds/round-trend")),
        session: signedInAdmin,
        results: { _tag: "Loaded" as const, result: trendResult(rounds) },
        teamDetail: { _tag: "Loaded" as const, detail: leadTeamDetail(decodeTeamId("team-1")) },
        actions: { _tag: "Loaded" as const, actions: [] },
      });

    const bareResult = (overrides: Partial<RoundResult>): RoundResult => ({
      roundId: Schema.decodeSync(RoundId)("round-bare"),
      pulseId: decodePulseId("pulse-1"),
      teamId: decodeTeamId("team-1"),
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
      ...overrides,
    });

    const bareScene = (result: RoundResult) =>
      Scene.given({
        ...initialModel(makeUrl("https://app.surveybeat.com/teams/team-1/rounds/round-bare")),
        session: signedInAdmin,
        results: { _tag: "Loaded" as const, result },
        teamDetail: { _tag: "Loaded" as const, detail: leadTeamDetail(decodeTeamId("team-1")) },
        actions: { _tag: "Loaded" as const, actions: [] },
      });

    it("puts Share with the team and the Review countdown in front of a Lead's Ready Results", () => {
      const reviewEndsAt = Date.now() + 2 * 86_400_000 - 3_600_000;
      Scene.scene(
        { update, view },
        bareScene(bareResult({ status: "ready", reviewEndsAt })),
        Scene.expect(Scene.role("heading", { name: "Only you can see these Results" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Share with the team" })).toExist(),
        Scene.expect(Scene.text("2 days left to share")).toExist(),
      );
    });

    it("keeps Note and Actions off a Round whose Results could not be computed", () => {
      Scene.scene(
        { update, view },
        bareScene(bareResult({ couldNotCompute: true })),
        Scene.expect(Scene.text("These Results couldn't be computed.")).toExist(),
        Scene.expect(Scene.role("heading", { name: "Note from your Lead" })).toBeAbsent(),
        Scene.expect(Scene.role("heading", { name: "Actions" })).toBeAbsent(),
      );
    });

    it.each([1, 4, 12])("names a %i-Round trend by its real length", (rounds) => {
      Scene.scene(
        { update, view },
        trendScene(rounds),
        Scene.expect(Scene.role("heading", { name: `${rounds}-Round trend` })).toExist(),
      );
    });

    describe("Highlights, German formats, and the Actions panel", () => {
      /** A closed Round with one flagged Question and one Dimension, so the badge and formats are on screen. */
      const flaggedResult = (direction: "rise" | "drop", questionScore: number): RoundResult => ({
        roundId: Schema.decodeSync(RoundId)("round-flagged"),
        pulseId: decodePulseId("pulse-1"),
        teamId: decodeTeamId("team-1"),
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
            questionVersionId: decodeVersionId("qv-flagged"),
            position: 0,
            text: "How are you feeling?",
            type: { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: false },
            dimension: "clarity",
            contributors: 6,
            meetsMinimumGroupSize: true,
            score: questionScore,
            distribution: [
              { option: 3, count: 1 },
              { option: 4, count: 5 },
            ],
            change: {
              change: direction === "rise" ? 0.7 : -0.7,
              previousRoundDate: "2026-11-02",
              previousRoundId: null,
              highlight: { isLargerThanUsual: true, direction },
            },
            typicalChange: {
              status: "ready",
              completedUsableRounds: 6,
              totalRequiredUsableRounds: 6,
              typicalChange: 0.3,
            },
            trend: [],
          },
        ],
        dimensions: [
          {
            dimension: "clarity",
            score: 4,
            usableQuestionCount: 1,
            contributors: 6,
            totalQuestionCount: 1,
            meetsMinimumGroupSize: true,
            change: null,
            typicalChange: null,
            trend: [],
          },
        ],
        comments: [],
      });

      const flaggedScene = (result: RoundResult, locale: Locale | null = null) =>
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/teams/team-1/rounds/round-flagged")),
          session: { ...signedInAdmin, locale },
          results: { _tag: "Loaded", result },
          teamDetail: { _tag: "Loaded", detail: leadTeamDetail(decodeTeamId("team-1")) },
          actions: { _tag: "Loaded", actions: [] },
        });

      it("draws an up arrow for a rise and explains the usual move", () => {
        Scene.scene(
          { update, view },
          flaggedScene(flaggedResult("rise", 4.2)),
          Scene.expect(Scene.text("Bigger change than usual for this team")).toExist(),
          Scene.expect(Scene.selector('[data-direction="rise"] path')).toHaveAttr("d", "M6 11V4M3 7l3-3 3 3"),
          Scene.expect(Scene.selector('[data-direction="drop"]')).toBeAbsent(),
          Scene.expect(Scene.text("Usually moves about ±0.3 between Rounds")).toExist(),
          Scene.expect(Scene.text("+0.7 since last Round (Nov 2, 2026)")).toExist(),
        );
      });

      it("draws a down arrow for a drop", () => {
        Scene.scene(
          { update, view },
          flaggedScene(flaggedResult("drop", 4.2)),
          Scene.expect(Scene.selector('[data-direction="drop"] path')).toHaveAttr("d", "M6 1v7M3 5l3 3 3-3"),
          Scene.expect(Scene.selector('[data-direction="rise"]')).toBeAbsent(),
          Scene.expect(Scene.text("-0.7 since last Round (Nov 2, 2026)")).toExist(),
        );
      });

      it("keeps the Actions heading in light text on its dark panel", () => {
        // Stands in for an axe contrast check in light mode: ink text on evergreen would be invisible.
        Scene.scene(
          { update, view },
          flaggedScene(flaggedResult("rise", 4.2)),
          Scene.expect(Scene.role("heading", { name: "Actions" })).toHaveClass("text-white"),
          Scene.expect(Scene.role("heading", { name: "Actions" })).not.toHaveClass("text-ink"),
        );
      });

      it("formats scores, changes, Round dates and percentages in German", () => {
        Scene.scene(
          { update, view },
          flaggedScene(flaggedResult("rise", 3.6), "de"),
          Scene.expect(Scene.text("Runde vom 09.11.2026")).toExist(),
          Scene.expect(Scene.text("4,0 / 5")).toExist(),
          Scene.expect(Scene.text("3,6 / 5")).toExist(),
          Scene.expect(Scene.text("+0,7 seit der letzten Runde (02.11.2026)")).toExist(),
          Scene.expect(Scene.text("Bewegt sich zwischen Runden meist um etwa ±0,3")).toExist(),
          Scene.expect(Scene.text("75\u00a0%")).toExist(),
          Scene.expect(Scene.text("6 von 8")).toExist(),
        );
      });
    });

    describe("Comment themes and discussion guide", () => {
      const teamId = decodeTeamId("team-1");
      const roundId = Schema.decodeSync(RoundId)("round-themes");
      const pulseId = decodePulseId("pulse-1");
      const qvId = decodeVersionId("qv-1");
      const url = makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`);

      const meetingResult = (overrides: Partial<RoundResult>): RoundResult => ({
        roundId,
        pulseId,
        teamId,
        status: "shared",
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
        ...overrides,
      });

      const teamDetail = (yourRole: "lead" | "member") => ({
        team: { id: teamId, name: "Platform", timeZone: decodeTimeZone("Europe/Berlin"), yourRole },
        roster: [],
        abilities: {
          update: false,
          manageLeads: false,
          manageMembers: false,
          managePulses: false,
          viewResults: true,
        },
      });

      const givenResults = (result: RoundResult, yourRole: "lead" | "member") => ({
        ...initialModel(url),
        session: signedInAdmin,
        results: { _tag: "Loaded" as const, result },
        teamDetail: { _tag: "Loaded" as const, detail: teamDetail(yourRole) },
        actions: { _tag: "Loaded" as const, actions: [] },
      });

      const guide = {
        whatStoodOut: ["Workload moved more than usual."],
        whatPeopleRaised: [],
        actionsToCheckOn: [],
        questions: ["What would make busy weeks easier?"],
      };

      it("shows a member the themes without counts, and neither the guide nor the admin line", () => {
        Scene.scene(
          { update, view },
          Scene.given(
            givenResults(
              meetingResult({
                themesStatus: "ready",
                themes: [
                  { label: "Workload", sentence: "Busy weeks leave little room for planned work." },
                  { label: "Priorities", sentence: "Several people would like clearer priorities." },
                ],
                discussionGuide: null,
              }),
              "member",
            ),
          ),
          Scene.expect(Scene.role("heading", { name: "What people raised" })).toExist(),
          Scene.expect(Scene.role("heading", { name: "Workload" })).toExist(),
          Scene.expect(Scene.text("Busy weeks leave little room for planned work.")).toExist(),
          Scene.expect(Scene.text("Several people would like clearer priorities.")).toExist(),
          Scene.expect(Scene.text("Raised in 2 comments")).toBeAbsent(),
          Scene.expect(Scene.role("heading", { name: "Discussion guide" })).toBeAbsent(),
          Scene.expect(
            Scene.text(
              "An Organization admin can turn on AI processing in Settings to get themes and a discussion guide.",
            ),
          ).toBeAbsent(),
        );
      });

      it("shows the Lead the supporting counts, the comment, and the guide, which copies as text", () => {
        Scene.scene(
          { update, view },
          Scene.given(
            givenResults(
              meetingResult({
                comments: [{ questionVersionId: qvId, text: "Great progress this week!" }],
                themesStatus: "ready",
                themes: [
                  {
                    label: "Workload",
                    sentence: "Busy weeks leave little room for planned work.",
                    supportingComments: 2,
                  },
                  {
                    label: "Priorities",
                    sentence: "Several people would like clearer priorities.",
                    supportingComments: 3,
                  },
                ],
                discussionGuide: guide,
              }),
              "lead",
            ),
          ),
          Scene.expect(Scene.text("Raised in 2 comments")).toExist(),
          Scene.expect(Scene.text("Raised in 3 comments")).toExist(),
          Scene.expect(Scene.text("Great progress this week!")).toExist(),
          Scene.expect(Scene.role("heading", { name: "Discussion guide" })).toExist(),
          Scene.expect(
            Scene.text(
              "Only you see this. Written by AI from this Round's scores, comments, and open Actions.",
            ),
          ).toExist(),
          Scene.expect(Scene.text("Workload moved more than usual.")).toExist(),
          Scene.expect(Scene.text("What would make busy weeks easier?")).toExist(),
          // Empty sections are skipped
          Scene.expect(Scene.role("heading", { name: "Actions to check on" })).toBeAbsent(),
          Scene.click(Scene.role("button", { name: "Copy as text" })),
          Scene.Command.expectHas(CopyGuideTextCmd),
          Scene.Command.resolve(CopyGuideTextCmd, Message.CopiedGuide({ ok: true })),
          Scene.expect(Scene.text("Copied.")).toExist(),
          Scene.click(Scene.role("button", { name: "Copy as text" })),
          Scene.Command.expectHas(CopyGuideTextCmd),
          Scene.Command.resolve(CopyGuideTextCmd, Message.CopiedGuide({ ok: false })),
          Scene.expect(Scene.text("Couldn't copy. Select the text and copy it instead.")).toExist(),
          Scene.expect(Scene.text("Copied.")).toBeAbsent(),
        );
      });

      for (const yourRole of ["member", "lead"] as const) {
        it(`tells a ${yourRole} that themes are being prepared`, () => {
          Scene.scene(
            { update, view },
            Scene.given(givenResults(meetingResult({ themesStatus: "preparing", themes: [] }), yourRole)),
            Scene.expect(Scene.role("heading", { name: "What people raised" })).toExist(),
            Scene.expect(Scene.text("Themes are being prepared.")).toExist(),
          );
        });
      }

      it("tells only the Lead that themes are unavailable", () => {
        const unavailable = meetingResult({ themesStatus: "unavailable", themes: [] });

        Scene.scene(
          { update, view },
          Scene.given(givenResults(unavailable, "lead")),
          Scene.expect(Scene.role("heading", { name: "What people raised" })).toExist(),
          Scene.expect(Scene.text("Themes aren't available for this Round.")).toExist(),
        );

        Scene.scene(
          { update, view },
          Scene.given(givenResults(unavailable, "member")),
          Scene.expect(Scene.role("heading", { name: "What people raised" })).toBeAbsent(),
          Scene.expect(Scene.text("Themes aren't available for this Round.")).toBeAbsent(),
        );
      });

      it("explains to the Lead, and only the Lead, how to turn on themes when AI is off", () => {
        const aiOff = meetingResult({ themesStatus: "notRequested", themes: [] });
        const adminLine =
          "An Organization admin can turn on AI processing in Settings to get themes and a discussion guide.";

        Scene.scene(
          { update, view },
          Scene.given(givenResults(aiOff, "lead")),
          Scene.expect(Scene.text(adminLine)).toExist(),
        );

        Scene.scene(
          { update, view },
          Scene.given(givenResults(aiOff, "member")),
          Scene.expect(Scene.text(adminLine)).toBeAbsent(),
          Scene.expect(Scene.role("heading", { name: "What people raised" })).toBeAbsent(),
        );
      });

      it("shows no themes, admin line, or guide to anyone below N", () => {
        const belowN = meetingResult({
          meetsMinimumGroupSize: false,
          submissionsCount: 2,
          responseRate: 0.25,
          themesStatus: "notRequested",
          themes: [],
          discussionGuide: guide,
        });

        Scene.scene(
          { update, view },
          Scene.given(givenResults(belowN, "lead")),
          Scene.expect(Scene.text("Not enough answers to protect anonymity")).toExist(),
          Scene.expect(Scene.role("heading", { name: "What people raised" })).toBeAbsent(),
          Scene.expect(
            Scene.text(
              "An Organization admin can turn on AI processing in Settings to get themes and a discussion guide.",
            ),
          ).toBeAbsent(),
          Scene.expect(Scene.role("heading", { name: "Discussion guide" })).toBeAbsent(),
        );
      });
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
      status: "shared",
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

    describe("Review window", () => {
      const leadTeamDetail = (teamId: TeamId, yourRole: "lead" | "member" = "lead") => ({
        team: { id: teamId, name: "Platform", timeZone: decodeTimeZone("Europe/Berlin"), yourRole },
        roster: [],
        abilities: {
          update: true,
          manageLeads: true,
          manageMembers: true,
          managePulses: true,
          viewResults: true,
        },
      });

      const teamId = decodeTeamId("team-1");
      const roundId = Schema.decodeSync(RoundId)("round-ready");
      const pulseId = decodePulseId("pulse-1");
      const reviewEndsAt = 1731400000000;
      const reviewDate = formatDate(new Date(reviewEndsAt));

      const readyResult: RoundResult = {
        roundId,
        pulseId,
        teamId,
        status: "ready",
        plannedOpenDate: "2026-11-09",
        anonymityMode: "anonymous",
        closedAt: 1731140000000,
        reviewEndsAt,
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

      it("lets the Lead share a ready Result and reloads it once shared", () => {
        Scene.scene(
          { update, view },
          Scene.given({
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`)),
            session: signedInAdmin,
            results: { _tag: "Loaded", result: readyResult },
            teamDetail: { _tag: "Loaded", detail: leadTeamDetail(teamId) },
            actions: { _tag: "Loaded", actions: [] },
          }),
          Scene.expect(Scene.text("Only you can see these Results")).toExist(),
          Scene.expect(
            Scene.text(`They'll be shared with the team automatically on ${reviewDate}.`),
          ).toExist(),
          Scene.click(Scene.role("button", { name: "Share with the team" })),
          Scene.Command.expectHas(ShareResultsCmd),
          Scene.expect(Scene.role("button", { name: "Sharing…" })).toExist(),
          Scene.Command.resolve(ShareResultsCmd, Message.ResultsShareDone({ outcome: { _tag: "Success" } })),
          Scene.Command.expectHas(GetResultsCmd),
          Scene.Command.resolve(
            GetResultsCmd,
            Message.GotResults({
              outcome: { _tag: "Success", result: { ...readyResult, status: "shared" } },
            }),
          ),
          Scene.expect(Scene.text("Only you can see these Results")).toBeAbsent(),
        );
      });

      it("shows the Lead a failed share and keeps the share button", () => {
        Scene.scene(
          { update, view },
          Scene.given({
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`)),
            session: signedInAdmin,
            results: { _tag: "Loaded", result: readyResult },
            teamDetail: { _tag: "Loaded", detail: leadTeamDetail(teamId) },
            actions: { _tag: "Loaded", actions: [] },
          }),
          Scene.click(Scene.role("button", { name: "Share with the team" })),
          Scene.Command.expectHas(ShareResultsCmd),
          Scene.Command.resolve(
            ShareResultsCmd,
            Message.ResultsShareDone({ outcome: { _tag: "Failure", failure: "Forbidden" } }),
          ),
          Scene.Command.expectNone(),
          Scene.expect(Scene.role("alert")).toExist(),
          Scene.expect(Scene.role("button", { name: "Share with the team" })).toExist(),
        );
      });

      it("shows a Member the review notice for a ready Result and no scores or summary", () => {
        // The server withholds questions, dimensions, comments and themes from a Member in the Review window.
        Scene.scene(
          { update, view },
          Scene.given({
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`)),
            session: signedInAdmin,
            results: { _tag: "Loaded", result: readyResult },
            teamDetail: { _tag: "Loaded", detail: leadTeamDetail(teamId, "member") },
            actions: { _tag: "Loaded", actions: [] },
          }),
          Scene.expect(
            Scene.text(`Your Lead is reviewing these Results. They'll be shared by ${reviewDate}.`),
          ).toExist(),
          Scene.expect(Scene.text("6 of 8 people checked in.")).toBeAbsent(),
          Scene.expect(Scene.role("button", { name: "Share with the team" })).toBeAbsent(),
          Scene.expect(Scene.role("heading", { name: "Commit an action" })).toBeAbsent(),
          Scene.expect(Scene.role("heading", { name: "Actions" })).toExist(),
        );
      });

      const withoutFlag = ({ couldNotCompute: _flag, ...rest }: RoundResult): RoundResult => rest;

      const failedResult: RoundResult = {
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
        delayed: true,
        couldNotCompute: true,
        questions: [],
        dimensions: [],
        comments: [],
      };

      it("lets the Lead retry a Result that could not be computed, then reloads it", () => {
        Scene.scene(
          { update, view },
          Scene.given({
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`)),
            session: signedInAdmin,
            results: { _tag: "Loaded", result: failedResult },
            teamDetail: { _tag: "Loaded", detail: leadTeamDetail(teamId) },
            actions: { _tag: "Loaded", actions: [] },
          }),
          Scene.expect(Scene.text("These Results couldn't be computed.")).toExist(),
          Scene.expect(Scene.text("Results delayed")).toBeAbsent(),
          Scene.click(Scene.role("button", { name: "Try again" })),
          Scene.Command.expectHas(RetryResultCmd),
          Scene.expect(Scene.role("button", { name: "Trying again…" })).toExist(),
          Scene.Command.resolve(RetryResultCmd, Message.RetryResultDone({ outcome: { _tag: "Success" } })),
          Scene.Command.expectHas(GetResultsCmd),
          Scene.Command.resolve(
            GetResultsCmd,
            Message.GotResults({
              outcome: {
                _tag: "Success",
                result: { ...withoutFlag(failedResult), status: "ready", delayed: false },
              },
            }),
          ),
          Scene.expect(Scene.text("These Results couldn't be computed.")).toBeAbsent(),
        );
      });

      it("shows the Lead a failed retry and keeps the Try again button", () => {
        Scene.scene(
          { update, view },
          Scene.given({
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`)),
            session: signedInAdmin,
            results: { _tag: "Loaded", result: failedResult },
            teamDetail: { _tag: "Loaded", detail: leadTeamDetail(teamId) },
            actions: { _tag: "Loaded", actions: [] },
          }),
          Scene.click(Scene.role("button", { name: "Try again" })),
          Scene.Command.expectHas(RetryResultCmd),
          Scene.Command.resolve(
            RetryResultCmd,
            Message.RetryResultDone({ outcome: { _tag: "Failure", failure: "Forbidden" } }),
          ),
          Scene.Command.expectNone(),
          Scene.expect(Scene.role("alert")).toExist(),
          Scene.expect(Scene.role("button", { name: "Try again" })).toExist(),
        );
      });

      it("shows a Member a delayed Result as delayed, with no retry", () => {
        Scene.scene(
          { update, view },
          Scene.given({
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`)),
            session: signedInAdmin,
            results: { _tag: "Loaded", result: withoutFlag(failedResult) },
            teamDetail: { _tag: "Loaded", detail: leadTeamDetail(teamId, "member") },
            actions: { _tag: "Loaded", actions: [] },
          }),
          Scene.expect(Scene.text("Results delayed")).toExist(),
          Scene.expect(Scene.text("These Results couldn't be computed.")).toBeAbsent(),
          Scene.expect(Scene.role("button", { name: "Try again" })).toBeAbsent(),
        );
      });
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
      paused: false,
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

    const reload = (paused = false) =>
      Scene.Command.resolveAll(
        [ListRoundsCmd, Message.GotRounds({ outcome: { _tag: "Success", list: { ...rounds, paused } } })],
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
        Scene.expect(Scene.text("Round Nov 16, 2026")).toExist(),
        Scene.expect(Scene.text("Scheduled")).toExist(),
        Scene.expect(Scene.text("Open")).toExist(),
        Scene.expect(Scene.text("Closed")).toExist(),
        Scene.expect(Scene.text("75% response rate")).toExist(),
        Scene.expect(Scene.role("link", { name: "View Results" })).toExist(),
      );
    });

    it("shows Pause Pulse and the running status for a Lead while the Pulse is active", () => {
      Scene.scene(
        { update, view },
        Scene.given(given("lead")),
        Scene.expect(Scene.text("This Pulse is running.")).toExist(),
        Scene.expect(Scene.role("button", { name: "Pause Pulse" })).toExist(),
        Scene.expect(
          Scene.text("Pausing cancels the Scheduled Round. An open Round runs to its end."),
        ).toExist(),
        Scene.expect(Scene.role("button", { name: "Resume Pulse" })).toBeAbsent(),
      );
    });

    it("shows Resume Pulse and the paused status for a Lead while the Pulse is paused", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...given("lead"),
          rounds: { _tag: "Loaded" as const, list: { ...rounds, paused: true } },
        }),
        Scene.expect(Scene.text("This Pulse is paused. No new Rounds are scheduled.")).toExist(),
        Scene.expect(Scene.role("button", { name: "Resume Pulse" })).toExist(),
        Scene.expect(
          Scene.text("Pausing cancels the Scheduled Round. An open Round runs to its end."),
        ).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Pause Pulse" })).toBeAbsent(),
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
        reload(true),
        Scene.expect(Scene.text("This Pulse is paused. No new Rounds are scheduled.")).toExist(),
        Scene.click(Scene.role("button", { name: "Resume Pulse" })),
        Scene.Command.expectHas(ResumePulseCmd),
        Scene.Command.resolve(ResumePulseCmd, Message.RoundCommandDone({ outcome: { _tag: "Success" } })),
        reload(false),
        Scene.expect(Scene.text("This Pulse is running.")).toExist(),
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
        Scene.expect(Scene.text("Round Nov 9, 2026")).toExist(),
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
        ...openAccountMenu("Acme", "Kontomenü"),
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
        ...openAccountMenu("Acme", "Kontomenü"),
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
        ...openAccountMenu("Acme"),
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

  describe("Header and footer", () => {
    const teamsUrl = makeUrl("https://app.surveybeat.com/teams");
    const teamsModel = (session: SessionModel = signedInAdmin) => ({
      ...initialModel(teamsUrl),
      session,
      teams: { _tag: "Loaded" as const, teams: [] },
    });

    it("marks the section on screen as the current navigation item", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/history")),
          session: signedInAdmin,
        }),
        Scene.expect(Scene.role("link", { name: "My history", current: "page" })).toExist(),
        Scene.expect(Scene.role("link", { name: "Teams", current: "page" })).toBeAbsent(),
      );
    });

    it("marks Teams as the current section on Team screens", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/teams/team-1/pulses")),
          session: signedInAdmin,
        }),
        Scene.expect(Scene.role("link", { name: "Teams", current: "page" })).toExist(),
        Scene.expect(Scene.role("link", { name: "My history", current: "page" })).toBeAbsent(),
      );
    });

    it("lists Organization settings only for admins", () => {
      Scene.scene(
        { update, view },
        Scene.given(teamsModel(signedInAdmin)),
        Scene.expect(Scene.role("link", { name: "Organization settings" })).toExist(),
      );
      Scene.scene(
        { update, view },
        Scene.given(teamsModel({ ...signedInAdmin, organizationAdmin: false })),
        Scene.expect(Scene.role("link", { name: "Organization settings" })).toBeAbsent(),
      );
    });

    it("keeps Privacy out of the navigation and in the footer", () => {
      Scene.scene(
        { update, view },
        Scene.given(teamsModel()),
        Scene.expect(Scene.role("contentinfo")).toExist(),
        Scene.inside(
          Scene.role("contentinfo"),
          Scene.expect(Scene.role("link", { name: "Privacy" })).toExist(),
        ),
        Scene.inside(
          Scene.role("navigation", { name: "Main navigation" }),
          Scene.expect(Scene.role("link", { name: "Privacy" })).toBeAbsent(),
        ),
      );
    });

    it("marks the footer Privacy link as the current page on the Privacy page", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy")),
          session: { _tag: "SignedOut", failed: false },
        }),
        Scene.expect(Scene.role("link", { name: "Privacy", current: "page" })).toExist(),
      );
    });

    it("keeps the signed-in header and its menus on the Privacy page", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy")),
          session: signedInAdmin,
        }),
        Scene.expect(Scene.role("heading", { name: "Privacy at SurveyBeat" })).toExist(),
        Scene.expect(Scene.role("link", { name: "Privacy", current: "page" })).toExist(),
        Scene.expect(Scene.role("link", { name: "Teams", current: "page" })).toBeAbsent(),
        ...openAccountMenu("Acme"),
        Scene.expect(Scene.role("button", { name: "Sign out" })).toExist(),
      );
    });

    it("keeps the language choice and Sign out in the account menu until it opens", () => {
      Scene.scene(
        { update, view },
        Scene.given(teamsModel()),
        Scene.expect(Scene.label("Language")).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Sign out" })).toBeAbsent(),
        ...openAccountMenu("Acme"),
        Scene.expect(Scene.label("Language")).toExist(),
        Scene.expect(Scene.role("button", { name: "Sign out" })).toExist(),
        Scene.keydown(Scene.selector("#account-menu-panel"), "Escape"),
        // Escape returns focus to the account button and closes the panel.
        Scene.Command.resolve(Popover.FocusButton, Popover.Message.CompletedFocusButton()),
        Scene.Mount.expectEnded(Popover.AnchorPopover),
        Scene.expect(Scene.label("Language")).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Acme Account menu" })).toHaveAttr(
          "aria-expanded",
          "false",
        ),
      );
    });

    it("opens the phone navigation from the Menu button", () => {
      Scene.scene(
        { update, view },
        Scene.given(teamsModel()),
        Scene.click(Scene.role("button", { name: "Menu" })),
        Scene.Mount.resolve(Popover.AnchorPopover, Popover.Message.CompletedAnchorPopover()),
        Scene.inside(
          Scene.selector("#nav-menu-panel"),
          Scene.expect(Scene.role("link", { name: "My history" })).toExist(),
          Scene.expect(Scene.role("link", { name: "Teams", current: "page" })).toExist(),
          Scene.expect(Scene.role("link", { name: "Organization settings" })).toExist(),
          Scene.expect(Scene.label("Language")).toExist(),
        ),
      );
    });

    it("closes both header menus when the URL changes", () => {
      const open = {
        ...teamsModel(),
        navMenu: Popover.open(Popover.init({ id: "nav-menu" })).model,
        accountMenu: Popover.open(Popover.init({ id: "account-menu" })).model,
      };
      expect(open.navMenu.isOpen).toBe(true);
      expect(open.accountMenu.isOpen).toBe(true);

      const next = update(open, Message.UrlChanged({ url: makeUrl("https://app.surveybeat.com/history") }));

      expect(next.model.navMenu.isOpen).toBe(false);
      expect(next.model.accountMenu.isOpen).toBe(false);
    });
  });

  describe("Document title", () => {
    const teamsUrl = makeUrl("https://app.surveybeat.com/teams");

    /** The window title `view` gives `model`, read while a Scene runs the real view. */
    const titleOf = (model: Model): string => {
      let title = "";
      Scene.scene(
        {
          update,
          view: (current, h) => {
            const document = view(current, h);
            title = document.title;
            return document;
          },
        },
        Scene.given(model),
      );
      return title;
    };

    const teamOf = (id: string, name: string) => ({
      id: decodeTeamId(id),
      name,
      timeZone: decodeTimeZone("UTC"),
      yourRole: "lead" as const,
    });
    const teamDetailOf = (id: string, name: string) => ({
      team: teamOf(id, name),
      roster: [],
      may: {
        update: true,
        manageLeads: true,
        manageMembers: true,
        managePulses: true,
        viewResults: true,
      },
    });
    const platform = { _tag: "Loaded" as const, detail: teamDetailOf("team-1", "Platform Engineering") };
    const pulseDetail = {
      _tag: "Loaded" as const,
      detail: {
        id: decodePulseId("pulse-1"),
        team: teamOf("team-1", "Platform Engineering"),
        settings: {
          name: "Weekly check-in",
          cadence: { _tag: "Weekly" as const, day: "monday" as const, time: decodeSendTime("09:00") },
          answerWindowDays: 3,
          reviewWindowDays: 3,
          reminders: 1,
          anonymityMode: "anonymous" as const,
          distribution: "invitation" as const,
        },
        questions: [],
        estimatedSeconds: 0,
        warnings: [],
        templateQuestions: [],
      },
    };
    const inOrganization = (url: string, extra: Partial<Model> = {}): Model => ({
      ...initialModel(makeUrl(url)),
      session: signedInAdmin,
      ...extra,
    });

    it("names the screen and the Organization on the Teams screen", () => {
      expect(
        titleOf(inOrganization("https://app.surveybeat.com/teams", { teams: { _tag: "Loaded", teams: [] } })),
      ).toBe("Teams · Acme — SurveyBeat");
    });

    it("shows the Teams screen's title on a page that does not exist", () => {
      expect(titleOf(inOrganization("https://app.surveybeat.com/nowhere"))).toBe("Teams · Acme — SurveyBeat");
    });

    it("names the Team on its screen, and 'Team' while its detail loads", () => {
      expect(
        titleOf(inOrganization("https://app.surveybeat.com/teams/team-1", { teamDetail: platform })),
      ).toBe("Platform Engineering · Acme — SurveyBeat");
      expect(titleOf(inOrganization("https://app.surveybeat.com/teams/team-1"))).toBe(
        "Team · Acme — SurveyBeat",
      );
    });

    it("ignores a Team loaded for another screen", () => {
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/teams/team-2", {
            teamDetail: { _tag: "Loaded", detail: teamDetailOf("team-1", "Platform Engineering") },
          }),
        ),
      ).toBe("Team · Acme — SurveyBeat");
    });

    it("names the Team on the Pulses screen", () => {
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/teams/team-1/pulses", {
            pulses: {
              _tag: "Loaded",
              pulses: { team: teamOf("team-1", "Platform Engineering"), pulses: [] },
            },
          }),
        ),
      ).toBe("Pulses · Platform Engineering — SurveyBeat");
    });

    it("names the Pulse and its Team in the Pulse editor", () => {
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/teams/team-1/pulses/pulse-1", {
            pulseDetail,
            teamDetail: platform,
          }),
        ),
      ).toBe("Weekly check-in · Platform Engineering — SurveyBeat");
    });

    it("falls back to 'Pulse' and the Organization while the Pulse loads", () => {
      expect(titleOf(inOrganization("https://app.surveybeat.com/teams/team-1/pulses/pulse-1"))).toBe(
        "Pulse · Acme — SurveyBeat",
      );
    });

    it("names the Team on the Rounds screen", () => {
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/teams/team-1/pulses/pulse-1/rounds", {
            teamDetail: platform,
          }),
        ),
      ).toBe("Rounds · Platform Engineering — SurveyBeat");
    });

    it("names the Team on the Results screen", () => {
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/teams/team-1/rounds/round-1", {
            teamDetail: platform,
          }),
        ),
      ).toBe("Results · Platform Engineering — SurveyBeat");
    });

    it("ignores a Team loaded for another Results screen", () => {
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/teams/team-1/rounds/round-1", {
            teamDetail: { _tag: "Loaded", detail: teamDetailOf("team-9", "Other Team") },
          }),
        ),
      ).toBe("Results · Acme — SurveyBeat");
    });

    it("names My history and the Organization", () => {
      expect(titleOf(inOrganization("https://app.surveybeat.com/history"))).toBe(
        "My history · Acme — SurveyBeat",
      );
    });

    it("names the Organization settings for admins, and falls back to Teams for others", () => {
      expect(titleOf(inOrganization("https://app.surveybeat.com/settings"))).toBe(
        "Organization settings · Acme — SurveyBeat",
      );
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/settings", {
            session: { ...signedInAdmin, organizationAdmin: false },
          }),
        ),
      ).toBe("Teams · Acme — SurveyBeat");
    });

    it("gives the German titles the same shape", () => {
      const german = { ...signedInAdmin, locale: "de" as const };
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/teams/team-1/rounds/round-1", {
            session: german,
            teamDetail: platform,
          }),
        ),
      ).toBe("Ergebnisse · Platform Engineering — SurveyBeat");
      expect(titleOf(inOrganization("https://app.surveybeat.com/settings", { session: german }))).toBe(
        "Organisationseinstellungen · Acme — SurveyBeat",
      );
    });

    it("keeps the session and Privacy screens' own titles, all naming SurveyBeat", () => {
      const signedOut = (url: string): Model => ({
        ...initialModel(makeUrl(url)),
        session: { _tag: "SignedOut", failed: false },
      });
      expect(titleOf(signedOut("https://app.surveybeat.com/"))).toBe("Sign in to SurveyBeat");
      expect(titleOf(signedOut("https://app.surveybeat.com/privacy"))).toBe("Privacy at SurveyBeat");
      expect(titleOf({ ...initialModel(teamsUrl), session: { _tag: "Loading" } })).toBe("SurveyBeat");
      expect(
        titleOf({
          ...initialModel(teamsUrl),
          session: { _tag: "CreateOrganization", name: "", busy: false },
        }),
      ).toBe("Create an Organization — SurveyBeat");
      expect(titleOf({ ...initialModel(teamsUrl), session: { _tag: "NotInOrganization" } })).toBe(
        "You're not part of an Organization yet — SurveyBeat",
      );
      expect(
        titleOf({
          ...initialModel(teamsUrl),
          session: { _tag: "ChooseOrganization", organizations: [], busy: false },
        }),
      ).toBe("Choose an Organization — SurveyBeat");
    });
  });
});
