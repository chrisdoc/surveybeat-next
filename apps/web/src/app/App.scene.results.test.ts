import * as DateTime from "effect/DateTime";
import { ActionId, RoundId } from "@surveybeat/domain";
import type { ActionItem, RoundResult, TeamId } from "@surveybeat/domain";
import { Option, Schema } from "effect";
import * as Scene from "foldkit/scene";
import { setup } from "foldkit/test/vitest";
import { afterEach, describe, expect, it } from "vitest";
import {
  CopyGuideTextCmd,
  CreateActionCmd,
  initialModel,
  Message,
  update,
  UpdateActionCmd,
  view,
} from "./App.ts";
import { formatRoundDate, message, setLocale } from "../messages/locale.ts";
import {
  decodeTeamId,
  decodePulseId,
  decodePersonId,
  decodeVersionId,
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
        closedAt: 1_731_140_000_000,
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
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`), []),
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
        closedAt: 1_731_140_000_000,
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
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`), []),
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
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`), []),
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
            since: 1_700_000_000_000,
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
        createdAt: 1_731_145_000_000,
        updatedAt: 1_731_145_000_000,
        doneAt: null,
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`), []),
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
              action: { ...committedAction, status: "done", doneAt: 1_731_150_000_000 },
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
        ...initialModel(makeUrl("https://app.surveybeat.com/teams/team-1/rounds/round-1"), []),
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
        closedAt: 1_731_140_000_000,
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
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}/rounds/${roundId}`), []),
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
        closedAt: 1_731_140_000_000,
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
        ...initialModel(makeUrl("https://app.surveybeat.com/teams/team-1/rounds/round-trend"), []),
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
      ...overrides,
    });

    const bareScene = (result: RoundResult) =>
      Scene.given({
        ...initialModel(makeUrl("https://app.surveybeat.com/teams/team-1/rounds/round-bare"), []),
        session: signedInAdmin,
        results: { _tag: "Loaded" as const, result },
        teamDetail: { _tag: "Loaded" as const, detail: leadTeamDetail(decodeTeamId("team-1")) },
        actions: { _tag: "Loaded" as const, actions: [] },
      });

    it("puts Share with the team and the Review countdown in front of a Lead's Ready Results", () => {
      const reviewEndsAt = DateTime.toEpochMillis(DateTime.nowUnsafe()) + 2 * 86_400_000 - 3_600_000;
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

    describe("Trend panel is only for Rating Questions", () => {
      const roundId = Schema.decodeSync(RoundId)("round-bare");

      const choiceQuestion = (
        trend: RoundResult["questions"][number]["trend"],
      ): RoundResult["questions"][number] => ({
        questionVersionId: decodeVersionId("qv-choice"),
        position: 0,
        text: "Which option fits best?",
        type: { _tag: "SingleChoice", options: ["Yes", "No"] },
        dimension: null,
        contributors: 6,
        meetsMinimumGroupSize: true,
        score: null,
        distribution: [
          { option: "Yes", count: 0 },
          { option: "No", count: 6 },
        ],
        change: null,
        typicalChange: null,
        trend,
      });

      it("shows a distribution for a Single choice Question and answers for a Long text Question", () => {
        Scene.scene(
          { update, view },
          bareScene(
            bareResult({
              questions: [
                choiceQuestion([]),
                {
                  questionVersionId: decodeVersionId("qv-long"),
                  position: 1,
                  text: "Anything else?",
                  type: { _tag: "LongText" },
                  dimension: null,
                  contributors: 6,
                  meetsMinimumGroupSize: true,
                  score: null,
                  distribution: null,
                  change: null,
                  typicalChange: null,
                  trend: [],
                },
              ],
              comments: [{ questionVersionId: decodeVersionId("qv-long"), text: "Keep the standups short." }],
            }),
          ),
          Scene.expect(Scene.role("heading", { name: "Distribution" })).toExist(),
          Scene.expect(Scene.role("heading", { name: "Answers" })).toExist(),
          Scene.expect(Scene.text("Keep the standups short.")).toExist(),
        );
      });

      it("hides a stored trend on a Single choice Question instead of drawing an empty 1–5 panel", () => {
        Scene.scene(
          { update, view },
          bareScene(
            bareResult({
              questions: [
                choiceQuestion([
                  {
                    roundId,
                    plannedOpenDate: "2026-11-09",
                    score: null,
                    contributors: 6,
                    hasGap: true,
                  },
                ]),
              ],
            }),
          ),
          Scene.expect(Scene.role("heading", { name: "Distribution" })).toExist(),
          Scene.expect(Scene.role("heading", { name: "1-Round trend" })).toBeAbsent(),
        );
      });
    });

    describe("Highlights, number and date formats, and the Actions panel", () => {
      /** A closed Round with one flagged Question and one Dimension, so the badge and formats are on screen. */
      const flaggedResult = (direction: "rise" | "drop", questionScore: number): RoundResult => ({
        roundId: Schema.decodeSync(RoundId)("round-flagged"),
        pulseId: decodePulseId("pulse-1"),
        teamId: decodeTeamId("team-1"),
        status: "closed",
        plannedOpenDate: "2026-11-09",
        anonymityMode: "anonymous",
        closedAt: 1_731_140_000_000,
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

      const flaggedScene = (result: RoundResult) =>
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/teams/team-1/rounds/round-flagged"), []),
          session: signedInAdmin,
          results: { _tag: "Loaded", result },
          teamDetail: { _tag: "Loaded", detail: leadTeamDetail(decodeTeamId("team-1")) },
          actions: { _tag: "Loaded", actions: [] },
        });

      it("draws an up arrow for a rise and explains the usual move", () => {
        Scene.scene(
          { update, view },
          flaggedScene(flaggedResult("rise", 4.2)),
          Scene.expect(Scene.text("Bigger change than usual for this Team")).toExist(),
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

      it("formats scores, changes, Round dates and percentages in English", () => {
        Scene.scene(
          { update, view },
          flaggedScene(flaggedResult("rise", 3.6)),
          Scene.expect(Scene.text("Round Nov 9, 2026")).toExist(),
          Scene.expect(Scene.text("4.0 / 5")).toExist(),
          Scene.expect(Scene.text("3.6 / 5")).toExist(),
          Scene.expect(Scene.text("+0.7 since last Round (Nov 2, 2026)")).toExist(),
          Scene.expect(Scene.text("Usually moves about ±0.3 between Rounds")).toExist(),
          Scene.expect(Scene.text("75%")).toExist(),
          Scene.expect(Scene.text("6 of 8")).toExist(),
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
        ...initialModel(url, []),
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
});
