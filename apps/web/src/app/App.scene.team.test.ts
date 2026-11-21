import * as DateTime from "effect/DateTime";
import { ActionId, PulseId, RoundId } from "@surveybeat/domain";
import type { TeamOverview } from "@surveybeat/domain";
import { Schema } from "effect";
import * as Scene from "foldkit/scene";
import { setup } from "foldkit/test/vitest";
import { afterEach, describe, expect, it } from "vitest";
import {
  AddMember,
  AssignLead,
  GetTeam,
  initialModel,
  Message,
  RemoveMember,
  update,
  UpdateTeam,
  view,
} from "./App.ts";
import { formatDate, formatRoundDate, setLocale } from "../messages/locale.ts";
import {
  instant,
  decodeTeamId,
  decodePersonId,
  decodeTimeZone,
  decodeEmail,
  decodeSendTime,
  makeUrl,
  signedInAdmin,
} from "./appSceneFixtures.ts";

setup();

afterEach(() => {
  setLocale("en");
});

describe("App Scenes", () => {
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
            since: 1_700_000_000_000,
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
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}`), []),
          session: signedInAdmin,
          teamDetail: { _tag: "Loaded", detail },
          renameName: detail.team.name,
          renameTimeZone: detail.team.timeZone,
        }),
        Scene.expect(Scene.role("heading", { name: "Old Team Name" })).toExist(),
        Scene.expect(Scene.text("alice@acme.com")).toExist(),
        Scene.expect(Scene.selector("wbr")).toExist(),
        Scene.expect(Scene.text("Member")).toExist(),
        // The row's removal sits behind its own Actions disclosure as a link-style button, not a solid one
        Scene.expect(Scene.role("button", { name: "Actions" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Remove" })).toHaveClass("text-danger"),
        Scene.expect(Scene.role("button", { name: "Remove" })).not.toHaveClass("bg-danger"),
        // Removing from the menu asks first; Cancel leaves the roster alone
        Scene.click(Scene.role("button", { name: "Remove" })),
        Scene.expect(Scene.role("alertdialog", { name: "Remove?" })).toExist(),
        Scene.click(Scene.role("button", { name: "Cancel" })),
        Scene.expect(Scene.role("alertdialog", { name: "Remove?" })).toBeAbsent(),
        Scene.Command.expectNone(),
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
            since: 1_700_000_000_000,
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
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}`), []),
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

    it("shows no row actions to a Team member who may not remove People", () => {
      const teamId = decodeTeamId("team-1");
      const personId = decodePersonId("person-1");

      const detail = {
        team: {
          id: teamId,
          name: "Old Team Name",
          timeZone: decodeTimeZone("UTC"),
          yourRole: "member" as const,
        },
        roster: [
          {
            personId,
            email: decodeEmail("alice@acme.com"),
            role: "member" as const,
            since: 1_700_000_000_000,
          },
        ],
        may: {
          update: false,
          manageLeads: false,
          manageMembers: false,
          managePulses: false,
          viewResults: true,
        },
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}`), []),
          session: signedInAdmin,
          teamDetail: { _tag: "Loaded", detail },
        }),
        Scene.expect(Scene.text("alice@acme.com")).toExist(),
        Scene.expect(Scene.role("button", { name: "Actions" })).toBeAbsent(),
        Scene.expect(Scene.role("button", { name: "Remove" })).toBeAbsent(),
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
            since: 1_700_000_000_000,
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
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}`), []),
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
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}`), []),
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
                    plannedOpenAt: instant("2026-11-09T09:00:00Z"),
                    openedAt: null,
                    plannedCloseAt: instant("2026-11-13T09:00:00Z"),
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
            ...initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}`), []),
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
                    plannedOpenAt: instant("2026-11-02T09:00:00Z"),
                    openedAt: instant("2026-11-02T09:00:00Z"),
                    plannedCloseAt: instant("2026-11-06T09:00:00Z"),
                    closedAt: instant("2026-11-06T09:00:00Z"),
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
      const committedAt = instant("2026-10-28T09:00:00Z");
      const doneAt = instant("2026-11-04T09:00:00Z");

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
            ...initialModel(teamUrl, []),
            session: signedInAdmin,
            teamDetail: { _tag: "Loaded", detail: detailWith(true) },
            teamOverview: { _tag: "Loaded", overview },
          }),
          Scene.expect(Scene.role("heading", { name: "Team health over time" })).toExist(),
          Scene.expect(Scene.role("img", { name: "Workload across all shared Rounds" })).toExist(),
          Scene.expect(Scene.role("img", { name: "Clarity across all shared Rounds" })).toExist(),
          Scene.expect(
            Scene.role("button", {
              name: `Committed ${formatDate(DateTime.makeUnsafe(committedAt))}: Fix standups`,
            }),
          ).toExist(),
          Scene.expect(
            Scene.text(`Committed ${formatDate(DateTime.makeUnsafe(committedAt))}: Fix standups`),
          ).toExist(),
          Scene.expect(
            Scene.role("button", {
              name: `Done ${formatDate(DateTime.makeUnsafe(doneAt))}: Fix standups`,
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
            ...initialModel(teamUrl, []),
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
            ...initialModel(teamUrl, []),
            session: signedInAdmin,
            teamDetail: { _tag: "Loaded", detail: detailWith(true) },
            teamOverview: { _tag: "Failed", failure: "Forbidden" },
          }),
          Scene.expect(Scene.role("heading", { name: "Team health over time" })).toBeAbsent(),
        );
      });

      it("ignores an overview that belongs to a Team the user has navigated away from", () => {
        const model = {
          ...initialModel(teamUrl, []),
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
          { ...initialModel(teamUrl, []), session: signedInAdmin },
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
            ...initialModel(teamUrl, []),
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
            ...initialModel(teamUrl, []),
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
});
