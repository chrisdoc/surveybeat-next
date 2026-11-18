import {
  type DirectoryState,
  JobId,
  nextRoundSlot,
  type PulseId,
  RoundId,
  type RoundRecord,
  type TeamId,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import type { makeSqlDirectory } from "../SqlDirectory.ts";
import type { makeSqlPulses } from "../SqlPulses.ts";
import type { makeSqlRounds } from "../SqlRounds.ts";

export const makeScheduling = ({
  rounds,
  directory,
  pulses,
  repairAlarm,
  randomId,
}: {
  rounds: ReturnType<typeof makeSqlRounds>;
  directory: ReturnType<typeof makeSqlDirectory>;
  pulses: ReturnType<typeof makeSqlPulses>;
  repairAlarm: () => Effect.Effect<void>;
  randomId: () => string;
}) => {
  const both = Effect.all([directory.load, pulses.load]);

  const activeMembersWithTimeZones = (dirState: DirectoryState, teamId: TeamId, teamTimeZone: string) =>
    Effect.gen(function* () {
      const activeMembers = dirState.memberships.filter(
        (m) => m.teamId === teamId && m.endedAt === null && (m.role === "lead" || m.role === "member"),
      );
      const memberTimeZones = yield* Effect.forEach(activeMembers, (m) =>
        rounds.getPersonTimeZone(m.personId).pipe(Effect.map((tz) => tz ?? teamTimeZone)),
      );
      return { activeMembers, memberTimeZones };
    });

  const scheduleNextRound = (pulseId: PulseId, teamId: TeamId, now: number) =>
    Effect.gen(function* () {
      const paused = yield* rounds.isPulsePaused(pulseId);
      if (paused) return;

      const existingScheduled = yield* rounds.findScheduledRound(pulseId);
      if (existingScheduled !== null) return;

      const [dirState, pulseState] = yield* both;
      const pulse = pulseState.pulses.find((p) => p.id === pulseId);
      if (pulse === undefined) return;
      const team = dirState.teams.find((t) => t.id === teamId);
      if (team === undefined) return;

      const { memberTimeZones } = yield* activeMembersWithTimeZones(dirState, teamId, team.timeZone);
      const { plannedOpenDate, instants } = nextRoundSlot({
        now,
        weekday: pulse.settings.cadence.day,
        sendTime: pulse.settings.cadence.time,
        teamTimeZone: team.timeZone,
        memberTimeZones,
        answerWindowDays: pulse.settings.answerWindowDays,
        unavailableDates: yield* rounds.getUnavailableRoundDates(pulseId, null),
      });

      const roundId = RoundId.make(randomId());
      const round: RoundRecord = {
        id: roundId,
        pulseId,
        teamId,
        status: "scheduled",
        plannedOpenDate,
        plannedOpenAt: instants.openInstant,
        openedAt: null,
        plannedCloseAt: instants.closeInstant,
        closedAt: null,
        reviewEndsAt: null,
        effectiveMinimumGroupSize: null,
        pulseName: pulse.settings.name,
        answerWindowDays: pulse.settings.answerWindowDays,
        reminders: pulse.settings.reminders,
        anonymityMode: pulse.settings.anonymityMode,
        distribution: pulse.settings.distribution,
        createdAt: now,
        updatedAt: now,
      };

      yield* rounds.insertRound(round);
      yield* rounds.insertJob({
        id: JobId.make(randomId()),
        roundId,
        type: "open",
        dueAt: instants.openInstant,
        status: "pending",
        payload: null,
        createdAt: now,
        completedAt: null,
      });

      yield* repairAlarm();
    });

  const updateScheduledRoundForPulse = (pulseId: PulseId, now: number) =>
    Effect.gen(function* () {
      const scheduled = yield* rounds.findScheduledRound(pulseId);
      if (scheduled === null) return;

      const [dirState, pulseState] = yield* both;
      const pulse = pulseState.pulses.find((p) => p.id === pulseId);
      if (pulse === undefined) return;
      const team = dirState.teams.find((t) => t.id === scheduled.teamId);
      if (team === undefined) return;

      const { memberTimeZones } = yield* activeMembersWithTimeZones(
        dirState,
        scheduled.teamId,
        team.timeZone,
      );
      const { plannedOpenDate, instants } = nextRoundSlot({
        now,
        weekday: pulse.settings.cadence.day,
        sendTime: pulse.settings.cadence.time,
        teamTimeZone: team.timeZone,
        memberTimeZones,
        answerWindowDays: pulse.settings.answerWindowDays,
        unavailableDates: yield* rounds.getUnavailableRoundDates(pulseId, scheduled.id),
      });

      yield* rounds.updateScheduledRound(scheduled.id, {
        pulseName: pulse.settings.name,
        answerWindowDays: pulse.settings.answerWindowDays,
        reminders: pulse.settings.reminders,
        plannedOpenDate,
        plannedOpenAt: instants.openInstant,
        plannedCloseAt: instants.closeInstant,
        now,
      });
      yield* rounds.updateJobDueAt(scheduled.id, "open", instants.openInstant);
      yield* repairAlarm();
    });

  return { activeMembersWithTimeZones, scheduleNextRound, updateScheduledRoundForPulse };
};
