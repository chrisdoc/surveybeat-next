import type { TestSendStatus } from "@surveybeat/domain";
import * as Scene from "foldkit/scene";
import { setup } from "foldkit/test/vitest";
import { afterEach, describe, it } from "vitest";
import {
  AddQuestionCmd,
  CreatePulse,
  initialModel,
  Message,
  Navigate,
  PollTestSendCmd,
  RemoveQuestionCmd,
  SendTestInvitationCmd,
  update,
  UpdatePulseSettingsCmd,
  view,
} from "./App.ts";
import { setLocale } from "../messages/locale.ts";
import {
  decodeTeamId,
  decodePulseId,
  decodeQuestionId,
  decodeVersionId,
  decodeTemplateKey,
  decodeTimeZone,
  decodeEmail,
  decodeSendTime,
  decodeSendId,
  makeUrl,
  signedInAdmin,
} from "./appSceneFixtures.ts";

setup();

afterEach(() => {
  setLocale("en");
});

describe("App Scenes", () => {
  describe("Pulses list screen", () => {
    it("names the empty state instead of showing a blank list", () => {
      const teamId = decodeTeamId("team-1");
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/pulses`), []),
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
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/pulses`), []),
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
                  paused: true,
                  nextRoundDate: "2026-11-16",
                },
              ],
            },
          },
        }),
        Scene.expect(Scene.text("Weekly Pulse")).toExist(),
        // The row carries the Pulse's state and when it next runs.
        Scene.expect(Scene.text("Paused")).toExist(),
        Scene.expect(Scene.text("Next Round Nov 16, 2026")).toExist(),
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
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/pulses/${pulseId}`), []),
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
        // Editor controls: labelled icon buttons, and the Pulse/Rounds tabs
        Scene.expect(Scene.role("button", { name: "Move up" })).toBeDisabled(),
        Scene.expect(Scene.role("button", { name: "Move down" })).toBeDisabled(),
        Scene.expect(Scene.role("link", { name: "Pulse", current: "page" })).toExist(),
        Scene.expect(Scene.role("link", { name: "Rounds", current: "page" })).toBeAbsent(),
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
      ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/pulses/${pulseId}`), []),
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
});
