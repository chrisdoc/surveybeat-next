import { RoundId } from "@surveybeat/domain";
import { Schema } from "effect";
import * as Story from "foldkit/story";
import { afterEach, describe, it } from "vitest";
import {
  GetRoundDetailCmd,
  GetRoundRateCmd,
  GetTeam,
  initialModel,
  ListRoundsCmd,
  Message,
  update,
} from "./App.ts";
import { setLocale } from "../messages/locale.ts";
import { decodeOrgId, decodeTeamId, decodePulseId, decodeTimeZone, makeUrl } from "./appStoryFixtures.ts";

afterEach(() => {
  setLocale("en");
});

describe("App Stories", () => {
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
      plannedOpenAt: 1_731_140_000_000,
      openedAt: 1_731_140_000_000,
      plannedCloseAt: 1_731_400_000_000,
      closedAt: status === "closed" ? 1_731_400_000_000 : null,
      pulseName: "Weekly check-in",
      invitations: null,
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
      ...initialModel(url, []),
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
});
