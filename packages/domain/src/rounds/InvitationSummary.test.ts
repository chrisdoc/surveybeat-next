import { assert, describe, expect, it, prop } from "@effect/vitest";
import { Schema } from "effect";
import type { MembershipRecord } from "../people/Directory.ts";
import { PersonId } from "../people/Identity.ts";
import { MembershipId, TeamId } from "../people/Team.ts";
import { invitationSummaryOf } from "./InvitationSummary.ts";
import type { InvitationSummaryRound } from "./InvitationSummary.ts";

const TEAM = TeamId.make("team-a");
const OTHER_TEAM = TeamId.make("team-b");
const ALICE = PersonId.make("alice");
const BOB = PersonId.make("bob");
const CARA = PersonId.make("cara");

const round = (overrides: Partial<InvitationSummaryRound> = {}): InvitationSummaryRound => ({
  teamId: TEAM,
  openedAt: 1000,
  closedAt: null,
  plannedCloseAt: 5000,
  ...overrides,
});

const membership = (
  personId: PersonId,
  startedAt: number,
  overrides: Partial<Pick<MembershipRecord, "role" | "teamId" | "endedAt">> = {},
): MembershipRecord => {
  const teamId = overrides.teamId ?? TEAM;
  const role = overrides.role ?? "member";
  return {
    id: MembershipId.make(`membership-${teamId}-${personId}-${role}-${startedAt}`),
    teamId,
    personId,
    role,
    startedAt,
    endedAt: overrides.endedAt ?? null,
  };
};

const invited = (...personIds: readonly PersonId[]): ReadonlySet<PersonId> => new Set(personIds);

describe("invitationSummaryOf", () => {
  it("does not count a Person who joined after open and left before the window ended", () => {
    expect(
      invitationSummaryOf({
        round: round(),
        invitedPersonIds: invited(ALICE),
        memberships: [
          membership(ALICE, 500),
          membership(BOB, 2000, { endedAt: 3000 }),
          membership(CARA, 2000, { endedAt: 6000 }),
        ],
      }),
    ).toStrictEqual({ invited: 1, joinedAfterOpen: 1 });
  });

  it("is null for a Round that never opened", () => {
    expect(
      invitationSummaryOf({
        round: round({ openedAt: null }),
        invitedPersonIds: invited(),
        memberships: [membership(ALICE, 2000)],
      }),
    ).toBeNull();
  });

  it("counts zero invitations when the Team had no one to invite at open", () => {
    expect(
      invitationSummaryOf({ round: round(), invitedPersonIds: invited(), memberships: [] }),
    ).toStrictEqual({ invited: 0, joinedAfterOpen: 0 });
  });

  it("counts the Persons who received an Invitation", () => {
    expect(
      invitationSummaryOf({
        round: round(),
        invitedPersonIds: invited(ALICE, BOB),
        memberships: [membership(ALICE, 500), membership(BOB, 500)],
      }),
    ).toStrictEqual({ invited: 2, joinedAfterOpen: 0 });
  });

  it("counts a Person who joined after the Round opened and was not invited", () => {
    expect(
      invitationSummaryOf({
        round: round(),
        invitedPersonIds: invited(ALICE),
        memberships: [membership(ALICE, 500), membership(BOB, 2000)],
      }),
    ).toStrictEqual({ invited: 1, joinedAfterOpen: 1 });
  });

  it("does not count a Person who joined before the Round opened", () => {
    expect(
      invitationSummaryOf({
        round: round(),
        invitedPersonIds: invited(),
        memberships: [membership(ALICE, 500), membership(BOB, 1000)],
      }),
    ).toStrictEqual({ invited: 0, joinedAfterOpen: 0 });
  });

  it("does not count a Person who joined after the Round closed", () => {
    expect(
      invitationSummaryOf({
        round: round({ closedAt: 3000 }),
        invitedPersonIds: invited(),
        memberships: [membership(ALICE, 3001), membership(BOB, 3000)],
      }),
    ).toStrictEqual({ invited: 0, joinedAfterOpen: 1 });
  });

  it("uses the planned close while the Round is still open", () => {
    expect(
      invitationSummaryOf({
        round: round({ plannedCloseAt: 5000 }),
        invitedPersonIds: invited(),
        memberships: [membership(ALICE, 5000), membership(BOB, 5001)],
      }),
    ).toStrictEqual({ invited: 0, joinedAfterOpen: 1 });
  });

  it("does not count a Person who rejoined after open and already has an Invitation", () => {
    expect(
      invitationSummaryOf({
        round: round(),
        invitedPersonIds: invited(ALICE),
        memberships: [membership(ALICE, 2000)],
      }),
    ).toStrictEqual({ invited: 1, joinedAfterOpen: 0 });
  });

  it("ignores Viewers and Memberships in other Teams", () => {
    expect(
      invitationSummaryOf({
        round: round(),
        invitedPersonIds: invited(),
        memberships: [
          membership(ALICE, 2000, { role: "viewer" }),
          membership(BOB, 2000, { teamId: OTHER_TEAM }),
        ],
      }),
    ).toStrictEqual({ invited: 0, joinedAfterOpen: 0 });
  });

  it("counts a Lead who joined after open", () => {
    expect(
      invitationSummaryOf({
        round: round(),
        invitedPersonIds: invited(),
        memberships: [membership(ALICE, 2000, { role: "lead" })],
      }),
    ).toStrictEqual({ invited: 0, joinedAfterOpen: 1 });
  });

  it("counts a Person with two Memberships once", () => {
    expect(
      invitationSummaryOf({
        round: round(),
        invitedPersonIds: invited(),
        memberships: [membership(CARA, 2000), membership(CARA, 3000, { role: "lead" })],
      }),
    ).toStrictEqual({ invited: 0, joinedAfterOpen: 1 });
  });

  const MemberPool = Schema.Literals(["alice", "bob", "cara", "dan"]);
  const TeamPool = Schema.Literals(["team-a", "team-b"]);
  const RolePool = Schema.Literals(["lead", "member", "viewer"]);
  const instant = Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100)),
  );
  const MembershipShape = Schema.Struct({
    person: MemberPool,
    team: TeamPool,
    role: RolePool,
    startedAt: instant,
  });

  prop(
    "counts the distinct eligible Persons who were not invited, and ignores duplicate Memberships",
    {
      openedAt: instant,
      closedAt: Schema.NullOr(instant),
      plannedCloseAt: instant,
      memberships: Schema.Array(MembershipShape),
      invitedPeople: Schema.Array(MemberPool),
    },
    ({ openedAt, closedAt, plannedCloseAt, memberships, invitedPeople }) => {
      const invitedIds = new Set(invitedPeople.map((p) => PersonId.make(p)));
      const records = memberships.map((m) =>
        membership(PersonId.make(m.person), m.startedAt, {
          teamId: TeamId.make(m.team),
          role: m.role,
        }),
      );
      const subject = { round: round({ openedAt, closedAt, plannedCloseAt }), invitedPersonIds: invitedIds };
      const windowEnd = closedAt ?? plannedCloseAt;
      const expectedJoined = new Set(
        records
          .filter(
            (m) =>
              m.teamId === TEAM &&
              (m.role === "lead" || m.role === "member") &&
              m.startedAt > openedAt &&
              m.startedAt <= windowEnd &&
              !invitedIds.has(m.personId),
          )
          .map((m) => m.personId),
      ).size;

      const summary = invitationSummaryOf({ ...subject, memberships: records });
      assert.deepStrictEqual(summary, { invited: invitedIds.size, joinedAfterOpen: expectedJoined });
      assert.deepStrictEqual(
        invitationSummaryOf({ ...subject, memberships: [...records, ...records] }),
        summary,
      );
    },
  );
});
