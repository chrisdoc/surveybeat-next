import {
  EmailAddress,
  MinimumGroupSize,
  OrganizationId,
  PersonId,
  PulseId,
  QuestionId,
  QuestionVersionId,
  SendTime,
  TeamId,
  TemplateQuestionKey,
  TimeZone,
} from "@surveybeat/domain";
import { Option, Schema } from "effect";
import * as Scene from "foldkit/scene";
import { setup } from "foldkit/test/vitest";
import { fromString } from "foldkit/url";
import { describe, it } from "vitest";
import {
  AddMember,
  AddQuestionCmd,
  AssignLead,
  ChooseOrganization,
  CreateOrganization,
  CreatePulse,
  CreateTeam,
  GetSettings,
  GetTeam,
  initialModel,
  ListTeams,
  Message,
  Navigate,
  RemoveMember,
  RemoveQuestionCmd,
  update,
  UpdatePulseSettingsCmd,
  UpdateSettings,
  UpdateTeam,
  view,
} from "./App.ts";
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

const signedInAdmin: SessionModel = {
  _tag: "SignedIn",
  organization: { id: decodeOrgId("org-1"), name: "Acme" },
  organizationAdmin: true,
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
  });

  describe("Settings screen", () => {
    it("renders organization settings and updates minimum group size", () => {
      const personId = decodePersonId("person-1");
      const settings = {
        name: "Acme",
        minimumGroupSize: decodeSize(4),
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
});
