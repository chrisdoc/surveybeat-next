import { describe, expect, it, prop } from "@effect/vitest";
import { DateTime, Schema } from "effect";
import { EmailAddress } from "../email/Email.ts";
import type { DirectoryState, MembershipRecord, PersonRecord } from "../people/Directory.ts";
import { PersonId } from "../people/Identity.ts";
import { MembershipId, TeamId, TimeZone } from "../people/Team.ts";
import type { MembershipRole } from "../people/Team.ts";
import type { PulseRecord, PulseState } from "../pulses/Editor.ts";
import { PulseId, SendTime } from "../pulses/Pulse.ts";
import { RoundId } from "./Round.ts";
import type { RoundStatus } from "./Round.ts";
import { roundCommandRejection } from "./Lifecycle.ts";
import type { RoundCommand, RoundCommandTag, RoundRejection } from "./Lifecycle.ts";
import { decideRoundCommand } from "./RoundCommand.ts";
import type { RoundCommandDecision, RoundCommandInput, RoundFacts } from "./RoundCommand.ts";

const NOW = Date.UTC(2026, 10, 17, 12);

const WEEK_OF_NOW = "2026-11-17";

const TEAM_A = TeamId.make("team-a");

const TEAM_B = TeamId.make("team-b");

const PULSE_A = PulseId.make("pulse-a");

const PULSE_B = PulseId.make("pulse-b");

const ROUND_A = RoundId.make("round-a");

const ROUND_B = RoundId.make("round-b");

const LEAD_A = PersonId.make("lead-a");

const LEAD_B = PersonId.make("lead-b");

const MEMBER_A = PersonId.make("member-a");

const ADMIN = PersonId.make("admin");

const OUTSIDER = PersonId.make("outsider");

const REMOVED = PersonId.make("removed");

const ABSENT = PersonId.make("absent");

const person = (id: PersonId, extra: Partial<PersonRecord> = {}): PersonRecord => ({
  id,
  email: EmailAddress.make(`${id}@example.com`),
  authUserId: null,
  organizationAdmin: false,
  removedAt: null,
  erasedAt: null,
  locale: null,
  detectedLocale: null,
  ...extra,
});

const membership = (
  id: string,
  teamId: TeamId,
  personId: PersonId,
  role: MembershipRole,
): MembershipRecord => ({
  id: MembershipId.make(id),
  teamId,
  personId,
  role,
  startedAt: 0,
  endedAt: null,
});

const pulseOn = (id: PulseId, teamId: TeamId): PulseRecord => ({
  id,
  teamId,
  settings: {
    name: "Weekly",
    cadence: { _tag: "Weekly", day: "tuesday", time: SendTime.make("09:00") },
    answerWindowDays: 3,
    reviewWindowDays: 0,
    reminders: 0,
    anonymityMode: "anonymous",
    distribution: "invitation",
  },
  createdAt: 0,
  questions: [],
});

const directoryFor = (teamA: TeamId, teamB: TeamId): DirectoryState => ({
  organizationName: "Acme",
  minimumGroupSize: 4,
  aiProcessing: false,
  defaultLocale: "en",
  people: [
    person(ADMIN, { organizationAdmin: true }),
    person(LEAD_A),
    person(LEAD_B),
    person(MEMBER_A),
    person(OUTSIDER),
    person(REMOVED, { removedAt: 1 }),
  ],
  teams: [
    { id: teamA, name: "Team A", timeZone: TimeZone.make("UTC") },
    { id: teamB, name: "Team B", timeZone: TimeZone.make("UTC") },
  ],
  memberships: [
    membership("m-lead-a", teamA, LEAD_A, "lead"),
    membership("m-member-a", teamA, MEMBER_A, "member"),
    membership("m-lead-b", teamB, LEAD_B, "lead"),
  ],
});

const pulsesFor = (teamA: TeamId, teamB: TeamId): PulseState => ({
  questions: [],
  versions: [],
  pulses: [pulseOn(PULSE_A, teamA), pulseOn(PULSE_B, teamB)],
  answered: [],
});

const directory = directoryFor(TEAM_A, TEAM_B);

const pulses = pulsesFor(TEAM_A, TEAM_B);

const roundOf = (status: RoundStatus, overrides: Partial<RoundFacts> = {}): RoundFacts => ({
  id: ROUND_A,
  teamId: TEAM_A,
  pulseId: PULSE_A,
  status,
  effectiveMinimumGroupSize: null,
  plannedOpenAt: NOW,
  ...overrides,
});

const commandFor = (
  tag: RoundCommandTag,
  teamId: TeamId = TEAM_A,
  pulseId: PulseId = PULSE_A,
  roundId: RoundId = ROUND_A,
): RoundCommand => {
  switch (tag) {
    case "SkipWeek": {
      return { _tag: "SkipWeek", teamId, pulseId, plannedOpenDate: WEEK_OF_NOW };
    }

    case "UnskipWeek": {
      return { _tag: "UnskipWeek", teamId, pulseId, plannedOpenDate: WEEK_OF_NOW };
    }

    case "PausePulse": {
      return { _tag: "PausePulse", teamId, pulseId };
    }

    case "ResumePulse": {
      return { _tag: "ResumePulse", teamId, pulseId };
    }

    case "CloseRoundEarly": {
      return { _tag: "CloseRoundEarly", teamId, roundId };
    }

    case "ShareResults": {
      return { _tag: "ShareResults", teamId, roundId };
    }

    case "RetryResult": {
      return { _tag: "RetryResult", teamId, roundId };
    }

    case "CancelRound": {
      return { _tag: "CancelRound", teamId, roundId };
    }

    case "ResendInvitation": {
      return { _tag: "ResendInvitation", teamId, roundId, personId: MEMBER_A };
    }
  }
};

const ROUND_TAGS: readonly RoundCommandTag[] = [
  "CloseRoundEarly",
  "ShareResults",
  "RetryResult",
  "CancelRound",
  "ResendInvitation",
];

const ALL_TAGS: readonly RoundCommandTag[] = [
  "SkipWeek",
  "UnskipWeek",
  "PausePulse",
  "ResumePulse",
  ...ROUND_TAGS,
];

const decide = (overrides: Partial<RoundCommandInput> & { readonly command: RoundCommand }) =>
  decideRoundCommand({
    directory,
    pulses,
    actorId: LEAD_A,
    now: NOW,
    round: null,
    invitation: null,
    computePending: false,
    ...overrides,
  });

const rejectedWith = (rejection: RoundRejection) => ({ _tag: "Rejected", rejection });

const isRejectedWith = (decision: RoundCommandDecision, tag: string) =>
  decision._tag === "Rejected" && decision.rejection._tag === tag;

describe("decideRoundCommand: authorization", () => {
  it.each(ALL_TAGS)("refuses %s from a Person with no role on the Team as Forbidden", (tag) => {
    const decision = decide({
      actorId: OUTSIDER,
      command: commandFor(tag),
      round: roundOf("open"),
      invitation: { resendCount: 0 },
    });

    expect(decision).toEqual(rejectedWith({ _tag: "Forbidden" }));
  });

  it.each(ALL_TAGS)("refuses %s from a removed Person and from a Person not in the directory", (tag) => {
    for (const actorId of [REMOVED, ABSENT]) {
      expect(
        decide({ actorId, command: commandFor(tag), round: roundOf("open"), invitation: { resendCount: 0 } }),
      ).toEqual(rejectedWith({ _tag: "Forbidden" }));
    }
  });

  it.each(ALL_TAGS)("refuses %s on a Team that does not exist as TeamNotFound", (tag) => {
    const ghost = TeamId.make("ghost");
    expect(
      decide({
        actorId: ADMIN,
        command: commandFor(tag, ghost),
        round: roundOf("open", { teamId: ghost }),
        invitation: { resendCount: 0 },
      }),
    ).toEqual(rejectedWith({ _tag: "TeamNotFound" }));
  });
});

describe("decideRoundCommand: Pulse commands", () => {
  it.each(["SkipWeek", "UnskipWeek", "PausePulse", "ResumePulse"] as const)(
    "refuses %s on a Pulse that does not exist as PulseNotFound",
    (tag) => {
      expect(decide({ command: commandFor(tag, TEAM_A, PulseId.make("missing")) })).toEqual(
        rejectedWith({ _tag: "PulseNotFound" }),
      );
    },
  );

  it.each(["SkipWeek", "UnskipWeek", "PausePulse", "ResumePulse"] as const)(
    "refuses a Lead of one Team on %s for the Pulse of another Team as PulseNotFound",
    (tag) => {
      expect(decide({ command: commandFor(tag, TEAM_A, PULSE_B) })).toEqual(
        rejectedWith({ _tag: "PulseNotFound" }),
      );
      expect(decide({ actorId: LEAD_B, command: commandFor(tag, TEAM_B, PULSE_A) })).toEqual(
        rejectedWith({ _tag: "PulseNotFound" }),
      );
    },
  );

  it.each(["UnskipWeek", "PausePulse", "ResumePulse"] as const)(
    "applies %s to the Team's own Pulse",
    (tag) => {
      expect(decide({ command: commandFor(tag) })._tag).toBe("Apply");
    },
  );

  it("applies SkipWeek to the Team's own Pulse on a cadence date", () => {
    expect(decide({ command: commandFor("SkipWeek") })).toEqual({
      _tag: "Apply",
      plan: { _tag: "SkipWeek", teamId: TEAM_A, pulseId: PULSE_A, plannedOpenDate: WEEK_OF_NOW },
    });
  });

  it("checks the Team before the Pulse for SkipWeek", () => {
    const ghost = TeamId.make("ghost");
    expect(decide({ actorId: ADMIN, command: commandFor("SkipWeek", ghost, PULSE_A) })).toEqual(
      rejectedWith({ _tag: "TeamNotFound" }),
    );
  });

  it("checks the Pulse before the week for SkipWeek", () => {
    const command: RoundCommand = {
      _tag: "SkipWeek",
      teamId: TEAM_A,
      pulseId: PULSE_B,
      plannedOpenDate: "2030-01-01",
    };

    expect(decide({ command })).toEqual(rejectedWith({ _tag: "PulseNotFound" }));
  });

  it("refuses a week that is not one of the next eight cadence dates as WeekOutOfRange", () => {
    const outside = (plannedOpenDate: string) =>
      decide({ command: { _tag: "SkipWeek", teamId: TEAM_A, pulseId: PULSE_A, plannedOpenDate } });

    expect(outside("2026-11-18")).toEqual(rejectedWith({ _tag: "WeekOutOfRange" }));
    expect(outside("2026-11-10")).toEqual(rejectedWith({ _tag: "WeekOutOfRange" }));
    expect(outside("2027-01-12")).toEqual(rejectedWith({ _tag: "WeekOutOfRange" }));
    expect(outside("2027-01-05")).toEqual({
      _tag: "Apply",
      plan: { _tag: "SkipWeek", teamId: TEAM_A, pulseId: PULSE_A, plannedOpenDate: "2027-01-05" },
    });
  });

  const dateAfter = (weeks: number) =>
    DateTime.formatIsoDateUtc(
      DateTime.add(DateTime.makeUnsafe({ year: 2026, month: 11, day: 17 }), { days: weeks * 7 }),
    );

  prop(
    "accepts SkipWeek for exactly the eight cadence weeks counted from this week, and refuses the rest",
    { weeks: Schema.Int },
    ({ weeks }) => {
      const offset = Math.abs(weeks) % 12;

      const decision = decide({
        command: { _tag: "SkipWeek", teamId: TEAM_A, pulseId: PULSE_A, plannedOpenDate: dateAfter(offset) },
      });

      return offset < 8 ? decision._tag === "Apply" : isRejectedWith(decision, "WeekOutOfRange");
    },
  );

  prop(
    "applies a cross-Team Pulse command only to a Lead of the Pulse's own Team, for any two Teams",
    {
      first: Schema.NonEmptyString,
      second: Schema.NonEmptyString,
      tag: Schema.Literals(["SkipWeek", "UnskipWeek", "PausePulse", "ResumePulse"]),
    },
    ({ first, second, tag }) => {
      if (first === second) {
        return true;
      }

      const teamA = TeamId.make(first);
      const teamB = TeamId.make(second);
      const dir = directoryFor(teamA, teamB);
      const state = pulsesFor(teamA, teamB);
      const leadOfA = dir.memberships.find((m) => m.teamId === teamA && m.role === "lead")?.personId;
      const leadOfB = dir.memberships.find((m) => m.teamId === teamB && m.role === "lead")?.personId;

      if (leadOfA === undefined || leadOfB === undefined) {
        return false;
      }

      const attempt = (actorId: PersonId, teamId: TeamId, pulseId: PulseId) =>
        decideRoundCommand({
          directory: dir,
          pulses: state,
          actorId,
          command: commandFor(tag, teamId, pulseId),
          now: NOW,
          round: null,
          invitation: null,
          computePending: false,
        });

      const crossTeam = attempt(leadOfA, teamA, PULSE_B);
      const ownTeam = attempt(leadOfB, teamB, PULSE_B);

      return isRejectedWith(crossTeam, "PulseNotFound") && ownTeam._tag === "Apply";
    },
  );
});

describe("decideRoundCommand: Round commands", () => {
  it.each(ROUND_TAGS)("refuses %s on a Round that does not exist as RoundNotFound", (tag) => {
    expect(
      decide({ actorId: ADMIN, command: commandFor(tag), round: null, invitation: { resendCount: 0 } }),
    ).toEqual(rejectedWith({ _tag: "RoundNotFound" }));
  });

  it.each(ROUND_TAGS)("refuses %s on a Round of another Team as RoundNotFound", (tag) => {
    const otherTeamRound = roundOf("open", { id: ROUND_B, teamId: TEAM_B, pulseId: PULSE_B });
    expect(
      decide({
        actorId: ADMIN,
        command: commandFor(tag, TEAM_A, PULSE_A, ROUND_B),
        round: otherTeamRound,
        invitation: { resendCount: 0 },
      }),
    ).toEqual(rejectedWith({ _tag: "RoundNotFound" }));
  });

  it("finds the Round of another Team as RoundNotFound before a non-lead is Forbidden", () => {
    const otherTeamRound = roundOf("open", { id: ROUND_B, teamId: TEAM_B, pulseId: PULSE_B });

    for (const tag of ["ShareResults", "RetryResult"] as const) {
      expect(
        decide({ actorId: ADMIN, command: commandFor(tag, TEAM_A, PULSE_A, ROUND_B), round: otherTeamRound }),
      ).toEqual(rejectedWith({ _tag: "RoundNotFound" }));
    }
  });

  it("refuses ShareResults and RetryResult from an admin who is not a Lead of the Team as Forbidden", () => {
    for (const tag of ["ShareResults", "RetryResult"] as const) {
      expect(decide({ actorId: ADMIN, command: commandFor(tag), round: roundOf("ready") })).toEqual(
        rejectedWith({ _tag: "Forbidden" }),
      );
    }
  });

  it("checks Forbidden before the Round's status for ShareResults and RetryResult", () => {
    for (const tag of ["ShareResults", "RetryResult"] as const) {
      expect(decide({ actorId: ADMIN, command: commandFor(tag), round: roundOf("open") })).toEqual(
        rejectedWith({ _tag: "Forbidden" }),
      );
    }
  });

  it("accepts ShareResults on a shared Round as Unchanged, and refuses it on a scheduled one", () => {
    expect(decide({ command: commandFor("ShareResults"), round: roundOf("shared") })).toEqual({
      _tag: "Unchanged",
    });
    expect(decide({ command: commandFor("ShareResults"), round: roundOf("scheduled") })).toEqual(
      rejectedWith({ _tag: "InvalidRoundState", status: "scheduled" }),
    );
  });

  it("applies ShareResults on a ready Round", () => {
    expect(decide({ command: commandFor("ShareResults"), round: roundOf("ready") })).toEqual({
      _tag: "Apply",
      plan: { _tag: "ShareResults", roundId: ROUND_A },
    });
  });

  it("accepts RetryResult on a ready or shared Round as Unchanged", () => {
    for (const status of ["ready", "shared"] as const) {
      expect(decide({ command: commandFor("RetryResult"), round: roundOf(status) })).toEqual({
        _tag: "Unchanged",
      });
    }
  });

  it("accepts RetryResult with a compute job already pending as Unchanged, but only once the status allows it", () => {
    expect(
      decide({ command: commandFor("RetryResult"), round: roundOf("closed"), computePending: true }),
    ).toEqual({
      _tag: "Unchanged",
    });
    expect(
      decide({ command: commandFor("RetryResult"), round: roundOf("open"), computePending: true }),
    ).toEqual(rejectedWith({ _tag: "InvalidRoundState", status: "open" }));
  });

  it("applies RetryResult on a closed Round with no compute job pending", () => {
    expect(decide({ command: commandFor("RetryResult"), round: roundOf("closed") })).toEqual({
      _tag: "Apply",
      plan: { _tag: "RetryResult", roundId: ROUND_A },
    });
  });

  it("refuses CloseRoundEarly on a Round that is not open as RoundNotOpen", () => {
    expect(decide({ command: commandFor("CloseRoundEarly"), round: roundOf("scheduled") })).toEqual(
      rejectedWith({ _tag: "RoundNotOpen" }),
    );
    expect(decide({ command: commandFor("CloseRoundEarly"), round: roundOf("closed") })).toEqual(
      rejectedWith({ _tag: "RoundNotOpen" }),
    );
  });

  it("refuses CancelRound on a closed Round as InvalidRoundState with its status", () => {
    expect(decide({ command: commandFor("CancelRound"), round: roundOf("closed") })).toEqual(
      rejectedWith({ _tag: "InvalidRoundState", status: "closed" }),
    );
  });

  it("applies CancelRound on a scheduled Round", () => {
    expect(decide({ command: commandFor("CancelRound"), round: roundOf("scheduled") })).toEqual({
      _tag: "Apply",
      plan: { _tag: "CancelRound", roundId: ROUND_A },
    });
  });

  prop(
    "closes early at the larger of the directory and the Round's own minimum group size",
    { minimum: Schema.Int, effective: Schema.NullOr(Schema.Int) },
    ({ minimum, effective }) => {
      const dir: DirectoryState = { ...directory, minimumGroupSize: minimum };

      const decision = decideRoundCommand({
        directory: dir,
        pulses,
        actorId: LEAD_A,
        command: commandFor("CloseRoundEarly"),
        now: NOW,
        round: roundOf("open", { effectiveMinimumGroupSize: effective }),
        invitation: null,
        computePending: false,
      });

      return (
        decision._tag === "Apply" &&
        decision.plan._tag === "CloseRoundEarly" &&
        decision.plan.effectiveN === Math.max(minimum, effective ?? minimum)
      );
    },
  );

  it("closes an open Round early with the directory's minimum when the Round has none of its own", () => {
    expect(decide({ command: commandFor("CloseRoundEarly"), round: roundOf("open") })).toEqual({
      _tag: "Apply",
      plan: { _tag: "CloseRoundEarly", roundId: ROUND_A, pulseId: PULSE_A, effectiveN: 4 },
    });
    expect(
      decide({
        command: commandFor("CloseRoundEarly"),
        round: roundOf("open", { effectiveMinimumGroupSize: 2 }),
      }),
    ).toMatchObject({ _tag: "Apply", plan: { effectiveN: 4 } });
    expect(
      decide({
        command: commandFor("CloseRoundEarly"),
        round: roundOf("open", { effectiveMinimumGroupSize: 6 }),
      }),
    ).toMatchObject({ _tag: "Apply", plan: { effectiveN: 6 } });
  });
});

describe("decideRoundCommand: ResendInvitation", () => {
  const resend = (overrides: Partial<RoundCommandInput> = {}) =>
    decide({
      command: commandFor("ResendInvitation"),
      round: roundOf("open"),
      invitation: { resendCount: 2 },
      ...overrides,
    });

  it("refuses a Round that is not open as RoundNotOpen, before looking for the invitation", () => {
    expect(resend({ round: roundOf("scheduled"), invitation: null })).toEqual(
      rejectedWith({ _tag: "RoundNotOpen" }),
    );
  });

  it("refuses a Person with no invitation to the Round as InvitationNotFound", () => {
    expect(resend({ invitation: null })).toEqual(rejectedWith({ _tag: "InvitationNotFound" }));
  });

  it("refuses an invitation for a Person who is not in the directory or has been removed as InvitationNotFound", () => {
    expect(
      resend({ command: { _tag: "ResendInvitation", teamId: TEAM_A, roundId: ROUND_A, personId: ABSENT } }),
    ).toEqual(rejectedWith({ _tag: "InvitationNotFound" }));
    expect(
      resend({ command: { _tag: "ResendInvitation", teamId: TEAM_A, roundId: ROUND_A, personId: REMOVED } }),
    ).toEqual(rejectedWith({ _tag: "InvitationNotFound" }));
  });

  it("refuses a Round whose Pulse is missing as PulseNotFound", () => {
    expect(resend({ round: roundOf("open", { pulseId: PulseId.make("gone") }) })).toEqual(
      rejectedWith({ _tag: "PulseNotFound" }),
    );
  });

  prop(
    "names the next generation after the Person's resend count",
    { resendCount: Schema.Int },
    ({ resendCount }) => {
      const count = Math.abs(resendCount) % 1000;
      const decision = resend({ invitation: { resendCount: count } });

      return (
        decision._tag === "Apply" &&
        decision.plan._tag === "ResendInvitation" &&
        decision.plan.generation === count + 1 &&
        decision.plan.person.id === MEMBER_A &&
        decision.plan.pulse.id === PULSE_A &&
        decision.plan.round.id === ROUND_A
      );
    },
  );
});

describe("decideRoundCommand agrees with the Round machine", () => {
  it("returns the machine's rejection for every Round command on every status the machine refuses", () => {
    const statuses: readonly RoundStatus[] = ["scheduled", "open", "closed", "ready", "shared", "cancelled"];

    for (const tag of ROUND_TAGS) {
      for (const status of statuses) {
        const command = commandFor(tag);
        const machine = roundCommandRejection(status, command);

        if (machine === null) {
          continue;
        }

        expect(
          decide({ command, round: roundOf(status), invitation: { resendCount: 0 } }),
          `${tag} on ${status}`,
        ).toEqual(rejectedWith(machine));
      }
    }
  });
});
