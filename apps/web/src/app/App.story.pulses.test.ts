import { TemplateQuestionKey } from "@surveybeat/domain";
import { Option, Schema } from "effect";
import * as Story from "foldkit/story";
import { afterEach, describe, expect, it } from "vitest";
import {
  AddQuestionCmd,
  CreatePulse,
  EditQuestionCmd,
  GetPulse,
  initialModel,
  ListPulses,
  Message,
  Navigate,
  RemoveQuestionCmd,
  ReorderQuestionsCmd,
  update,
  UpdatePulseSettingsCmd,
} from "./App.ts";
import { setLocale } from "../messages/locale.ts";
import {
  decodeOrgId,
  decodeTeamId,
  decodePulseId,
  decodeQuestionId,
  decodeVersionId,
  decodeTemplateKey,
  decodeTimeZone,
  decodeSendTime,
  makeUrl,
} from "./appStoryFixtures.ts";

afterEach(() => {
  setLocale("en");
});

describe("App Stories", () => {
  describe("Pulses list screen", () => {
    it("loads pulses and creates a new pulse", () => {
      const teamId = decodeTeamId("team-1");
      const pulseId = decodePulseId("pulse-1");

      Story.story(
        update,
        Story.given(initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/pulses`), [])),
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
        Story.given(
          initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/pulses/${pulseId}`), []),
        ),
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
});
