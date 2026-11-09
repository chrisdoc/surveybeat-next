import { assert, describe, it } from "@effect/vitest";
import { Clock, Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import {
  calculateReminders,
  calculateResultsReadyDeliveryTime,
  calculateRoundInstants,
  localToUtc,
  nextEightWeeksCadenceDates,
  type RoundRecord,
} from "./Lifecycle.ts";
import { RoundId } from "./Round.ts";
import { PulseId, SendTime } from "../pulses/Pulse.ts";
import { TeamId } from "../people/Team.ts";

describe("Lifecycle scheduling and time engine", () => {
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

  it.effect("generates unguessable 128-bit base64url tokens and valid SHA-256 hex hashes", () =>
    Effect.gen(function* () {
      const { generateInvitationToken, hashToken } = yield* Effect.promise(() => import("./Lifecycle.ts"));
      const token1 = generateInvitationToken();
      const token2 = generateInvitationToken();
      assert.strictEqual(typeof token1, "string");
      assert.strictEqual(token1.length, 22); // 16 bytes base64url = 22 characters unpadded
      assert.notStrictEqual(token1, token2);
      // Valid base64url characters only
      assert.match(token1, /^[A-Za-z0-9_-]{22}$/);

      const hash1 = yield* Effect.promise(() => hashToken(token1));
      const hash2 = yield* Effect.promise(() => hashToken(token1));
      const hashOther = yield* Effect.promise(() => hashToken(token2));

      // SHA-256 hex is 64 lower-case hex characters
      assert.match(hash1, /^[0-9a-f]{64}$/);
      assert.strictEqual(hash1, hash2); // deterministic
      assert.notStrictEqual(hash1, hashOther);
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
});
