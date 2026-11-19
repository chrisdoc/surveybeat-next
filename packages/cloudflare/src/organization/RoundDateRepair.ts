import type { SqliteClient } from "@effect/sql-sqlite-do";
import { calculateRoundInstants } from "@surveybeat/domain";
import type { SendTime } from "@surveybeat/domain";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type { makeSqlDirectory } from "../SqlDirectory.ts";
import type { makeSqlPulses } from "../SqlPulses.ts";
import type { makeSqlRounds, RoundWithFrozenZones } from "../SqlRounds.ts";
import type { makeScheduling } from "./Scheduling.ts";

export const ROUND_PLANNED_OPEN_DATE_REPAIR = "round-planned-open-date";

export interface PlannedOpenDateMove {
  readonly roundId: string;
  readonly from: string;
  readonly to: string;
}

const pad = (value: number, width: number): string => String(value).padStart(width, "0");

export const localDateOf = (instant: number, timeZone: string): string => {
  const { year, month, day } = DateTime.toParts(DateTime.makeZonedUnsafe(instant, { timeZone }));
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
};

const dayMs = 24 * 3_600_000;

const minimumCadenceShiftDays = 2;

export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);

export const latestLocalDate = (instant: number, timeZones: readonly string[]): string | null => {
  let latest: string | null = null;
  for (const timeZone of timeZones) {
    const date = localDateOf(instant, timeZone);
    if (latest === null || date > latest) latest = date;
  }
  return latest;
};

export const scheduledRoundIsHealthy = (
  round: { readonly plannedOpenDate: string; readonly plannedOpenAt: number },
  slot: {
    readonly sendTime: SendTime;
    readonly memberTimeZones: readonly string[];
    readonly teamTimeZone: string;
    readonly answerWindowDays: number;
  },
): boolean =>
  calculateRoundInstants(
    round.plannedOpenDate,
    slot.sendTime,
    slot.memberTimeZones,
    slot.teamTimeZone,
    slot.answerWindowDays,
  ).openInstant === round.plannedOpenAt;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const applyDateMove = (node: unknown, move: PlannedOpenDateMove): boolean => {
  if (!isRecord(node)) return false;
  let changed = false;
  if (node.roundId === move.roundId && node.plannedOpenDate === move.from) {
    node.plannedOpenDate = move.to;
    changed = true;
  }
  if (node.previousRoundId === move.roundId && node.previousRoundDate === move.from) {
    node.previousRoundDate = move.to;
    changed = true;
  }
  for (const child of Object.values(node)) {
    if (applyDateMove(child, move)) changed = true;
  }
  return changed;
};

export const rewritePayloadDates = (
  payload: string,
  moves: readonly PlannedOpenDateMove[],
): string | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  let changed = false;
  for (const move of moves) {
    if (applyDateMove(parsed, move)) changed = true;
  }
  return changed ? JSON.stringify(parsed) : null;
};

export const repairRoundPlannedOpenDates = ({
  sql,
  rounds,
  directory,
  pulses,
  scheduling,
  now,
}: {
  sql: SqliteClient.SqliteClient;
  rounds: ReturnType<typeof makeSqlRounds>;
  directory: ReturnType<typeof makeSqlDirectory>;
  pulses: ReturnType<typeof makeSqlPulses>;
  scheduling: ReturnType<typeof makeScheduling>;
  now: number;
}) =>
  Effect.gen(function* () {
    const alreadyDone = yield* sql<{ name: string }>`SELECT name FROM maintenance_done
        WHERE name = ${ROUND_PLANNED_OPEN_DATE_REPAIR}`.pipe(Effect.map((found) => found.length > 0));
    if (alreadyDone) return;

    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const moves: PlannedOpenDateMove[] = [];
          let waiting: { readonly round: RoundWithFrozenZones; readonly wanted: string }[] = [];
          for (const round of yield* rounds.getRoundsWithFrozenMembers()) {
            const wanted = latestLocalDate(round.plannedOpenAt, round.timeZones);
            if (wanted === null || wanted === round.plannedOpenDate) continue;
            if (Math.abs(daysBetween(round.plannedOpenDate, wanted)) < minimumCadenceShiftDays) {
              yield* Effect.logWarning("ROUND_PLANNED_OPEN_DATE_UNCERTAIN", {
                roundId: round.id,
                plannedOpenDate: round.plannedOpenDate,
                wanted,
              });
              continue;
            }
            waiting.push({ round, wanted });
          }

          let moved = true;
          while (moved && waiting.length > 0) {
            moved = false;
            const stillWaiting: typeof waiting = [];
            for (const entry of waiting) {
              const taken = (yield* rounds.getUnavailableRoundDates(entry.round.pulseId, entry.round.id)).has(
                entry.wanted,
              );
              if (taken) {
                stillWaiting.push(entry);
                continue;
              }
              yield* rounds.setPlannedOpenDate(entry.round.id, entry.wanted, now);
              moves.push({ roundId: entry.round.id, from: entry.round.plannedOpenDate, to: entry.wanted });
              moved = true;
            }
            waiting = stillWaiting;
          }
          for (const { round, wanted } of waiting) {
            yield* Effect.logWarning("ROUND_PLANNED_OPEN_DATE_CONFLICT", {
              roundId: round.id,
              plannedOpenDate: round.plannedOpenDate,
              wanted,
            });
          }

          if (moves.length > 0) {
            const stored = yield* rounds.getRoundResultPayloads();
            for (const result of stored) {
              const rewritten = rewritePayloadDates(result.payload, moves);
              if (rewritten !== null) yield* rounds.setRoundResultPayload(result.roundId, rewritten);
            }
          }

          const dirState = yield* directory.load;
          const pulseState = yield* pulses.load;
          for (const pulse of pulseState.pulses) {
            const scheduled = yield* rounds.findScheduledRound(pulse.id);
            if (scheduled === null) continue;
            const team = dirState.teams.find((t) => t.id === scheduled.teamId);
            if (team === undefined) continue;
            const { memberTimeZones } = yield* scheduling.activeMembersWithTimeZones(
              dirState,
              scheduled.teamId,
              team.timeZone,
            );
            const healthy = scheduledRoundIsHealthy(scheduled, {
              sendTime: pulse.settings.cadence.time,
              memberTimeZones,
              teamTimeZone: team.timeZone,
              answerWindowDays: pulse.settings.answerWindowDays,
            });
            if (!healthy) yield* scheduling.updateScheduledRoundForPulse(pulse.id, now);
          }

          yield* sql`INSERT INTO maintenance_done (name, done_at) VALUES (${ROUND_PLANNED_OPEN_DATE_REPAIR}, ${now})`;
        }),
      )
      .pipe(Effect.orDie);
  });
