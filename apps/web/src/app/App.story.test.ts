import {
  EmailAddress,
  MinimumGroupSize,
  OrganizationId,
  PersonId,
  PulseId,
  RoundId,
  QuestionId,
  QuestionVersionId,
  SendTime,
  TeamId,
  TemplateQuestionKey,
  TimeZone,
} from "@surveybeat/domain";
import { Option, Schema } from "effect";
import * as Story from "foldkit/story";
import { fromString } from "foldkit/url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AddMember,
  AddQuestionCmd,
  AssignLead,
  ChooseOrganization,
  CreateOrganization,
  CreatePulse,
  CreateTeam,
  EditQuestionCmd,
  GetPulse,
  GetRoundDetailCmd,
  GetRoundRateCmd,
  GetSettings,
  GetTeam,
  GetTeamOverviewCmd,
  GrantAdmin,
  initialModel,
  ListFailedEmails,
  ListPulses,
  ListRoundsCmd,
  ListTeams,
  LoadSession,
  Message,
  Navigate,
  RemoveMember,
  RemovePerson,
  RemoveQuestionCmd,
  ReorderQuestionsCmd,
  RevokeAdmin,
  update,
  UpdateDefaultLanguage,
  UpdateOwnLanguage,
  UpdatePulseSettingsCmd,
  UpdateSettings,
  UpdateTeam,
} from "./App.ts";
import { setLocale } from "../messages/locale.ts";

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

describe("App Stories", () => {
  describe("Sign-in states", () => {
    it("handles initial session loading and signed out state", () => {
      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/"))),
        Story.model((m) => {
          expect(m.session._tag).toBe("Loading");
        }),
        Story.message(
          Message.GotSession({
            result: { _tag: "SignedOut" },
          }),
        ),
        Story.model((m) => {
          expect(m.session._tag).toBe("SignedOut");
          if (m.session._tag === "SignedOut") {
            expect(m.session.failed).toBe(false);
          }
        }),
      );
    });

    it("handles signin failed query parameter", () => {
      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/?signin=failed"))),
        Story.message(
          Message.GotSession({
            result: { _tag: "SignedOut" },
          }),
        ),
        Story.model((m) => {
          expect(m.session._tag).toBe("SignedOut");
          if (m.session._tag === "SignedOut") {
            expect(m.session.failed).toBe(true);
          }
        }),
      );
    });

    it("handles retry session", () => {
      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/"))),
        Story.message(
          Message.GotSession({
            result: { _tag: "Failed" },
          }),
        ),
        Story.model((m) => {
          expect(m.session._tag).toBe("Failed");
        }),
        Story.message(Message.RetrySession()),
        Story.model((m) => {
          expect(m.session._tag).toBe("Loading");
        }),
        Story.Command.expectHas(LoadSession),
        Story.Command.resolve(
          LoadSession,
          Message.GotSession({
            result: { _tag: "NotInOrganization" },
          }),
        ),
        Story.model((m) => {
          expect(m.session._tag).toBe("NotInOrganization");
        }),
      );
    });

    it("handles create organization flow", () => {
      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/"))),
        Story.message(
          Message.GotSession({
            result: { _tag: "CreateOrganization" },
          }),
        ),
        Story.model((m) => {
          expect(m.session._tag).toBe("CreateOrganization");
        }),
        Story.message(Message.CreateOrgNameChanged({ name: "Acme Corp" })),
        Story.model((m) => {
          if (m.session._tag === "CreateOrganization") {
            expect(m.session.name).toBe("Acme Corp");
          }
        }),
        Story.message(Message.SubmitCreateOrg()),
        Story.Command.expectHas(CreateOrganization),
        Story.Command.resolve(
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
        Story.model((m) => {
          expect(m.session._tag).toBe("SignedIn");
        }),
        Story.Command.expectHas(ListTeams),
        Story.Command.resolve(
          ListTeams,
          Message.GotTeams({
            outcome: { _tag: "Success", teams: [] },
          }),
        ),
      );
    });

    it("handles choose organization flow", () => {
      const orgA = { id: decodeOrgId("org-a"), name: "Org Alpha" };
      const orgB = { id: decodeOrgId("org-b"), name: "Org Beta" };

      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/"))),
        Story.message(
          Message.GotSession({
            result: {
              _tag: "ChooseOrganization",
              organizations: [orgA, orgB],
            },
          }),
        ),
        Story.model((m) => {
          expect(m.session._tag).toBe("ChooseOrganization");
        }),
        Story.message(Message.ChooseOrgClicked({ organizationId: orgB.id })),
        Story.Command.expectHas(ChooseOrganization),
        Story.Command.resolve(
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
        Story.model((m) => {
          expect(m.session._tag).toBe("SignedIn");
        }),
        Story.Command.expectHas(ListTeams),
        Story.Command.resolve(
          ListTeams,
          Message.GotTeams({
            outcome: { _tag: "Success", teams: [] },
          }),
        ),
      );
    });
  });

  describe("Teams screen", () => {
    it("loads teams list and creates a team", () => {
      const teamId = decodeTeamId("team-1");
      const teamSummary = {
        id: teamId,
        name: "Engineering",
        timeZone: decodeTimeZone("Europe/Berlin"),
        yourRole: "lead" as const,
      };

      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/"))),
        Story.message(
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization: { id: decodeOrgId("org-1"), name: "Acme" },
              organizationAdmin: true,
              locale: null,
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Story.Command.expectHas(ListTeams),
        Story.Command.resolve(
          ListTeams,
          Message.GotTeams({
            outcome: { _tag: "Success", teams: [teamSummary] },
          }),
        ),
        Story.model((m) => {
          expect(m.teams._tag).toBe("Loaded");
          if (m.teams._tag === "Loaded") {
            expect(m.teams.teams).toHaveLength(1);
            expect(m.teams.teams[0]?.name).toBe("Engineering");
          }
        }),
        Story.message(Message.CreateTeamNameChanged({ name: "Design" })),
        Story.message(Message.CreateTeamTimeZoneChanged({ tz: "UTC" })),
        Story.message(Message.CreateTeamLeadEmailChanged({ email: "lead@acme.com" })),
        Story.message(Message.SubmitCreateTeam()),
        Story.Command.expectHas(CreateTeam),
        Story.Command.resolve(
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
        Story.model((m) => {
          expect(m.createTeamBusy).toBe(false);
        }),
        Story.Command.expectHas(Navigate),
        Story.Command.resolve(Navigate, Message.Navigated()),
      );
    });
  });

  describe("Team detail screen", () => {
    it("renames team, adds member, and assigns lead", () => {
      const teamId = decodeTeamId("team-1");
      const personId = decodePersonId("person-1");
      const detail = {
        team: {
          id: teamId,
          name: "Old Name",
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

      Story.story(
        update,
        Story.given(initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}`))),
        Story.message(
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization: { id: decodeOrgId("org-1"), name: "Acme" },
              organizationAdmin: true,
              locale: null,
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Story.Command.expectHas(GetTeam),
        Story.Command.resolve(
          GetTeam,
          Message.GotTeam({
            outcome: { _tag: "Success", detail },
          }),
        ),
        Story.Command.resolve(
          GetTeamOverviewCmd,
          Message.GotTeamOverview({
            outcome: { _tag: "Failure", failure: "Forbidden" },
          }),
        ),
        Story.model((m) => {
          expect(m.teamDetail._tag).toBe("Loaded");
          expect(m.renameName).toBe("Old Name");
        }),
        // Rename team
        Story.message(Message.RenameNameChanged({ name: "New Name" })),
        Story.message(Message.SubmitRenameTeam()),
        Story.Command.expectHas(UpdateTeam),
        Story.Command.resolve(UpdateTeam, Message.UpdatedTeam({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetTeam),
        Story.Command.resolve(
          GetTeam,
          Message.GotTeam({
            outcome: {
              _tag: "Success",
              detail: {
                ...detail,
                team: { ...detail.team, name: "New Name" },
              },
            },
          }),
        ),
        // Add member
        Story.message(Message.AddMemberEmailChanged({ email: "bob@acme.com" })),
        Story.message(Message.SubmitAddMember()),
        Story.Command.expectHas(AddMember),
        Story.Command.resolve(AddMember, Message.AddedMember({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetTeam),
        Story.Command.resolve(
          GetTeam,
          Message.GotTeam({
            outcome: { _tag: "Success", detail },
          }),
        ),
        // Assign lead
        Story.message(Message.AssignLeadEmailChanged({ email: "carol@acme.com" })),
        Story.message(Message.SubmitAssignLead()),
        Story.Command.expectHas(AssignLead),
        Story.Command.resolve(AssignLead, Message.AssignedLead({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetTeam),
        Story.Command.resolve(
          GetTeam,
          Message.GotTeam({
            outcome: { _tag: "Success", detail },
          }),
        ),
        // Remove member: asking first, then confirming
        Story.message(Message.RemoveMemberClicked({ personId })),
        Story.message(Message.ConfirmRemove()),
        Story.Command.expectHas(RemoveMember),
        Story.Command.resolve(RemoveMember, Message.RemovedMember({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetTeam),
        Story.Command.resolve(
          GetTeam,
          Message.GotTeam({
            outcome: { _tag: "Success", detail: { ...detail, roster: [] } },
          }),
        ),
        Story.model((m) => {
          if (m.teamDetail._tag === "Loaded") {
            expect(m.teamDetail.detail.roster).toHaveLength(0);
          }
        }),
      );
    });
  });

  describe("Settings screen", () => {
    it("updates minimum group size and manages admin roles", () => {
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

      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/settings"))),
        Story.message(
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization: { id: decodeOrgId("org-1"), name: "Acme" },
              organizationAdmin: true,
              locale: null,
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Story.Command.expectHas(GetSettings, ListFailedEmails),
        Story.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: { _tag: "Success", settings },
          }),
        ),
        Story.Command.resolve(
          ListFailedEmails,
          Message.GotFailedEmails({ outcome: { _tag: "Success", list: { emails: [] } } }),
        ),
        Story.model((m) => {
          expect(m.settings._tag).toBe("Loaded");
          expect(m.size).toBe("4");
        }),
        // Change size
        Story.message(Message.SizeChanged({ size: "5" })),
        Story.message(Message.SubmitSize()),
        Story.Command.expectHas(UpdateSettings),
        Story.Command.resolve(UpdateSettings, Message.UpdatedSettings({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetSettings),
        Story.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: {
              _tag: "Success",
              settings: { ...settings, minimumGroupSize: decodeSize(5) },
            },
          }),
        ),
        // Grant admin
        Story.message(Message.GrantAdminClicked({ personId })),
        Story.Command.expectHas(GrantAdmin),
        Story.Command.resolve(GrantAdmin, Message.GrantedAdmin({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetSettings),
        Story.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: { _tag: "Success", settings },
          }),
        ),
        // Revoke admin
        Story.message(Message.RevokeAdminClicked({ personId })),
        Story.Command.expectHas(RevokeAdmin),
        Story.Command.resolve(RevokeAdmin, Message.RevokedAdmin({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetSettings),
        Story.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: { _tag: "Success", settings },
          }),
        ),
        // Remove person
        Story.message(Message.RemovePersonClicked({ personId })),
        Story.message(Message.ConfirmRemove()),
        Story.Command.expectHas(RemovePerson),
        Story.Command.resolve(RemovePerson, Message.RemovedPerson({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetSettings),
        Story.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: {
              _tag: "Success",
              settings: { ...settings, people: [] },
            },
          }),
        ),
        Story.model((m) => {
          if (m.settings._tag === "Loaded") {
            expect(m.settings.settings.people).toHaveLength(0);
          }
        }),
      );
    });
  });

  describe("Pulses list screen", () => {
    it("loads pulses and creates a new pulse", () => {
      const teamId = decodeTeamId("team-1");
      const pulseId = decodePulseId("pulse-1");

      Story.story(
        update,
        Story.given(initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/pulses`))),
        Story.message(
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization: { id: decodeOrgId("org-1"), name: "Acme" },
              organizationAdmin: true,
              locale: null,
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Story.Command.expectHas(ListPulses),
        Story.Command.resolve(
          ListPulses,
          Message.GotPulses({
            outcome: {
              _tag: "Success",
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
        ),
        Story.model((m) => {
          expect(m.pulses._tag).toBe("Loaded");
          if (m.pulses._tag === "Loaded") {
            expect(m.pulses.pulses.pulses).toHaveLength(1);
          }
        }),
        Story.message(Message.CreatePulseClicked()),
        Story.Command.expectHas(CreatePulse),
        Story.Command.resolve(
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
        Story.model((m) => {
          expect(m.createPulseBusy).toBe(false);
        }),
        Story.Command.expectHas(Navigate),
        Story.Command.resolve(Navigate, Message.Navigated()),
      );
    });
  });

  describe("Pulse editor screen", () => {
    it("moves questions, adds questions, edits settings, and removes questions", () => {
      const teamId = decodeTeamId("team-1");
      const pulseId = decodePulseId("pulse-1");
      const q1Id = decodeQuestionId("q-1");
      const q2Id = decodeQuestionId("q-2");

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
          {
            questionId: q2Id,
            versionId: decodeVersionId("v-2"),
            templateKey: decodeTemplateKey("clarity"),
            text: "Goals were clear",
            type: { _tag: "Rating" as const, lowLabel: "Disagree", highLabel: "Agree", comment: true },
            dimension: "clarity" as const,
            hasAnswers: false,
            estimatedSeconds: 15,
          },
        ],
        estimatedSeconds: 30,
        warnings: [],
        templateQuestions: [],
      };

      Story.story(
        update,
        Story.given(initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/pulses/${pulseId}`))),
        Story.message(
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization: { id: decodeOrgId("org-1"), name: "Acme" },
              organizationAdmin: true,
              locale: null,
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Story.Command.expectHas(GetPulse),
        Story.Command.resolve(
          GetPulse,
          Message.GotPulse({
            outcome: { _tag: "Success", detail },
          }),
        ),
        Story.model((m) => {
          expect(m.pulseDetail._tag).toBe("Loaded");
          expect(m.settingsName).toBe("Sprint Pulse");
        }),
        // Move question
        Story.message(Message.MoveQuestionClicked({ index: 0, by: 1 })),
        Story.Command.expectHas(ReorderQuestionsCmd),
        Story.Command.resolve(
          ReorderQuestionsCmd,
          Message.UpdatedPulse({
            outcome: {
              _tag: "Success",
              detail: {
                ...detail,
                questions: [detail.questions[1]!, detail.questions[0]!],
              },
            },
          }),
        ),
        Story.model((m) => {
          if (m.pulseDetail._tag === "Loaded") {
            expect(m.pulseDetail.detail.questions[0]?.questionId).toBe(q2Id);
          }
        }),
        // Add template question
        Story.message(
          Message.AddTemplateQuestionClicked({ key: Schema.decodeSync(TemplateQuestionKey)("recognition") }),
        ),
        Story.Command.expectHas(AddQuestionCmd),
        Story.Command.resolve(AddQuestionCmd, Message.UpdatedPulse({ outcome: { _tag: "Success", detail } })),
        // Write custom question
        Story.message(Message.ToggleWritingQuestion({ writing: true })),
        Story.message(Message.FormTextChanged({ text: "Custom feedback" })),
        Story.message(Message.FormKindChanged({ kind: "LongText" })),
        Story.message(Message.SubmitQuestionForm({ mode: "Add" })),
        Story.Command.expectHas(AddQuestionCmd),
        Story.Command.resolve(AddQuestionCmd, Message.UpdatedPulse({ outcome: { _tag: "Success", detail } })),
        // Edit question
        Story.message(Message.ToggleEditQuestion({ questionId: Option.some(q1Id) })),
        Story.model((m) => {
          expect(m.formText).toBe("How was your workload this week?");
        }),
        Story.message(Message.FormTextChanged({ text: "How was your workload today?" })),
        Story.message(Message.SubmitQuestionForm({ mode: "Edit" })),
        Story.Command.expectHas(EditQuestionCmd),
        Story.Command.resolve(
          EditQuestionCmd,
          Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
        ),
        // Remove question
        Story.message(Message.RemoveQuestionClicked({ questionId: q2Id })),
        Story.Command.expectHas(RemoveQuestionCmd),
        Story.Command.resolve(
          RemoveQuestionCmd,
          Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
        ),
        // Update settings
        Story.message(Message.SettingsNameChanged({ name: "Updated Pulse Name" })),
        Story.message(Message.SettingsDayChanged({ day: "tuesday" })),
        Story.message(Message.SubmitSettings()),
        Story.Command.expectHas(UpdatePulseSettingsCmd),
        Story.Command.resolve(
          UpdatePulseSettingsCmd,
          Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
        ),
        Story.model((m) => {
          expect(m.settingsSaved).toBe(true);
        }),
      );
    });
  });

  describe("Rounds screen", () => {
    const teamId = decodeTeamId("team-1");
    const pulseId = decodePulseId("pulse-1");
    const openId = Schema.decodeSync(RoundId)("round-open");
    const closedId = Schema.decodeSync(RoundId)("round-closed");
    const url = makeUrl(`https://app.surveybeat.com/teams/${teamId}/pulses/${pulseId}/rounds`);
    const summary = (id: RoundId, status: "open" | "closed") => ({
      id,
      pulseId,
      teamId,
      status,
      plannedOpenDate: "2026-11-09",
      plannedOpenAt: 1731140000000,
      openedAt: 1731140000000,
      plannedCloseAt: 1731400000000,
      closedAt: status === "closed" ? 1731400000000 : null,
      pulseName: "Weekly check-in",
    });
    const list = { pulseId, paused: false, rounds: [summary(openId, "open"), summary(closedId, "closed")] };
    const teamAs = (yourRole: "lead" | null) => ({
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
    const signedIn = {
      ...initialModel(url),
      session: {
        _tag: "SignedIn" as const,
        organization: { id: decodeOrgId("org-1"), name: "Acme" },
        organizationAdmin: false,
        locale: null,
        detectedLocale: null,
        organizationLocale: "en",
      },
    };

    it("loads the Team, then the Rounds, then details and response rates for a Lead", () => {
      Story.story(
        update,
        Story.given(signedIn),
        Story.message(Message.UrlChanged({ url })),
        Story.Command.expectExact(GetTeam),
        Story.Command.resolve(
          GetTeam,
          Message.GotTeam({ outcome: { _tag: "Success", detail: teamAs("lead") } }),
        ),
        Story.Command.expectExact(ListRoundsCmd),
        Story.Command.resolve(ListRoundsCmd, Message.GotRounds({ outcome: { _tag: "Success", list } })),
        Story.Command.expectExact(GetRoundDetailCmd, GetRoundRateCmd),
        Story.Command.resolveAll(
          [
            GetRoundDetailCmd,
            Message.GotRoundDetail({ roundId: openId, outcome: { _tag: "Failure", failure: "NotFound" } }),
          ],
          [
            GetRoundRateCmd,
            Message.GotRoundRate({ roundId: closedId, outcome: { _tag: "Failure", failure: "NotFound" } }),
          ],
        ),
      );
    });

    it("does not ask an Organization admin outside the Team for Round details or Results", () => {
      Story.story(
        update,
        Story.given(signedIn),
        Story.message(Message.UrlChanged({ url })),
        Story.Command.resolve(
          GetTeam,
          Message.GotTeam({ outcome: { _tag: "Success", detail: teamAs(null) } }),
        ),
        Story.Command.resolve(ListRoundsCmd, Message.GotRounds({ outcome: { _tag: "Success", list } })),
        Story.Command.expectNone(),
      );
    });
  });

  describe("Language", () => {
    const teamsUrl = makeUrl("https://app.surveybeat.com/");
    const organization = { id: decodeOrgId("org-1"), name: "Acme" };
    const signedInSession = {
      _tag: "SignedIn" as const,
      organization,
      organizationAdmin: true,
      locale: null,
      detectedLocale: null,
      organizationLocale: "en" as const,
    };

    it("saves the Person's language choice, then reloads the session", () => {
      Story.story(
        update,
        Story.given({ ...initialModel(teamsUrl), session: signedInSession }),
        Story.message(Message.LanguageChanged({ value: "de" })),
        Story.model((m) => {
          expect(m.languageBusy).toBe(true);
          expect(m.session).toMatchObject({ _tag: "SignedIn", locale: "de" });
        }),
        Story.Command.expectExact(UpdateOwnLanguage({ locale: "de" })),
        Story.Command.resolve(
          UpdateOwnLanguage({ locale: "de" }),
          Message.UpdatedOwnLanguage({ chosen: true, outcome: { _tag: "Success" } }),
        ),
        Story.model((m) => {
          expect(m.languageBusy).toBe(false);
        }),
        Story.Command.expectExact(LoadSession),
        Story.Command.resolve(
          LoadSession,
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization,
              organizationAdmin: true,
              locale: "de",
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Story.Command.resolve(ListTeams, Message.GotTeams({ outcome: { _tag: "Success", teams: [] } })),
        Story.Command.expectNone(),
      );
    });

    it("saves following the browser as a null choice", () => {
      Story.story(
        update,
        Story.given({ ...initialModel(teamsUrl), session: { ...signedInSession, locale: "de" as const } }),
        Story.message(Message.LanguageChanged({ value: "" })),
        Story.Command.expectExact(UpdateOwnLanguage({ locale: null })),
        Story.Command.resolve(
          UpdateOwnLanguage({ locale: null }),
          Message.UpdatedOwnLanguage({ chosen: true, outcome: { _tag: "Success" } }),
        ),
        Story.Command.expectExact(LoadSession),
        Story.Command.resolve(
          LoadSession,
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization,
              organizationAdmin: true,
              locale: null,
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Story.Command.resolve(ListTeams, Message.GotTeams({ outcome: { _tag: "Success", teams: [] } })),
        Story.model((m) => {
          expect(m.session).toMatchObject({ _tag: "SignedIn", locale: null });
        }),
        Story.Command.expectNone(),
      );
    });

    it("ignores an unknown language and a change while one is saving", () => {
      Story.story(
        update,
        Story.given({ ...initialModel(teamsUrl), session: signedInSession }),
        Story.message(Message.LanguageChanged({ value: "fr" })),
        Story.Command.expectNone(),
        Story.model((m) => {
          expect(m.languageBusy).toBe(false);
          expect(m.session).toMatchObject({ locale: null });
        }),
      );
      Story.story(
        update,
        Story.given({ ...initialModel(teamsUrl), session: signedInSession, languageBusy: true }),
        Story.message(Message.LanguageChanged({ value: "de" })),
        Story.Command.expectNone(),
        Story.model((m) => {
          expect(m.session).toMatchObject({ locale: null });
        }),
      );
    });

    it("keeps a failed language save visible and reloads the stored language", () => {
      Story.story(
        update,
        Story.given({ ...initialModel(teamsUrl), session: signedInSession }),
        Story.message(Message.LanguageChanged({ value: "de" })),
        Story.Command.resolve(
          UpdateOwnLanguage({ locale: "de" }),
          Message.UpdatedOwnLanguage({ chosen: true, outcome: { _tag: "Failure", failure: "Unavailable" } }),
        ),
        Story.model((m) => {
          expect(m.languageBusy).toBe(false);
          expect(Option.getOrUndefined(m.languageFailure)).toBe("Unavailable");
        }),
        Story.Command.expectExact(LoadSession),
        Story.Command.resolve(
          LoadSession,
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization,
              organizationAdmin: true,
              locale: null,
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Story.Command.resolve(ListTeams, Message.GotTeams({ outcome: { _tag: "Success", teams: [] } })),
        Story.Command.expectNone(),
      );
    });

    it("records the browser's language for a Person without a choice", () => {
      Story.story(
        update,
        Story.given({ ...initialModel(teamsUrl), browserLocale: "de" as const }),
        Story.message(
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization,
              organizationAdmin: false,
              locale: null,
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Story.Command.expectExact(ListTeams, UpdateOwnLanguage({ detectedLocale: "de" })),
        Story.Command.resolve(
          UpdateOwnLanguage({ detectedLocale: "de" }),
          Message.UpdatedOwnLanguage({ chosen: false, outcome: { _tag: "Success" } }),
        ),
        Story.Command.resolve(ListTeams, Message.GotTeams({ outcome: { _tag: "Success", teams: [] } })),
        Story.Command.expectNone(),
        Story.model((m) => {
          expect(m.languageBusy).toBe(false);
          expect(Option.isNone(m.languageFailure)).toBe(true);
        }),
      );
    });

    it("does not record the browser's language when it is recorded already or a choice exists", () => {
      const session = (locale: "en" | "de" | null, detectedLocale: "en" | "de" | null) => ({
        _tag: "SignedIn" as const,
        organization,
        organizationAdmin: false,
        locale,
        detectedLocale,
        organizationLocale: "en" as const,
      });

      Story.story(
        update,
        Story.given({ ...initialModel(teamsUrl), browserLocale: "de" as const }),
        Story.message(Message.GotSession({ result: session(null, "de") })),
        Story.Command.expectExact(ListTeams),
        Story.Command.resolve(ListTeams, Message.GotTeams({ outcome: { _tag: "Success", teams: [] } })),
        Story.Command.expectNone(),
      );
      Story.story(
        update,
        Story.given({ ...initialModel(teamsUrl), browserLocale: "de" as const }),
        Story.message(Message.GotSession({ result: session("en", null) })),
        Story.Command.expectExact(ListTeams),
        Story.Command.resolve(ListTeams, Message.GotTeams({ outcome: { _tag: "Success", teams: [] } })),
        Story.Command.expectNone(),
      );
      Story.story(
        update,
        Story.given(initialModel(teamsUrl)),
        Story.message(Message.GotSession({ result: session(null, null) })),
        Story.Command.expectExact(ListTeams),
        Story.Command.resolve(ListTeams, Message.GotTeams({ outcome: { _tag: "Success", teams: [] } })),
        Story.Command.expectNone(),
      );
    });

    it("saves the Organization's default language and reloads the session, which reloads the settings", () => {
      const settings = {
        name: "Acme",
        minimumGroupSize: decodeSize(4),
        aiProcessing: false,
        defaultLocale: "en" as const,
        people: [],
      };

      Story.story(
        update,
        Story.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings")),
          session: signedInSession,
          settings: { _tag: "Loaded", settings },
        }),
        Story.message(Message.DefaultLanguageChanged({ value: "de" })),
        Story.model((m) => {
          expect(m.defaultLanguageBusy).toBe(true);
        }),
        Story.Command.expectExact(UpdateDefaultLanguage({ defaultLocale: "de" })),
        Story.Command.resolve(
          UpdateDefaultLanguage({ defaultLocale: "de" }),
          Message.UpdatedDefaultLanguage({ outcome: { _tag: "Success" } }),
        ),
        Story.model((m) => {
          expect(m.defaultLanguageBusy).toBe(false);
        }),
        Story.Command.expectExact(LoadSession),
        Story.Command.resolve(
          LoadSession,
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization,
              organizationAdmin: true,
              locale: null,
              detectedLocale: null,
              organizationLocale: "de",
            },
          }),
        ),
        Story.Command.expectExact(GetSettings, ListFailedEmails),
        Story.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: { _tag: "Success", settings: { ...settings, defaultLocale: "de" } },
          }),
        ),
        Story.Command.resolve(
          ListFailedEmails,
          Message.GotFailedEmails({ outcome: { _tag: "Success", list: { emails: [] } } }),
        ),
        Story.model((m) => {
          expect(m.session).toMatchObject({ organizationLocale: "de" });
        }),
      );
    });

    it("shows a failed default language save and ignores an unknown value", () => {
      const settings = {
        name: "Acme",
        minimumGroupSize: decodeSize(4),
        aiProcessing: false,
        defaultLocale: "en" as const,
        people: [],
      };

      Story.story(
        update,
        Story.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings")),
          session: signedInSession,
          settings: { _tag: "Loaded", settings },
        }),
        Story.message(Message.DefaultLanguageChanged({ value: "fr" })),
        Story.Command.expectNone(),
        Story.message(Message.DefaultLanguageChanged({ value: "de" })),
        Story.Command.resolve(
          UpdateDefaultLanguage({ defaultLocale: "de" }),
          Message.UpdatedDefaultLanguage({ outcome: { _tag: "Failure", failure: "Forbidden" } }),
        ),
        Story.model((m) => {
          expect(m.defaultLanguageBusy).toBe(false);
          expect(Option.getOrUndefined(m.defaultLanguageFailure)).toBe("Forbidden");
        }),
        Story.Command.expectNone(),
      );
    });
  });
});
