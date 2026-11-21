import * as DateTime from "effect/DateTime";
import { RoundId } from "@surveybeat/domain";
import type { EmailSendProgress, FailedEmailStatus, HistoryRound } from "@surveybeat/domain";
import { Schema } from "effect";
import * as Scene from "foldkit/scene";
import { setup } from "foldkit/test/vitest";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClearKeptAnswersCmd,
  CorrectPersonEmail,
  GetSettings,
  initialModel,
  LeaveAfterErasureCmd,
  Message,
  OffboardOrganization,
  PollFailedEmailCmd,
  ResendFailedEmailCmd,
  update,
  UpdateAiProcessing,
  UpdateSettings,
  view,
} from "./App.ts";
import { formatDate, message, setLocale } from "../messages/locale.ts";
import type { FailedEmailResend } from "./directory.ts";
import type { KeptAnswers } from "./keptAnswers.ts";
import {
  decodeTeamId,
  decodePersonId,
  decodeVersionId,
  decodeEmail,
  decodeSize,
  decodeSendId,
  makeUrl,
  signedInAdmin,
} from "./appSceneFixtures.ts";

setup();

afterEach(() => {
  setLocale("en");
});

describe("App Scenes", () => {
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

    const loaded = (rounds: readonly HistoryRound[], keptAnswers: KeptAnswers, cleared = false) => ({
      ...initialModel(historyUrl, []),
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
        { ...initialModel(makeUrl("https://app.surveybeat.com/teams"), []), session: signedInAdmin },
        Message.UrlChanged({ url: historyUrl }),
      );

      expect(result.model.history).toEqual({ _tag: "Loading" });
      expect(result.commands?.map((command) => command.name)).toEqual(["GetMyHistoryCmd"]);
    });

    it("ignores a history response after the user has left the screen", () => {
      const model = {
        ...initialModel(makeUrl("https://app.surveybeat.com/teams"), []),
        session: signedInAdmin,
      };

      const stale = update(
        model,
        Message.GotMyHistory({ outcome: { _tag: "Success", history: { rounds: [shownRound] }, kept } }),
      );

      expect(stale.model.history).toEqual({ _tag: "Loading" });
    });

    it("shows the member's own answers beside the Team's score", () => {
      const meta = message("history.round.meta", {
        team: "Platform",
        date: formatDate(DateTime.makeUnsafe("2026-11-02T12:00:00Z")),
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
      const expectations: readonly (readonly [number, string])[] = [
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

    it("says once, above the Rounds, when no Round's answers are on this device", () => {
      Scene.scene(
        { update, view },
        Scene.given(loaded([soloRound(roundB, "Monthly pulse", "shown")], {})),
        Scene.expect(Scene.text(message("history.noAnswersHere"))).toExist(),
        Scene.expect(Scene.text("Not on this device")).toBeAbsent(),
        Scene.expect(Scene.role("columnheader", { name: "Your answer" })).toBeAbsent(),
        Scene.expect(Scene.role("columnheader", { name: "Team score" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Clear my answers on this device" })).toBeAbsent(),
      );
    });

    it("marks only the Rounds whose answers are on another device when some are here", () => {
      Scene.scene(
        { update, view },
        Scene.given(loaded([shownRound, soloRound(roundB, "Monthly pulse", "shown")], kept)),
        Scene.expect(Scene.text(message("history.noAnswersHere"))).toBeAbsent(),
        Scene.expect(Scene.text("5 · Clear")).toExist(),
        Scene.expect(Scene.text("Not on this device")).toExist(),
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
          ...initialModel(makeUrl("https://app.surveybeat.com/teams"), []),
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
        removedPeople: [],
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings"), []),
          session: signedInAdmin,
          settings: { _tag: "Loaded", settings },
          size: "4",
        }),
        Scene.expect(Scene.role("heading", { name: "Organization settings" })).toExist(),
        Scene.expect(Scene.text("alice@acme.com")).toExist(),
        Scene.expect(Scene.role("columnheader", { name: "Email" })).toExist(),
        Scene.expect(Scene.role("columnheader", { name: "Role" })).toExist(),
        Scene.expect(Scene.role("columnheader", { name: "Actions" })).toExist(),
        Scene.expect(Scene.text("Member")).toExist(),
        // The row's actions sit behind its own native Actions disclosure; Scene cannot toggle it.
        Scene.expect(Scene.role("button", { name: "Actions" })).toExist(),
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

  describe("Correcting a Person's email (GDPR 309)", () => {
    const personId = decodePersonId("person-1");

    const settingsOf = (
      people: readonly { readonly linked: boolean }[],
      removedPeople: readonly { readonly linked: boolean }[],
    ) => ({
      name: "Acme",
      minimumGroupSize: decodeSize(4),
      aiProcessing: false,
      defaultLocale: "en" as const,
      people: people.map(({ linked }) => ({
        personId,
        email: decodeEmail("pat@acme.com"),
        organizationAdmin: false,
        linked,
      })),
      removedPeople: removedPeople.map(({ linked }) => ({
        personId,
        email: decodeEmail("ghost@acme.com"),
        linked,
      })),
    });

    const settingsModel = (settings: ReturnType<typeof settingsOf>) => ({
      ...initialModel(makeUrl("https://app.surveybeat.com/settings"), []),
      session: signedInAdmin,
      settings: { _tag: "Loaded" as const, settings },
      size: "4",
    });

    it("gives a Person who has not signed in a Correct email control, and no one else", () => {
      Scene.scene(
        { update, view },
        Scene.given(settingsModel(settingsOf([{ linked: false }], []))),
        Scene.expect(Scene.role("button", { name: "Correct email" })).toExist(),
      );
      Scene.scene(
        { update, view },
        Scene.given(settingsModel(settingsOf([{ linked: true }], []))),
        Scene.expect(Scene.role("button", { name: "Correct email" })).toBeAbsent(),
      );
      Scene.scene(
        { update, view },
        Scene.given(settingsModel(settingsOf([], [{ linked: false }]))),
        Scene.expect(Scene.role("button", { name: "Correct email" })).toExist(),
      );
      Scene.scene(
        { update, view },
        Scene.given(settingsModel(settingsOf([], [{ linked: true }]))),
        Scene.expect(Scene.role("button", { name: "Correct email" })).toBeAbsent(),
      );
    });

    it("sends the corrected address and reloads the People", () => {
      Scene.scene(
        { update, view },
        Scene.given(settingsModel(settingsOf([{ linked: false }], []))),
        Scene.click(Scene.role("button", { name: "Correct email" })),
        Scene.expect(Scene.role("heading", { name: "Correct the email address of pat@acme.com" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Save address" })).toBeDisabled(),
        Scene.type(Scene.label("Correct email address"), " pat.new@acme.com "),
        Scene.click(Scene.role("button", { name: "Save address" })),
        Scene.Command.expectHas(CorrectPersonEmail({ personId, email: "pat.new@acme.com" })),
        Scene.Command.resolve(CorrectPersonEmail, Message.CorrectedEmail({ outcome: { _tag: "Success" } })),
        Scene.expect(Scene.label("Correct email address")).toBeAbsent(),
        Scene.Command.expectHas(GetSettings),
        Scene.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: {
              _tag: "Success",
              settings: {
                ...settingsOf([{ linked: false }], []),
                people: [
                  {
                    personId,
                    email: decodeEmail("pat.new@acme.com"),
                    organizationAdmin: false,
                    linked: false,
                  },
                ],
              },
            },
          }),
        ),
        Scene.expect(Scene.text("pat.new@acme.com")).toExist(),
        Scene.expect(Scene.text("pat@acme.com")).toBeAbsent(),
      );
    });

    it("keeps the form open and says why when the address is refused", () => {
      Scene.scene(
        { update, view },
        Scene.given(settingsModel(settingsOf([{ linked: false }], []))),
        Scene.click(Scene.role("button", { name: "Correct email" })),
        Scene.type(Scene.label("Correct email address"), "bob@acme.com"),
        Scene.click(Scene.role("button", { name: "Save address" })),
        Scene.Command.resolve(
          CorrectPersonEmail,
          Message.CorrectedEmail({ outcome: { _tag: "Failure", failure: "EmailTaken" } }),
        ),
        Scene.expect(
          Scene.text("That address already belongs to someone else. Use a different one."),
        ).toExist(),
        Scene.expect(Scene.label("Correct email address")).toExist(),
        Scene.click(Scene.role("button", { name: "Cancel" })),
        Scene.expect(Scene.label("Correct email address")).toBeAbsent(),
      );
    });
  });

  describe("Deleting the Organization (GDPR 308)", () => {
    const settings = {
      name: "Acme",
      minimumGroupSize: decodeSize(4),
      aiProcessing: false,
      defaultLocale: "en" as const,
      people: [],
      removedPeople: [],
    };

    const settingsModel = (offboardingDownloaded: boolean) => ({
      ...initialModel(makeUrl("https://app.surveybeat.com/settings"), []),
      session: signedInAdmin,
      settings: { _tag: "Loaded" as const, settings },
      size: "4",
      offboardingDownloaded,
    });

    it("offers no deletion until the export has been downloaded", () => {
      Scene.scene(
        { update, view },
        Scene.given(settingsModel(false)),
        Scene.expect(Scene.role("link", { name: "Download a copy first" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Delete this Organization" })).toBeAbsent(),
      );
    });

    it("offers the delete control once the export is downloaded", () => {
      Scene.scene(
        { update, view },
        Scene.given(settingsModel(false)),
        Scene.click(Scene.role("link", { name: "Download a copy first" })),
        Scene.expect(Scene.role("button", { name: "Delete this Organization" })).toExist(),
      );
    });

    it("sends the typed name with the deletion, then leaves the app", () => {
      Scene.scene(
        { update, view },
        Scene.given(settingsModel(true)),
        Scene.click(Scene.role("button", { name: "Delete this Organization" })),
        Scene.expect(Scene.label("Type the Organization name to confirm")).toExist(),
        Scene.expect(Scene.role("button", { name: "Delete permanently" })).toBeDisabled(),
        Scene.type(Scene.label("Type the Organization name to confirm"), "Acme"),
        Scene.expect(Scene.role("button", { name: "Delete permanently" })).toBeEnabled(),
        Scene.click(Scene.role("button", { name: "Delete permanently" })),
        Scene.Command.expectHas(OffboardOrganization({ confirmation: "Acme" })),
        Scene.Command.resolve(
          OffboardOrganization,
          Message.OffboardedOrganization({ outcome: { _tag: "Success" } }),
        ),
        Scene.Command.expectHas(LeaveAfterErasureCmd),
        Scene.Command.resolve(LeaveAfterErasureCmd, Message.LeftAfterErasure()),
      );
    });

    it("shows the name mismatch and keeps the form open, then cancels and clears it", () => {
      Scene.scene(
        { update, view },
        Scene.given(settingsModel(true)),
        Scene.click(Scene.role("button", { name: "Delete this Organization" })),
        Scene.type(Scene.label("Type the Organization name to confirm"), "acme"),
        Scene.click(Scene.role("button", { name: "Delete permanently" })),
        Scene.Command.expectHas(OffboardOrganization({ confirmation: "acme" })),
        Scene.Command.resolve(
          OffboardOrganization,
          Message.OffboardedOrganization({
            outcome: { _tag: "Failure", failure: "OrganizationNotConfirmed" },
          }),
        ),
        Scene.expect(Scene.text("That is not the Organization name. Type it exactly to confirm.")).toExist(),
        Scene.expect(Scene.label("Type the Organization name to confirm")).toExist(),
        Scene.expect(Scene.role("button", { name: "Delete permanently" })).toBeEnabled(),
        Scene.click(Scene.role("button", { name: "Cancel" })),
        Scene.expect(Scene.label("Type the Organization name to confirm")).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Delete this Organization" })).toExist(),
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
      removedPeople: [],
    };

    const failedAt = 1_800_000_000_000;

    it("shows that no email has failed", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings"), []),
          session: signedInAdmin,
          settings: { _tag: "Loaded", settings },
          size: "4",
          failedEmails: { _tag: "Loaded", list: { emails: [] } },
        }),
        Scene.expect(Scene.role("heading", { name: "Failed emails" })).toExist(),
        Scene.expect(
          Scene.text("Emails that can't be delivered show up here, so you can send them again."),
        ).toExist(),
      );
    });

    it("lists each failed send with its kind, recipient, reason, code, and time", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings"), []),
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
          Scene.text(formatDate(DateTime.makeUnsafe(failedAt), { dateStyle: "medium", timeStyle: "short" })),
        ).toExist(),
        Scene.expect(
          Scene.text("Emails that can't be delivered show up here, so you can send them again."),
        ).toBeAbsent(),
      );
    });

    it("shows a load failure as a short error line", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings"), []),
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
        ...initialModel(makeUrl("https://app.surveybeat.com/settings"), []),
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
        { ...initialModel(makeUrl("https://app.surveybeat.com/teams"), []), session: signedInAdmin },
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
        removedPeople: [],
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings"), []),
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
});
