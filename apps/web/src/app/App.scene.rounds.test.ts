import * as DateTime from "effect/DateTime";
import { RoundId } from "@surveybeat/domain";
import type { RoundDetail, RoundResult, RoundSummary, TeamId } from "@surveybeat/domain";
import { Schema } from "effect";
import * as Scene from "foldkit/scene";
import { setup } from "foldkit/test/vitest";
import { afterEach, describe, it } from "vitest";
import {
  CancelRoundCmd,
  CloseRoundEarlyCmd,
  GetResultsCmd,
  GetRoundDetailCmd,
  GetRoundRateCmd,
  initialModel,
  ListRoundsCmd,
  Message,
  PausePulseCmd,
  ResendInvitationCmd,
  ResumePulseCmd,
  RetryResultCmd,
  SaveRoundNoteCmd,
  ShareResultsCmd,
  SkipWeekCmd,
  update,
  view,
} from "./App.ts";
import { formatDate, setLocale } from "../messages/locale.ts";
import {
  instant,
  decodeTeamId,
  decodePulseId,
  decodePersonId,
  decodeTimeZone,
  decodeEmail,
  makeUrl,
  signedInAdmin,
} from "./appSceneFixtures.ts";

setup();

afterEach(() => {
  setLocale("en");
});

describe("App Scenes", () => {
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
      closedAt: 1_731_140_000_000,
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
          since: 1_700_000_000_000,
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
    const updatedAt = 1_731_150_000_000;

    const savedNote = {
      roundId,
      text: noteText,
      updatedAt,
    };

    it("lets the Lead write a Note, save it, and then see it with its date", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(url, []),
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
        Scene.expect(Scene.text(`Last changed ${formatDate(DateTime.makeUnsafe(updatedAt))}`)).toExist(),
        Scene.expect(Scene.role("button", { name: "Edit note" })).toExist(),
      );
    });

    it("shows a member the Note text and date without any edit control", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(url, []),
          session: signedInAdmin,
          results: { _tag: "Loaded", result: closedResult },
          teamDetail: { _tag: "Loaded", detail: teamDetailFor("member") },
          actions: { _tag: "Loaded", actions: [] },
          roundNote: { _tag: "Loaded", note: savedNote },
        }),
        Scene.expect(Scene.role("heading", { name: "Note from your Lead" })).toExist(),
        Scene.expect(Scene.text(noteText)).toExist(),
        Scene.expect(Scene.text(`Last changed ${formatDate(DateTime.makeUnsafe(updatedAt))}`)).toExist(),
        Scene.expect(Scene.role("button", { name: "Edit note" })).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Write note" })).toBeAbsent(),
      );
    });

    it("hides the Note section from a member when the Lead has written no Note", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(url, []),
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
          ...initialModel(url, []),
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
          ...initialModel(url, []),
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
          ...initialModel(url, []),
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
      const reviewEndsAt = 1_731_400_000_000;
      const reviewDate = formatDate(DateTime.makeUnsafe(reviewEndsAt));

      const readyResult: RoundResult = {
        roundId,
        pulseId,
        teamId,
        status: "ready",
        plannedOpenDate: "2026-11-09",
        anonymityMode: "anonymous",
        closedAt: 1_731_140_000_000,
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
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`), []),
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
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`), []),
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
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`), []),
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
        closedAt: 1_731_140_000_000,
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
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`), []),
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
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`), []),
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
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`), []),
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
      plannedOpenAt: instant(`${plannedOpenDate}T09:00:00Z`),
      openedAt: status === "scheduled" ? null : instant(`${plannedOpenDate}T09:00:00Z`),
      plannedCloseAt: instant(`${plannedOpenDate}T09:00:00Z`) + 3 * 86_400_000,
      closedAt: status === "closed" ? instant(`${plannedOpenDate}T09:00:00Z`) + 3 * 86_400_000 : null,
      pulseName: "Weekly check-in",
      invitations: null,
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
      plannedOpenAt: 1_731_140_000_000,
      openedAt: 1_731_140_000_000,
      plannedCloseAt: 1_731_400_000_000,
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
      createdAt: 1_731_100_000_000,
    };

    const given = (yourRole: "lead" | "member" | null) => ({
      ...initialModel(url, []),
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

    it("shows Review and share on a Ready Round, and only there", () => {
      const readyId = Schema.decodeSync(RoundId)("round-ready");
      Scene.scene(
        { update, view },
        Scene.given({
          ...given("lead"),
          rounds: {
            _tag: "Loaded" as const,
            list: { ...rounds, rounds: [summary(readyId, "ready", "2026-11-09")] },
          },
          roundDetails: {},
          roundRates: {},
        }),
        Scene.expect(Scene.text("Ready")).toExist(),
        Scene.expect(Scene.role("link", { name: "Review and share" })).toExist(),
        Scene.expect(Scene.role("link", { name: "View Results" })).toBeAbsent(),
      );
    });

    it("titles a Round by its planned open date, the date Results and History show, even when it opened early", () => {
      const earlyId = Schema.decodeSync(RoundId)("round-early");

      const early: RoundSummary = {
        ...summary(earlyId, "open", "2026-11-23"),
        openedAt: instant("2026-11-19T09:00:00Z"),
        plannedCloseAt: instant("2026-11-26T09:00:00Z"),
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...given("lead"),
          rounds: { _tag: "Loaded" as const, list: { ...rounds, rounds: [early] } },
          roundDetails: {},
          roundRates: {},
        }),
        Scene.expect(Scene.text("Round Nov 23, 2026")).toExist(),
        Scene.expect(Scene.text("Round Nov 19, 2026")).toBeAbsent(),
        Scene.expect(Scene.text("Nov 19, 2026 to Nov 26, 2026")).toExist(),
      );
    });

    it("titles a Round by the Team's calendar day when its open instant falls on another day for the viewer", () => {
      const aheadId = Schema.decodeSync(RoundId)("round-ahead");

      const ahead: RoundSummary = {
        ...summary(aheadId, "scheduled", "2026-11-23"),
        plannedOpenAt: instant("2026-11-22T20:00:00Z"),
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...given("lead"),
          rounds: { _tag: "Loaded" as const, list: { ...rounds, rounds: [ahead] } },
          roundDetails: {},
          roundRates: {},
        }),
        Scene.expect(Scene.text("Round Nov 23, 2026")).toExist(),
        Scene.expect(Scene.text("Round Nov 22, 2026")).toBeAbsent(),
      );
    });

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

    it("tells a Lead who was invited to a Round and who joined after it opened", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...given("lead"),
          rounds: {
            _tag: "Loaded" as const,
            list: {
              ...rounds,
              rounds: [
                {
                  ...summary(openId, "open", "2026-11-09"),
                  invitations: { invited: 1, joinedAfterOpen: 2 },
                },
                {
                  ...summary(closedId, "closed", "2026-11-02"),
                  invitations: { invited: 0, joinedAfterOpen: 0 },
                },
              ],
            },
          },
          roundDetails: {},
          roundRates: {},
        }),
        Scene.expect(Scene.text("Invited 1 Person")).toExist(),
        Scene.expect(
          Scene.text("2 People joined after this Round opened: invited from the next Round"),
        ).toExist(),
        Scene.expect(
          Scene.text("Nobody to invite: the Team had no Members when this Round opened."),
        ).toExist(),
      );
    });

    it("tells a Lead about a Round with several invitees and a single late joiner", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...given("lead"),
          rounds: {
            _tag: "Loaded" as const,
            list: {
              ...rounds,
              rounds: [
                {
                  ...summary(openId, "open", "2026-11-09"),
                  invitations: { invited: 3, joinedAfterOpen: 1 },
                },
              ],
            },
          },
          roundDetails: {},
          roundRates: {},
        }),
        Scene.expect(Scene.text("Invited 3 People")).toExist(),
        Scene.expect(
          Scene.text("1 Person joined after this Round opened: invited from the next Round"),
        ).toExist(),
        Scene.expect(
          Scene.text("Nobody to invite: the Team had no Members when this Round opened."),
        ).toBeAbsent(),
      );
    });

    it("does not show invitation counts to a Member", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...given("member"),
          rounds: {
            _tag: "Loaded" as const,
            list: {
              ...rounds,
              rounds: [
                {
                  ...summary(openId, "open", "2026-11-09"),
                  invitations: { invited: 3, joinedAfterOpen: 1 },
                },
              ],
            },
          },
          roundDetails: {},
          roundRates: {},
        }),
        Scene.expect(Scene.text("Invited 3 People")).toBeAbsent(),
        Scene.expect(
          Scene.text("1 Person joined after this Round opened: invited from the next Round"),
        ).toBeAbsent(),
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
});
