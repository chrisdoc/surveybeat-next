import { assert, describe, it, prop } from "@effect/vitest";
import { Schema } from "effect";
import type { MembershipRecord } from "../people/Directory.ts";
import { PersonId } from "../people/Identity.ts";
import { MembershipId, TeamId } from "../people/Team.ts";
import { PulseId } from "../pulses/Pulse.ts";
import { InvitationSummary, invitationSummaryOf } from "./InvitationSummary.ts";
import { RoundId, RoundList } from "./Round.ts";

const TEAM = TeamId.make("team-privacy");
const OPENED_AT = 1000;
const PLANNED_CLOSE_AT = 9000;

const memberships = (people: readonly PersonId[]): readonly MembershipRecord[] =>
  people.map((personId, index) => ({
    id: MembershipId.make(`membership-privacy-${index}`),
    teamId: TEAM,
    personId,
    role: "member",
    startedAt: index % 2 === 0 ? 2000 : 500,
    endedAt: null,
  }));

describe("InvitationSummary privacy (SPEC §7, ADR 0005)", () => {
  it("encodes to counts only, with no Person id", () => {
    const alpha = PersonId.make("person-0001-alpha");
    const bravo = PersonId.make("person-0002-bravo");
    const people = [alpha, bravo];
    const summary = invitationSummaryOf({
      round: { teamId: TEAM, openedAt: OPENED_AT, closedAt: null, plannedCloseAt: PLANNED_CLOSE_AT },
      invitedPersonIds: new Set([bravo]),
      memberships: memberships(people),
    });
    assert.isNotNull(summary);
    const json = JSON.stringify(Schema.encodeSync(InvitationSummary)(summary));
    for (const personId of people) assert.notInclude(json, personId);
    assert.deepStrictEqual(Object.keys(JSON.parse(json)), ["invited", "joinedAfterOpen"]);
  });

  it("keeps every Person id out of an anonymous Round's Rounds list on the wire", () => {
    const people = [PersonId.make("person-0003-charlie"), PersonId.make("person-0004-delta")];
    const list = Schema.encodeSync(RoundList)({
      pulseId: PulseId.make("pulse-privacy"),
      paused: false,
      rounds: [
        {
          id: RoundId.make("round-privacy"),
          pulseId: PulseId.make("pulse-privacy"),
          teamId: TEAM,
          status: "open",
          plannedOpenDate: "2026-11-18",
          plannedOpenAt: OPENED_AT,
          openedAt: OPENED_AT,
          plannedCloseAt: PLANNED_CLOSE_AT,
          closedAt: null,
          pulseName: "Weekly health",
          invitations: invitationSummaryOf({
            round: { teamId: TEAM, openedAt: OPENED_AT, closedAt: null, plannedCloseAt: PLANNED_CLOSE_AT },
            invitedPersonIds: new Set(people.slice(0, 1)),
            memberships: memberships(people),
          }),
        },
      ],
    });
    const json = JSON.stringify(list);
    for (const personId of people) assert.notInclude(json, personId);
    assert.deepStrictEqual(list.rounds[0]?.invitations, { invited: 1, joinedAfterOpen: 0 });
  });

  prop(
    "never leaks an input Person id into the encoded summary, for any Persons",
    { names: Schema.Array(Schema.String.pipe(Schema.check(Schema.isMinLength(8)))) },
    ({ names }) => {
      const people = names.map((name) => PersonId.make(`person-${name}`));
      const summary = invitationSummaryOf({
        round: { teamId: TEAM, openedAt: OPENED_AT, closedAt: null, plannedCloseAt: PLANNED_CLOSE_AT },
        invitedPersonIds: new Set(people.filter((_, index) => index % 3 === 0)),
        memberships: memberships(people),
      });
      assert.isNotNull(summary);
      const json = JSON.stringify(Schema.encodeSync(InvitationSummary)(summary));
      for (const personId of people) assert.notInclude(json, personId);
      assert.deepStrictEqual(Object.keys(JSON.parse(json)), ["invited", "joinedAfterOpen"]);
    },
  );
});
