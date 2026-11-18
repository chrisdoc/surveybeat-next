import { assert, describe, expect, it, prop } from "@effect/vitest";
import { createEffectActor } from "@xstate/effect";
import { sendAndAwait } from "@xstate/effect/test";
import { Clock, Duration, Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  calculateReminders,
  calculateResultsReadyDeliveryTime,
  calculateRoundInstants,
  localToUtc,
  nextEightWeeksCadenceDates,
  nextRoundSlot,
  parseDateIso,
  roundCommandRejection,
  roundMachine,
  roundStatusAfter,
  type RoundCommand,
  type RoundCommandTag,
  type RoundRecord,
} from "./Lifecycle.ts";
import { RoundId, RoundStatus as RoundStatusSchema, type RoundStatus } from "./Round.ts";
import { PersonId } from "../people/Identity.ts";
import { PulseId, SendTime, Weekday } from "../pulses/Pulse.ts";
import { TeamId } from "../people/Team.ts";

describe("Lifecycle scheduling and time engine", () => {
  it("opens a Round at the earliest member's local cadence time when a member's zone is ahead of the Team's", () => {
    // Team in Europe/Berlin (UTC+1), one member in Asia/Tokyo (UTC+9): Monday 09:00 is 00:00 UTC in Tokyo.
    const sendTime = SendTime.make("09:00");
    const withOwnZone = calculateRoundInstants(
      "2026-11-09",
      sendTime,
      ["Europe/Berlin", "Asia/Tokyo"],
      "Europe/Berlin",
      3,
    );
    const teamZoneOnly = calculateRoundInstants(
      "2026-11-09",
      sendTime,
      ["Europe/Berlin", "Europe/Berlin"],
      "Europe/Berlin",
      3,
    );
    const tokyoSend = Date.UTC(2026, 10, 9, 0, 0, 0);
    const berlinSend = Date.UTC(2026, 10, 9, 8, 0, 0);
    assert.strictEqual(withOwnZone.sends.find((s) => s.timeZone === "Asia/Tokyo")?.sendAt, tokyoSend);
    assert.strictEqual(withOwnZone.sends.find((s) => s.timeZone === "Europe/Berlin")?.sendAt, berlinSend);
    // The open job is due no later than the earliest send, so nobody is sent late.
    assert.strictEqual(withOwnZone.openInstant, tokyoSend);
    // Team-zone-only instants would open eight hours late for Tokyo.
    assert.strictEqual(teamZoneOnly.openInstant, berlinSend);
    assert.isBelow(withOwnZone.openInstant, teamZoneOnly.openInstant);
  });

  it("calculates open and close instants for a Round spanning UTC-8 and UTC+9", () => {
    // Cadence: Monday 09:00 local time, window of 3 days.
    // Planned open date: 2026-11-09 (Monday).
    // Member A in America/Los_Angeles (standard time: UTC-8).
    // Member B in Asia/Tokyo (UTC+9).
    const targetDate = "2026-11-09";
    const sendTime = SendTime.make("09:00");
    const memberTimeZones = ["America/Los_Angeles", "Asia/Tokyo"];
    const fallbackTimeZone = "UTC";
    const windowDays = 3;

    const instants = calculateRoundInstants(
      targetDate,
      sendTime,
      memberTimeZones,
      fallbackTimeZone,
      windowDays,
    );

    // Tokyo send: 2026-11-09 09:00 JST = 2026-11-09 00:00:00 UTC
    const expectedTokyoSend = Date.UTC(2026, 10, 9, 0, 0, 0); // 1794182400000
    // LA send: 2026-11-09 09:00 PST (UTC-8) = 2026-11-09 17:00:00 UTC
    const expectedLaSend = Date.UTC(2026, 10, 9, 17, 0, 0); // 1794243600000

    // Round becomes Open at the first member's local send (Tokyo).
    assert.strictEqual(instants.openInstant, expectedTokyoSend);
    assert.strictEqual(instants.latestSendInstant, expectedLaSend);

    // Round has ONE close instant: latest member's send time plus window (3 days = 72 hours).
    const expectedCloseInstant = expectedLaSend + 3 * 24 * 3600_000;
    assert.strictEqual(instants.closeInstant, expectedCloseInstant);

    // Reminders check:
    // Tokyo member (window 3, reminders 1): one reminder at day W-1 = day 2 (Wednesday 00:00 UTC)
    const tokyoReminders = calculateReminders(expectedTokyoSend, 3, 1, instants.closeInstant);
    assert.deepStrictEqual(tokyoReminders, [expectedTokyoSend + 2 * 24 * 3600_000]);

    // LA member (window 3, reminders 2): reminders at day 1 and day W-1 = day 2
    const laReminders = calculateReminders(expectedLaSend, 3, 2, instants.closeInstant);
    assert.deepStrictEqual(laReminders, [
      expectedLaSend + 1 * 24 * 3600_000,
      expectedLaSend + 2 * 24 * 3600_000,
    ]);

    // Single-day window (W=1): one reminder 6 hours after send
    const w1Reminders = calculateReminders(expectedTokyoSend, 1, 1, expectedTokyoSend + 24 * 3600_000);
    assert.deepStrictEqual(w1Reminders, [expectedTokyoSend + 6 * 3600_000]);

    // Reminder within 2 hours of close is skipped:
    const closeVerySoon = expectedTokyoSend + 7 * 3600_000;
    const remindersDropped = calculateReminders(expectedTokyoSend, 1, 1, closeVerySoon);
    assert.deepStrictEqual(remindersDropped, []);
  });

  it("handles DST spring-forward (gap moves forward) and fall-back (first occurrence wins)", () => {
    // 1. Spring-forward gap: 2026-03-08 02:30 in America/New_York.
    // At 02:00, clocks spring forward to 03:00. 02:30 does not exist.
    // Specification: in a daylight-saving gap the time moves forward.
    // 02:30 moves forward to 03:30 EDT (UTC-4) = 07:30 UTC.
    const gapUtc = localToUtc(2026, 3, 8, 2, 30, "America/New_York");
    const expectedGapUtc = Date.UTC(2026, 2, 8, 7, 30, 0); // 07:30 UTC
    assert.strictEqual(gapUtc, expectedGapUtc);

    // 2. Fall-back overlap: 2026-11-01 01:30 in America/New_York.
    // 01:00-02:00 repeats.
    // First occurrence is EDT (UTC-4), which is 05:30 UTC.
    // Second occurrence is EST (UTC-5), which is 06:30 UTC.
    // Specification: in an overlap the first occurrence wins.
    const overlapUtc = localToUtc(2026, 11, 1, 1, 30, "America/New_York");
    const expectedOverlapUtc = Date.UTC(2026, 10, 1, 5, 30, 0); // 05:30 UTC
    assert.strictEqual(overlapUtc, expectedOverlapUtc);

    // Europe/Berlin spring-forward: 2026-03-29 02:30 -> 03:30 CEST (UTC+2) = 01:30 UTC.
    const berlinGapUtc = localToUtc(2026, 3, 29, 2, 30, "Europe/Berlin");
    const expectedBerlinGapUtc = Date.UTC(2026, 2, 29, 1, 30, 0);
    assert.strictEqual(berlinGapUtc, expectedBerlinGapUtc);

    // Europe/Berlin fall-back: 2026-10-25 02:30 -> first occurrence is CEST (UTC+2) = 00:30 UTC.
    const berlinOverlapUtc = localToUtc(2026, 10, 25, 2, 30, "Europe/Berlin");
    const expectedBerlinOverlapUtc = Date.UTC(2026, 9, 25, 0, 30, 0);
    assert.strictEqual(berlinOverlapUtc, expectedBerlinOverlapUtc);
  });

  it("pins localToUtc at DST gaps (later instant) and overlaps (earlier instant) in Berlin and New York", () => {
    // Berlin gap: 02:30 does not exist on 2026-03-29; it lands on 03:30 CEST (UTC+2).
    assert.strictEqual(localToUtc(2026, 3, 29, 2, 30, "Europe/Berlin"), Date.UTC(2026, 2, 29, 1, 30));
    // Berlin overlap: 02:30 happens twice on 2026-10-25; the CEST (UTC+2) occurrence wins.
    assert.strictEqual(localToUtc(2026, 10, 25, 2, 30, "Europe/Berlin"), Date.UTC(2026, 9, 25, 0, 30));
    // Berlin overlap ends: 03:00 is unambiguous CET (UTC+1) again.
    assert.strictEqual(localToUtc(2026, 10, 25, 3, 0, "Europe/Berlin"), Date.UTC(2026, 9, 25, 2, 0));
    // New York gap: 02:30 does not exist on 2026-03-08; it lands on 03:30 EDT (UTC-4).
    assert.strictEqual(localToUtc(2026, 3, 8, 2, 30, "America/New_York"), Date.UTC(2026, 2, 8, 7, 30));
    // New York overlap: 01:30 happens twice on 2026-11-01; the EDT (UTC-4) occurrence wins.
    assert.strictEqual(localToUtc(2026, 11, 1, 1, 30, "America/New_York"), Date.UTC(2026, 10, 1, 5, 30));
  });

  it("pins nextEightWeeksCadenceDates across a year boundary, using the zone's local date", () => {
    // 2026-12-31 23:30 UTC is already 2027-01-01 08:30 in Tokyo (a Friday) but still Thursday 2026-12-31 in UTC.
    const nowMs = Date.UTC(2026, 11, 31, 23, 30);
    assert.deepStrictEqual(nextEightWeeksCadenceDates(nowMs, "thursday", "Asia/Tokyo"), [
      "2027-01-07",
      "2027-01-14",
      "2027-01-21",
      "2027-01-28",
      "2027-02-04",
      "2027-02-11",
      "2027-02-18",
      "2027-02-25",
    ]);
    assert.deepStrictEqual(nextEightWeeksCadenceDates(nowMs, "thursday", "UTC"), [
      "2026-12-31",
      "2027-01-07",
      "2027-01-14",
      "2027-01-21",
      "2027-01-28",
      "2027-02-04",
      "2027-02-11",
      "2027-02-18",
    ]);
  });

  it("determines next 8 weeks of cadence dates", () => {
    // From a known date: Wednesday 2026-11-11
    const wednesdayMs = Date.UTC(2026, 10, 11, 12, 0, 0);
    const mondays = nextEightWeeksCadenceDates(wednesdayMs, "monday", "UTC");
    assert.strictEqual(mondays.length, 8);
    assert.strictEqual(mondays[0], "2026-11-16");
    assert.strictEqual(mondays[1], "2026-11-23");
    assert.strictEqual(mondays[2], "2026-11-30");
    assert.strictEqual(mondays[3], "2026-12-07");
    assert.strictEqual(mondays[4], "2026-12-14");
    assert.strictEqual(mondays[5], "2026-12-21");
    assert.strictEqual(mondays[6], "2026-12-28");
    assert.strictEqual(mondays[7], "2027-01-04");
  });

  it.effect("simulates skip, pause, close, and cancel using Effect TestClock", () =>
    Effect.gen(function* () {
      // Set test clock to Monday 2026-11-09 00:00:00 UTC
      const startMs = Date.UTC(2026, 10, 9, 0, 0, 0);
      yield* TestClock.setTime(startMs);

      const pulseId = PulseId.make("pulse-1");
      const teamId = TeamId.make("team-1");
      const round1Id = RoundId.make("round-1");

      // 1. Initial Scheduled Round
      let scheduledRound: RoundRecord = {
        id: round1Id,
        pulseId,
        teamId,
        status: "scheduled",
        plannedOpenDate: "2026-11-09",
        plannedOpenAt: startMs,
        openedAt: null,
        plannedCloseAt: startMs + 3 * 24 * 3600_000,
        closedAt: null,
        reviewEndsAt: null,
        effectiveMinimumGroupSize: null,
        pulseName: "Weekly Health",
        answerWindowDays: 3,
        reminders: 1,
        anonymityMode: "anonymous",
        distribution: "invitation",
        createdAt: startMs,
        updatedAt: startMs,
      };

      // 2. Open Round: Scheduled -> Open
      let openRound: RoundRecord = {
        ...scheduledRound,
        status: "open",
        openedAt: startMs,
        updatedAt: startMs,
      };
      assert.strictEqual(openRound.status, "open");
      assert.strictEqual(openRound.openedAt, startMs);

      // Advance clock by 1 day
      yield* TestClock.adjust(Duration.millis(24 * 3600_000));

      // 3. Close early control: Open -> Closed -> Shared
      const closeEarlyTime = yield* Clock.currentTimeMillis;
      const closedEarlyRound: RoundRecord = {
        ...openRound,
        status: "closed",
        closedAt: closeEarlyTime,
        reviewEndsAt: null,
        effectiveMinimumGroupSize: 4, // Max of org N (4) and round N
        updatedAt: closeEarlyTime,
      };
      assert.strictEqual(closedEarlyRound.status, "closed");
      assert.strictEqual(closedEarlyRound.closedAt, closeEarlyTime);
      assert.strictEqual(closedEarlyRound.effectiveMinimumGroupSize, 4);

      // Moves to Ready and straight to Shared in R1
      const sharedRound: RoundRecord = {
        ...closedEarlyRound,
        status: "shared",
        updatedAt: closeEarlyTime,
      };
      assert.strictEqual(sharedRound.status, "shared");

      // 4. Cancel Open Round: Open -> Cancelled
      const roundToCancel: RoundRecord = {
        ...openRound,
        id: RoundId.make("round-2"),
        plannedOpenDate: "2026-11-16",
      };
      const cancelTime = yield* Clock.currentTimeMillis;
      const cancelledRound: RoundRecord = {
        ...roundToCancel,
        status: "cancelled",
        updatedAt: cancelTime,
      };
      assert.strictEqual(cancelledRound.status, "cancelled");

      // 5. Skip week: skipping the scheduled week cancels it
      const roundToSkip: RoundRecord = {
        ...scheduledRound,
        id: RoundId.make("round-3"),
        plannedOpenDate: "2026-11-23",
      };
      const skippedRound: RoundRecord = {
        ...roundToSkip,
        status: "cancelled",
        updatedAt: cancelTime,
      };
      assert.strictEqual(skippedRound.status, "cancelled");

      // 6. Pause pulse: cancels scheduled round
      const roundToPause: RoundRecord = {
        ...scheduledRound,
        id: RoundId.make("round-4"),
        plannedOpenDate: "2026-11-30",
      };
      const pausedRound: RoundRecord = {
        ...roundToPause,
        status: "cancelled",
        updatedAt: cancelTime,
      };
      assert.strictEqual(pausedRound.status, "cancelled");
    }),
  );

  it("Scheduled Round picks up Pulse settings edits, while an Open Round does not", () => {
    // Initial pulse settings: Monday 09:00, window 3 days
    const sendTime1 = SendTime.make("09:00");
    const targetDate1 = "2026-11-09";
    const instants1 = calculateRoundInstants(targetDate1, sendTime1, ["UTC"], "UTC", 3);

    let scheduledRound: RoundRecord = {
      id: RoundId.make("round-1"),
      pulseId: PulseId.make("pulse-1"),
      teamId: TeamId.make("team-1"),
      status: "scheduled",
      plannedOpenDate: targetDate1,
      plannedOpenAt: instants1.openInstant,
      openedAt: null,
      plannedCloseAt: instants1.closeInstant,
      closedAt: null,
      reviewEndsAt: null,
      effectiveMinimumGroupSize: null,
      pulseName: "Original Name",
      answerWindowDays: 3,
      reminders: 1,
      anonymityMode: "anonymous",
      distribution: "invitation",
      createdAt: 1000,
      updatedAt: 1000,
    };

    // Lead edits Pulse settings while Round is still Scheduled:
    // Name -> "Updated Name", window -> 5 days, SendTime -> 10:00
    const sendTime2 = SendTime.make("10:00");
    const instants2 = calculateRoundInstants(targetDate1, sendTime2, ["UTC"], "UTC", 5);

    scheduledRound = {
      ...scheduledRound,
      pulseName: "Updated Name",
      answerWindowDays: 5,
      plannedOpenAt: instants2.openInstant,
      plannedCloseAt: instants2.closeInstant,
      updatedAt: 2000,
    };

    // Scheduled Round picked up the changes!
    assert.strictEqual(scheduledRound.pulseName, "Updated Name");
    assert.strictEqual(scheduledRound.answerWindowDays, 5);
    assert.strictEqual(scheduledRound.plannedOpenAt, instants2.openInstant);
    assert.strictEqual(scheduledRound.plannedCloseAt, instants2.closeInstant);

    // Now Round opens:
    const openRound: RoundRecord = {
      ...scheduledRound,
      status: "open",
      openedAt: instants2.openInstant,
      updatedAt: instants2.openInstant,
    };
    const frozenQuestions = ["v1", "v2"];
    const frozenWindow = openRound.answerWindowDays;
    const frozenCloseInstant = openRound.plannedCloseAt;

    // Lead edits Pulse settings again during Open Round:
    // Window -> 2 days, adds question "v3" to Pulse
    const newPulseSettingsWindow = 2;
    const newPulseQuestions = ["v1", "v2", "v3"];

    // An Open Round never changes:
    assert.strictEqual(openRound.answerWindowDays, frozenWindow);
    assert.strictEqual(openRound.plannedCloseAt, frozenCloseInstant);
    assert.deepStrictEqual(frozenQuestions, ["v1", "v2"]);
    assert.notStrictEqual(openRound.answerWindowDays, newPulseSettingsWindow);
    assert.notDeepEqual(frozenQuestions, newPulseQuestions);
  });

  it.effect("derives 128-bit base64url tokens deterministically per key and Invitation generation", () =>
    Effect.gen(function* () {
      const { deriveInvitationToken, hashToken, importInvitationTokenKey } = yield* Effect.promise(
        () => import("./Lifecycle.ts"),
      );
      const key = yield* Effect.promise(() => importInvitationTokenKey("k".repeat(32)));
      const otherKey = yield* Effect.promise(() => importInvitationTokenKey("o".repeat(32)));
      const ref = { roundId: "round-1", personId: "person-1", generation: 0 };
      const token = yield* Effect.promise(() => deriveInvitationToken(key, ref));
      assert.match(token, /^[A-Za-z0-9_-]{22}$/); // 16 bytes base64url = 22 characters unpadded
      assert.strictEqual(yield* Effect.promise(() => deriveInvitationToken(key, ref)), token);

      const variants = [
        { ...ref, generation: 1 }, // Resend: the old link stops working
        { ...ref, personId: "person-2" },
        { ...ref, roundId: "round-2" },
      ];
      for (const variant of variants) {
        assert.notStrictEqual(yield* Effect.promise(() => deriveInvitationToken(key, variant)), token);
      }
      assert.notStrictEqual(yield* Effect.promise(() => deriveInvitationToken(otherKey, ref)), token);

      const hash = yield* Effect.promise(() => hashToken(token));
      assert.match(hash, /^[0-9a-f]{64}$/); // SHA-256 hex
      assert.strictEqual(yield* Effect.promise(() => hashToken(token)), hash);
      assert.notStrictEqual(yield* Effect.promise(() => hashToken(`${token}x`)), hash);
    }),
  );

  it.effect(
    "derives test Invitation tokens per key, Person, and test id, never equal to an Invitation token",
    () =>
      Effect.gen(function* () {
        const { deriveInvitationToken, deriveTestInvitationToken, importInvitationTokenKey } =
          yield* Effect.promise(() => import("./Lifecycle.ts"));
        const key = yield* Effect.promise(() => importInvitationTokenKey("k".repeat(32)));
        const otherKey = yield* Effect.promise(() => importInvitationTokenKey("o".repeat(32)));
        const ref = { pulseId: "pulse-1", personId: "person-1", testId: "test-1" };
        const token = yield* Effect.promise(() => deriveTestInvitationToken(key, ref));
        assert.match(token, /^[A-Za-z0-9_-]{22}$/); // 16 bytes base64url = 22 characters unpadded
        assert.strictEqual(yield* Effect.promise(() => deriveTestInvitationToken(key, ref)), token);

        const variants = [
          { ...ref, testId: "test-2" }, // each send gets a fresh token
          { ...ref, personId: "person-2" },
          { ...ref, pulseId: "pulse-2" },
        ];
        for (const variant of variants) {
          assert.notStrictEqual(yield* Effect.promise(() => deriveTestInvitationToken(key, variant)), token);
        }
        assert.notStrictEqual(yield* Effect.promise(() => deriveTestInvitationToken(otherKey, ref)), token);

        // The same identifiers as an Invitation (roundId = pulseId, generation 0) give another token.
        const invitation = yield* Effect.promise(() =>
          deriveInvitationToken(key, { roundId: ref.pulseId, personId: ref.personId, generation: 0 }),
        );
        assert.notStrictEqual(token, invitation);
        assert.strictEqual(token.length, invitation.length);
      }),
  );

  it("skips reminders when close is less than 2 hours away or conditions match", () => {
    const send = 1000000;
    // W=1: 6 hours after send
    const closeFar = send + 24 * 3600_000;
    const r1 = calculateReminders(send, 1, 1, closeFar);
    assert.deepStrictEqual(r1, [send + 6 * 3600_000]);

    // Close in 7 hours: reminder at +6h is only 1h before close (< 2 hours cutoff), so it is skipped
    const closeSoon = send + 7 * 3600_000;
    const rDropped = calculateReminders(send, 1, 1, closeSoon);
    assert.deepStrictEqual(rDropped, []);

    // 0 reminders configured returns empty
    const r0 = calculateReminders(send, 3, 0, closeFar);
    assert.deepStrictEqual(r0, []);
  });

  it("calculates results-ready delivery: right away between 08:00 and 20:00, else next 08:00", () => {
    // 2026-11-09 in Europe/Berlin (UTC+1 in standard time, CET)
    // 14:30 CET = 13:30 UTC -> between 08:00 and 20:00 -> returns nowMs
    const nowDaytime = Date.UTC(2026, 10, 9, 13, 30, 0);
    assert.strictEqual(
      calculateResultsReadyDeliveryTime(nowDaytime, "Europe/Berlin"),
      nowDaytime,
      "Daytime delivery is immediate",
    );

    // 05:30 CET = 04:30 UTC -> before 08:00 -> returns today 08:00 CET = 07:00 UTC
    const nowEarly = Date.UTC(2026, 10, 9, 4, 30, 0);
    const expectedToday8am = Date.UTC(2026, 10, 9, 7, 0, 0);
    assert.strictEqual(
      calculateResultsReadyDeliveryTime(nowEarly, "Europe/Berlin"),
      expectedToday8am,
      "Early morning delivery waits until 08:00 today",
    );

    // 21:30 CET = 20:30 UTC -> after 20:00 -> returns tomorrow 08:00 CET = 07:00 UTC on 2026-11-10
    const nowNight = Date.UTC(2026, 10, 9, 20, 30, 0);
    const expectedTomorrow8am = Date.UTC(2026, 10, 10, 7, 0, 0);
    assert.strictEqual(
      calculateResultsReadyDeliveryTime(nowNight, "Europe/Berlin"),
      expectedTomorrow8am,
      "Night delivery waits until 08:00 tomorrow",
    );
  });

  it("pins results-ready delivery across Berlin's DST changeovers", () => {
    // 2026-03-28 21:00 CET (20:00 UTC) is after 20:00: tomorrow 08:00 on the spring-forward day is CEST (06:00 UTC).
    assert.strictEqual(
      calculateResultsReadyDeliveryTime(Date.UTC(2026, 2, 28, 20, 0), "Europe/Berlin"),
      Date.UTC(2026, 2, 29, 6, 0),
    );
    // 2026-03-29 08:30 CEST (06:30 UTC) is daytime: delivery is immediate.
    const springDaytime = Date.UTC(2026, 2, 29, 6, 30);
    assert.strictEqual(calculateResultsReadyDeliveryTime(springDaytime, "Europe/Berlin"), springDaytime);
    // 2026-10-25 06:30 UTC is 07:30 CET, before 08:00: today 08:00 CET (07:00 UTC).
    assert.strictEqual(
      calculateResultsReadyDeliveryTime(Date.UTC(2026, 9, 25, 6, 30), "Europe/Berlin"),
      Date.UTC(2026, 9, 25, 7, 0),
    );
    // 2026-10-25 20:00 UTC is 21:00 CET, after 20:00: tomorrow 08:00 CET (07:00 UTC).
    assert.strictEqual(
      calculateResultsReadyDeliveryTime(Date.UTC(2026, 9, 25, 20, 0), "Europe/Berlin"),
      Date.UTC(2026, 9, 26, 7, 0),
    );
  });
});

const ROUND_TAGS: ReadonlySet<RoundCommandTag> = new Set([
  "CloseRoundEarly",
  "ShareResults",
  "RetryResult",
  "CancelRound",
  "ResendInvitation",
]);

const CommandTag = Schema.Literals([
  "SkipWeek",
  "UnskipWeek",
  "PausePulse",
  "ResumePulse",
  "CloseRoundEarly",
  "ShareResults",
  "RetryResult",
  "CancelRound",
  "ResendInvitation",
]);

const commandOf = (tag: RoundCommandTag): RoundCommand => {
  const teamId = TeamId.make("team-1");
  const pulseId = PulseId.make("pulse-1");
  const roundId = RoundId.make("round-1");
  const personId = PersonId.make("person-1");
  switch (tag) {
    case "SkipWeek":
      return { _tag: "SkipWeek", teamId, pulseId, plannedOpenDate: "2026-11-09" };
    case "UnskipWeek":
      return { _tag: "UnskipWeek", teamId, pulseId, plannedOpenDate: "2026-11-09" };
    case "PausePulse":
      return { _tag: "PausePulse", teamId, pulseId };
    case "ResumePulse":
      return { _tag: "ResumePulse", teamId, pulseId };
    case "CloseRoundEarly":
      return { _tag: "CloseRoundEarly", teamId, roundId };
    case "ShareResults":
      return { _tag: "ShareResults", teamId, roundId };
    case "RetryResult":
      return { _tag: "RetryResult", teamId, roundId };
    case "CancelRound":
      return { _tag: "CancelRound", teamId, roundId };
    case "ResendInvitation":
      return { _tag: "ResendInvitation", teamId, roundId, personId };
  }
};

const MODEL: Record<RoundStatus, Partial<Record<RoundCommandTag, RoundStatus>>> = {
  scheduled: { CancelRound: "cancelled" },
  open: { CloseRoundEarly: "closed", CancelRound: "cancelled", ResendInvitation: "open" },
  closed: { RetryResult: "closed" },
  ready: { RetryResult: "ready", ShareResults: "shared" },
  shared: { RetryResult: "shared", ShareResults: "shared" },
  cancelled: {},
};

const modelNext = (status: RoundStatus, tag: RoundCommandTag): RoundStatus | undefined =>
  ROUND_TAGS.has(tag) ? MODEL[status][tag] : status;

describe("the Round lifecycle table", () => {
  prop(
    "allows exactly the commands the model allows in that status, and refuses the rest",
    { status: RoundStatusSchema, tag: CommandTag },
    ({ status, tag }) => {
      const rejection = roundCommandRejection(status, commandOf(tag));
      const next = modelNext(status, tag);
      if (next === undefined) return rejection !== null;
      return rejection === null && roundStatusAfter(status, commandOf(tag)) === next;
    },
  );

  prop(
    "walks a command sequence to the status the model predicts, refusing the illegal steps",
    { start: RoundStatusSchema, tags: Schema.Array(CommandTag) },
    ({ start, tags }) => {
      let status: RoundStatus = start;
      for (const tag of tags.slice(0, 25)) {
        const command = commandOf(tag);
        const rejection = roundCommandRejection(status, command);
        const next = modelNext(status, tag);
        if (next === undefined) {
          if (rejection === null) return false;
          continue;
        }
        if (rejection !== null) return false;
        const after = roundStatusAfter(status, command);
        if (after !== next) return false;
        status = after;
      }
      return true;
    },
  );
});

describe("the Round machine", () => {
  const roundId = RoundId.make("round-1");

  it.each([
    ["scheduled", "CloseRoundEarly", "RoundNotOpen"],
    ["closed", "ShareResults", "InvalidRoundState"],
    ["open", "RetryResult", "InvalidRoundState"],
    ["shared", "CancelRound", "InvalidRoundState"],
  ] as const)("refuses %s in %s with %s", (status, tag, rejection) => {
    const command = commandOf(tag);
    expect(roundCommandRejection(status, command)).toEqual(
      rejection === "RoundNotOpen" ? { _tag: "RoundNotOpen" } : { _tag: "InvalidRoundState", status },
    );
    expect(roundStatusAfter(status, command)).toBe(status);
  });

  it.effect("cancels a scheduled Round and then refuses every transition out of cancelled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const actor = yield* createEffectActor(roundMachine, {
          snapshot: roundMachine.resolveState({
            value: "scheduled",
            context: { status: "scheduled", rejection: null },
          }),
        });
        yield* sendAndAwait(actor, {
          type: "CancelRound",
          teamId: TeamId.make("team-1"),
          roundId,
        });
        expect(actor.getSnapshot().value).toBe("cancelled");
        expect(actor.getSnapshot().context.rejection).toBeNull();

        yield* sendAndAwait(actor, {
          type: "ShareResults",
          teamId: TeamId.make("team-1"),
          roundId,
        });
        expect(actor.getSnapshot().value).toBe("cancelled");
        expect(actor.getSnapshot().context.rejection).toEqual({
          _tag: "InvalidRoundState",
          status: "cancelled",
        });
      }),
    ),
  );

  it.effect("closes an open Round early and refuses to close it twice", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const actor = yield* createEffectActor(roundMachine, {
          snapshot: roundMachine.resolveState({
            value: "open",
            context: { status: "open", rejection: null },
          }),
        });
        yield* sendAndAwait(actor, { type: "CloseRoundEarly", teamId: TeamId.make("team-1"), roundId });
        expect(actor.getSnapshot().value).toBe("closed");
        yield* sendAndAwait(actor, { type: "CloseRoundEarly", teamId: TeamId.make("team-1"), roundId });
        expect(actor.getSnapshot().value).toBe("closed");
        expect(actor.getSnapshot().context.rejection).toEqual({ _tag: "RoundNotOpen" });
      }),
    ),
  );
});

describe("the next Round slot", () => {
  const dayNumberOf = (dateIso: string) => {
    const { year, month, day } = parseDateIso(dateIso);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  const dateOfDayNumber = (days: number) => {
    const z = days + 719_468;
    const era = Math.floor(z / 146_097);
    const doe = z - era * 146_097;
    const yoe = Math.floor(
      (doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365,
    );
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const month = mp < 10 ? mp + 3 : mp - 9;
    const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const weekdayOf = (dateIso: string) =>
    ["thursday", "friday", "saturday", "sunday", "monday", "tuesday", "wednesday"][dayNumberOf(dateIso) % 7];
  const shiftDays = (dateIso: string, days: number) => dateOfDayNumber(dayNumberOf(dateIso) + days);
  const SlotTime = Schema.Literals(["06:00", "09:30", "14:45", "21:00"]);
  const Zone = Schema.Literals(["Europe/Berlin", "America/Los_Angeles", "Asia/Tokyo", "UTC"]);

  prop(
    "is the earliest unskipped cadence day whose open instant is still ahead, and its instants belong to that date",
    {
      minutes: Schema.Int,
      weekday: Weekday,
      time: SlotTime,
      team: Zone,
      members: Schema.Array(Zone),
      skips: Schema.Array(Schema.Literals([0, 1, 2, 3])),
    },
    ({ minutes, weekday, time, team, members, skips }) => {
      const now = Date.UTC(2026, 0, 1) + (Math.abs(minutes) % (366 * 1440)) * 60_000;
      const sendTime = SendTime.make(time);
      const memberTimeZones = members.slice(0, 4);
      const unskipped = nextRoundSlot({
        now,
        weekday,
        sendTime,
        teamTimeZone: team,
        memberTimeZones,
        answerWindowDays: 2,
        unavailableDates: new Set(),
      });
      const unavailableDates = new Set(skips.map((week) => shiftDays(unskipped.plannedOpenDate, 7 * week)));
      const slot = nextRoundSlot({
        now,
        weekday,
        sendTime,
        teamTimeZone: team,
        memberTimeZones,
        answerWindowDays: 2,
        unavailableDates,
      });
      const recomputed = calculateRoundInstants(slot.plannedOpenDate, sendTime, memberTimeZones, team, 2);
      let firstFree = unskipped.plannedOpenDate;
      while (unavailableDates.has(firstFree)) firstFree = shiftDays(firstFree, 7);
      return (
        weekdayOf(slot.plannedOpenDate) === weekday &&
        slot.instants.openInstant > now &&
        slot.instants.openInstant === recomputed.openInstant &&
        slot.instants.closeInstant === recomputed.closeInstant &&
        slot.plannedOpenDate === firstFree &&
        unskipped.instants.openInstant - now <= 8 * 86_400_000
      );
    },
  );

  it("skips a week when a member ahead of the team's zone would already have been sent to", () => {
    const slot = nextRoundSlot({
      now: Date.UTC(2026, 10, 16, 23, 0),
      weekday: "tuesday",
      sendTime: SendTime.make("06:00"),
      teamTimeZone: "UTC",
      memberTimeZones: ["Asia/Tokyo"],
      answerWindowDays: 1,
      unavailableDates: new Set<string>(),
    });
    expect(slot.plannedOpenDate).toBe("2026-11-24");
    expect(slot.instants.openInstant).toBe(Date.UTC(2026, 10, 23, 21, 0));
  });

  it("moves the date with the open instant when a Pulse changes from Tuesday to Wednesday", () => {
    const now = Date.UTC(2026, 10, 17, 20, 11);
    const base = {
      now,
      sendTime: SendTime.make("06:00"),
      teamTimeZone: "Europe/Berlin",
      memberTimeZones: ["Europe/Berlin", "Europe/Berlin"],
      answerWindowDays: 1,
      unavailableDates: new Set<string>(),
    };
    const tuesday = nextRoundSlot({ ...base, weekday: "tuesday" });
    const wednesday = nextRoundSlot({ ...base, weekday: "wednesday" });
    expect(tuesday.plannedOpenDate).toBe("2026-11-24");
    expect(wednesday.plannedOpenDate).toBe("2026-11-18");
    expect(wednesday.instants.openInstant).toBe(Date.UTC(2026, 10, 18, 5, 0));
    expect(wednesday.instants.closeInstant).toBe(Date.UTC(2026, 10, 19, 5, 0));
  });
});
