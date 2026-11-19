import { SqliteClient } from "@effect/sql-sqlite-do";
import { assert, describe, it } from "@effect/vitest";
import { calculateRoundInstants, defaultSendPolicy, makeSendStore, SendTime } from "@surveybeat/domain";
import { migratedDatabase, SqliteStorage } from "@surveybeat/testing";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { makeSqlDirectory } from "../SqlDirectory.ts";
import { makeSqlPulses } from "../SqlPulses.ts";
import { makeSqlRounds, secureRandomBytes } from "../SqlRounds.ts";
import { makeSqlSendRepository } from "../SqlSendRepository.ts";
import {
  daysBetween,
  latestLocalDate,
  localDateOf,
  repairRoundPlannedOpenDates,
  rewritePayloadDates,
  scheduledRoundIsHealthy,
} from "./RoundDateRepair.ts";
import { makeScheduling } from "./Scheduling.ts";

const migrationsDir = new URL("../../migrations/", import.meta.url);

const DAY = 24 * 3_600_000;

const NOW = Date.UTC(2026, 10, 19);

const utc = (year: number, month: number, day: number, hour = 0, minute = 0): number =>
  Date.UTC(year, month - 1, day, hour, minute);

const setUp = () =>
  Effect.gen(function* () {
    const db = migratedDatabase(migrationsDir);
    db.exec(`
      INSERT INTO organization (id, name) VALUES ('org-1', 'Acme');
      INSERT INTO team (id, name, time_zone) VALUES ('team-1', 'Platform', 'Europe/Berlin');
      INSERT INTO person (id, email) VALUES ('p-berlin', 'berlin@example.com'), ('p-auckland', 'auckland@example.com');
      INSERT INTO membership (id, team_id, person_id, role, started_at, ended_at)
        VALUES ('m-berlin', 'team-1', 'p-berlin', 'member', 1000, NULL);
      INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
        VALUES ('pulse-1', 'team-1', 'Pulse 1', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000),
               ('pulse-2', 'team-1', 'Pulse 2', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000);
    `);

    const sql = yield* SqliteClient.make({
      storage: SqliteStorage.makeSqliteStorage(db) as unknown as NonNullable<
        Parameters<typeof SqliteClient.make>[0]["storage"]
      >,
    }).pipe(Effect.provideService(Scope.Scope, yield* Scope.make()), Effect.provide(Reactivity.layer));

    const rounds = makeSqlRounds(sql, secureRandomBytes);
    const pulses = makeSqlPulses(sql);
    const directory = makeSqlDirectory(sql, makeSendStore(makeSqlSendRepository(sql), defaultSendPolicy));
    let ids = 0;

    const scheduling = makeScheduling({
      rounds,
      directory,
      pulses,
      repairAlarm: () => Effect.void,
      randomId: () => `generated-${++ids}`,
    });

    return { db, sql, rounds, pulses, directory, scheduling };
  });

const insertRound = (
  db: ReturnType<typeof migratedDatabase>,
  round: {
    readonly id: string;
    readonly pulseId: string;
    readonly status: string;
    readonly plannedOpenDate: string;
    readonly plannedOpenAt: number;
  },
): void => {
  db.prepare(
    `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at,
       pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
     VALUES (?, ?, 'team-1', ?, ?, ?, ?, 'Pulse', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
  ).run(
    round.id,
    round.pulseId,
    round.status,
    round.plannedOpenDate,
    round.plannedOpenAt,
    round.plannedOpenAt + 3 * DAY,
  );
};

const freezeMember = (
  db: ReturnType<typeof migratedDatabase>,
  roundId: string,
  personId: string,
  timeZone: string,
  sendAt: number,
): void => {
  db.prepare("INSERT INTO round_member (round_id, person_id, time_zone, send_at) VALUES (?, ?, ?, ?)").run(
    roundId,
    personId,
    timeZone,
    sendAt,
  );
};

const storeResult = (db: ReturnType<typeof migratedDatabase>, roundId: string, payload: unknown): void => {
  db.prepare("INSERT INTO round_result (round_id, computed_at, payload) VALUES (?, 1000, ?)").run(
    roundId,
    JSON.stringify(payload),
  );
};

const row = (db: ReturnType<typeof migratedDatabase>, roundId: string) =>
  db.prepare("SELECT planned_open_date, planned_open_at FROM round WHERE id = ?").get(roundId);

const payloadOf = (db: ReturnType<typeof migratedDatabase>, roundId: string): unknown => {
  const found = db.prepare("SELECT payload FROM round_result WHERE round_id = ?").get(roundId);

  return JSON.parse(String(found?.payload));
};

describe("localDateOf and latestLocalDate", () => {
  it("reads the calendar date of an instant in a zone, so a late UTC instant can be the next day", () => {
    assert.strictEqual(localDateOf(utc(2026, 11, 22, 23, 30), "Europe/Berlin"), "2026-11-23");
    assert.strictEqual(localDateOf(utc(2026, 11, 22, 23, 30), "UTC"), "2026-11-22");
  });

  it("takes the latest local date across zones, which is the date of the earliest send", () => {
    const openedAt = utc(2026, 11, 22, 20, 0);
    assert.strictEqual(latestLocalDate(openedAt, ["Europe/Berlin", "Pacific/Auckland"]), "2026-11-23");
    assert.strictEqual(latestLocalDate(openedAt, ["America/Los_Angeles", "Europe/Berlin"]), "2026-11-22");
    assert.strictEqual(latestLocalDate(openedAt, ["Europe/Berlin"]), "2026-11-22");
    assert.strictEqual(latestLocalDate(openedAt, []), null);
  });
});

describe("daysBetween", () => {
  it("counts calendar days across a DST change and a month end", () => {
    assert.strictEqual(daysBetween("2026-10-23", "2026-10-30"), 7);
    assert.strictEqual(daysBetween("2026-11-30", "2026-11-23"), -7);
    assert.strictEqual(daysBetween("2026-03-28", "2026-03-30"), 2);
  });
});

describe("scheduledRoundIsHealthy", () => {
  const slot = {
    sendTime: SendTime.make("09:00"),
    memberTimeZones: ["Europe/Berlin"],
    teamTimeZone: "Europe/Berlin",
    answerWindowDays: 3,
  };

  it("is healthy when the instant is the cadence send on the planned date in the current zones", () => {
    const plannedOpenAt = calculateRoundInstants(
      "2026-11-23",
      SendTime.make("09:00"),
      ["Europe/Berlin"],
      "Europe/Berlin",
      3,
    ).openInstant;

    assert.isTrue(scheduledRoundIsHealthy({ plannedOpenDate: "2026-11-23", plannedOpenAt }, slot));
  });

  it("is stale when the instant belongs to a different date", () => {
    const plannedOpenAt = utc(2026, 11, 16, 8);
    assert.isFalse(scheduledRoundIsHealthy({ plannedOpenDate: "2026-11-23", plannedOpenAt }, slot));
  });

  it("is stale when a member zone changes the instant", () => {
    const plannedOpenAt = calculateRoundInstants(
      "2026-11-23",
      SendTime.make("09:00"),
      ["Europe/Berlin"],
      "Europe/Berlin",
      3,
    ).openInstant;

    assert.isFalse(
      scheduledRoundIsHealthy(
        { plannedOpenDate: "2026-11-23", plannedOpenAt },
        { ...slot, memberTimeZones: ["Pacific/Auckland"] },
      ),
    );
  });
});

describe("rewritePayloadDates", () => {
  const move = { roundId: "stale", from: "2026-11-23", to: "2026-11-16" };

  it("rewrites every object that names the moved Round with its old date, at any depth", () => {
    const payload = JSON.stringify({
      roundId: "stale",
      plannedOpenDate: "2026-11-23",
      trend: [{ roundId: "stale", plannedOpenDate: "2026-11-23", score: 3 }],
      questions: [{ change: { previousRoundId: "stale", previousRoundDate: "2026-11-23" } }],
    });

    assert.deepStrictEqual(JSON.parse(String(rewritePayloadDates(payload, [move]))), {
      roundId: "stale",
      plannedOpenDate: "2026-11-16",
      trend: [{ roundId: "stale", plannedOpenDate: "2026-11-16", score: 3 }],
      questions: [{ change: { previousRoundId: "stale", previousRoundDate: "2026-11-16" } }],
    });
  });

  it("leaves other Rounds and other dates alone, and reports no change", () => {
    const payload = JSON.stringify({
      roundId: "other",
      plannedOpenDate: "2026-11-23",
      trend: [{ roundId: "stale", plannedOpenDate: "2026-11-09", score: 3 }],
    });

    assert.isNull(rewritePayloadDates(payload, [move]));
  });

  it("reports no change for a payload that is not JSON", () => {
    assert.isNull(rewritePayloadDates("not json", [move]));
  });
});

describe("repairRoundPlannedOpenDates", () => {
  it.effect(
    "moves a closed Round's stale date to its instant's day, and rewrites the Results that name it",
    () =>
      Effect.gen(function* () {
        const { db, ...deps } = yield* setUp();
        insertRound(db, {
          id: "stale",
          pulseId: "pulse-1",
          status: "closed",
          plannedOpenDate: "2026-11-23",
          plannedOpenAt: utc(2026, 11, 16, 5),
        });
        freezeMember(db, "stale", "p-berlin", "Europe/Berlin", utc(2026, 11, 16, 5));
        insertRound(db, {
          id: "earlier",
          pulseId: "pulse-1",
          status: "shared",
          plannedOpenDate: "2026-11-09",
          plannedOpenAt: utc(2026, 11, 9, 8),
        });
        insertRound(db, {
          id: "later",
          pulseId: "pulse-1",
          status: "shared",
          plannedOpenDate: "2026-11-30",
          plannedOpenAt: utc(2026, 11, 30, 8),
        });
        storeResult(db, "stale", { roundId: "stale", plannedOpenDate: "2026-11-23", questions: [] });
        storeResult(db, "later", {
          roundId: "later",
          plannedOpenDate: "2026-11-30",
          trend: [
            { roundId: "stale", plannedOpenDate: "2026-11-23", score: 3 },
            { roundId: "earlier", plannedOpenDate: "2026-11-09", score: 4 },
          ],
          questions: [{ change: { change: 0.5, previousRoundId: "stale", previousRoundDate: "2026-11-23" } }],
        });

        yield* repairRoundPlannedOpenDates({ ...deps, now: NOW });

        assert.deepStrictEqual(row(db, "stale"), {
          planned_open_date: "2026-11-16",
          planned_open_at: utc(2026, 11, 16, 5),
        });
        assert.deepStrictEqual(payloadOf(db, "stale"), {
          roundId: "stale",
          plannedOpenDate: "2026-11-16",
          questions: [],
        });
        assert.deepStrictEqual(payloadOf(db, "later"), {
          roundId: "later",
          plannedOpenDate: "2026-11-30",
          trend: [
            { roundId: "stale", plannedOpenDate: "2026-11-16", score: 3 },
            { roundId: "earlier", plannedOpenDate: "2026-11-09", score: 4 },
          ],
          questions: [{ change: { change: 0.5, previousRoundId: "stale", previousRoundDate: "2026-11-16" } }],
        });
        assert.strictEqual(row(db, "earlier")?.planned_open_date, "2026-11-09");
      }),
  );

  it.effect(
    "leaves a Round whose frozen zones put the send on its own date, with a member zone ahead of the team",
    () =>
      Effect.gen(function* () {
        const { db, ...deps } = yield* setUp();
        const openAt = utc(2026, 11, 22, 20, 0);
        insertRound(db, {
          id: "ahead",
          pulseId: "pulse-1",
          status: "closed",
          plannedOpenDate: "2026-11-23",
          plannedOpenAt: openAt,
        });
        freezeMember(db, "ahead", "p-auckland", "Pacific/Auckland", openAt);
        freezeMember(db, "ahead", "p-berlin", "Europe/Berlin", utc(2026, 11, 23, 8));

        yield* repairRoundPlannedOpenDates({ ...deps, now: NOW });

        assert.deepStrictEqual(row(db, "ahead"), {
          planned_open_date: "2026-11-23",
          planned_open_at: openAt,
        });
      }),
  );

  it.effect("moves a stale date to the latest member zone's day when several zones are frozen", () =>
    Effect.gen(function* () {
      const { db, ...deps } = yield* setUp();
      const openAt = utc(2026, 11, 22, 20, 0);
      insertRound(db, {
        id: "stale-multi",
        pulseId: "pulse-1",
        status: "closed",
        plannedOpenDate: "2026-11-30",
        plannedOpenAt: openAt,
      });
      freezeMember(db, "stale-multi", "p-auckland", "Pacific/Auckland", openAt);
      freezeMember(db, "stale-multi", "p-berlin", "Europe/Berlin", utc(2026, 11, 23, 8));

      yield* repairRoundPlannedOpenDates({ ...deps, now: NOW });

      assert.deepStrictEqual(row(db, "stale-multi"), {
        planned_open_date: "2026-11-23",
        planned_open_at: openAt,
      });
    }),
  );

  it.effect("leaves a date one day off alone, because a member who left before opening explains it", () =>
    Effect.gen(function* () {
      const { db, ...deps } = yield* setUp();
      const openAt = utc(2026, 11, 22, 20, 0);
      insertRound(db, {
        id: "auckland-left",
        pulseId: "pulse-1",
        status: "closed",
        plannedOpenDate: "2026-11-23",
        plannedOpenAt: openAt,
      });
      freezeMember(db, "auckland-left", "p-berlin", "Europe/Berlin", utc(2026, 11, 23, 8));

      yield* repairRoundPlannedOpenDates({ ...deps, now: NOW });

      assert.strictEqual(row(db, "auckland-left")?.planned_open_date, "2026-11-23");
    }),
  );

  it.effect("moves a Round onto a day another stale Round is moving away from", () =>
    Effect.gen(function* () {
      const { db, ...deps } = yield* setUp();
      insertRound(db, {
        id: "a-blocked",
        pulseId: "pulse-1",
        status: "closed",
        plannedOpenDate: "2026-11-30",
        plannedOpenAt: utc(2026, 11, 23, 8),
      });
      freezeMember(db, "a-blocked", "p-berlin", "Europe/Berlin", utc(2026, 11, 23, 8));
      insertRound(db, {
        id: "b-holder",
        pulseId: "pulse-1",
        status: "closed",
        plannedOpenDate: "2026-11-23",
        plannedOpenAt: utc(2026, 11, 16, 8),
      });
      freezeMember(db, "b-holder", "p-berlin", "Europe/Berlin", utc(2026, 11, 16, 8));

      yield* repairRoundPlannedOpenDates({ ...deps, now: NOW });

      assert.strictEqual(row(db, "a-blocked")?.planned_open_date, "2026-11-23");
      assert.strictEqual(row(db, "b-holder")?.planned_open_date, "2026-11-16");
    }),
  );

  it.effect("leaves a stale date alone when another Round of the Pulse already holds the right day", () =>
    Effect.gen(function* () {
      const { db, ...deps } = yield* setUp();
      insertRound(db, {
        id: "conflict",
        pulseId: "pulse-1",
        status: "closed",
        plannedOpenDate: "2026-11-23",
        plannedOpenAt: utc(2026, 11, 16, 5),
      });
      freezeMember(db, "conflict", "p-berlin", "Europe/Berlin", utc(2026, 11, 16, 5));
      insertRound(db, {
        id: "holder",
        pulseId: "pulse-1",
        status: "shared",
        plannedOpenDate: "2026-11-16",
        plannedOpenAt: utc(2026, 11, 9, 8),
      });

      yield* repairRoundPlannedOpenDates({ ...deps, now: NOW });

      assert.strictEqual(row(db, "conflict")?.planned_open_date, "2026-11-23");
    }),
  );

  it.effect("leaves a stale date alone when the Pulse skipped the right day", () =>
    Effect.gen(function* () {
      const { db, ...deps } = yield* setUp();
      insertRound(db, {
        id: "skipped",
        pulseId: "pulse-1",
        status: "closed",
        plannedOpenDate: "2026-11-23",
        plannedOpenAt: utc(2026, 11, 16, 5),
      });
      freezeMember(db, "skipped", "p-berlin", "Europe/Berlin", utc(2026, 11, 16, 5));
      db.prepare(
        "INSERT INTO pulse_skip (pulse_id, planned_open_date, created_at) VALUES ('pulse-1', '2026-11-16', 1000)",
      ).run();

      yield* repairRoundPlannedOpenDates({ ...deps, now: NOW });

      assert.strictEqual(row(db, "skipped")?.planned_open_date, "2026-11-23");
    }),
  );

  it.effect("runs once: a second run changes nothing, even when the data is stale again", () =>
    Effect.gen(function* () {
      const { db, ...deps } = yield* setUp();
      insertRound(db, {
        id: "stale",
        pulseId: "pulse-1",
        status: "closed",
        plannedOpenDate: "2026-11-23",
        plannedOpenAt: utc(2026, 11, 16, 5),
      });
      freezeMember(db, "stale", "p-berlin", "Europe/Berlin", utc(2026, 11, 16, 5));

      yield* repairRoundPlannedOpenDates({ ...deps, now: NOW });
      assert.strictEqual(row(db, "stale")?.planned_open_date, "2026-11-16");

      db.prepare("UPDATE round SET planned_open_date = '2026-11-23' WHERE id = 'stale'").run();
      yield* repairRoundPlannedOpenDates({ ...deps, now: NOW + DAY });

      assert.strictEqual(row(db, "stale")?.planned_open_date, "2026-11-23");
      const marks = db.prepare("SELECT name, done_at FROM maintenance_done").all();
      assert.deepStrictEqual(marks, [{ name: "round-planned-open-date", done_at: NOW }]);
    }),
  );

  it.effect(
    "re-slots a scheduled Round whose instant does not match its date, and leaves a healthy one",
    () =>
      Effect.gen(function* () {
        const { db, ...deps } = yield* setUp();
        const healthyAt = utc(2026, 11, 30, 8);
        db.prepare(
          `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at,
           pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
         VALUES ('stale-scheduled', 'pulse-1', 'team-1', 'scheduled', '2026-11-30', ?, ?, 'Pulse 1', 3, 1, 'anonymous', 'invitation', 1000, 1000),
                ('healthy-scheduled', 'pulse-2', 'team-1', 'scheduled', '2026-11-30', ?, ?, 'Pulse 2', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
        ).run(utc(2026, 11, 16, 8), utc(2026, 11, 19, 8), healthyAt, healthyAt + 3 * DAY);

        yield* repairRoundPlannedOpenDates({ ...deps, now: NOW });

        const expectedOpen = calculateRoundInstants(
          "2026-11-23",
          SendTime.make("09:00"),
          ["Europe/Berlin"],
          "Europe/Berlin",
          3,
        ).openInstant;

        assert.deepStrictEqual(row(db, "stale-scheduled"), {
          planned_open_date: "2026-11-23",
          planned_open_at: expectedOpen,
        });
        assert.deepStrictEqual(row(db, "healthy-scheduled"), {
          planned_open_date: "2026-11-30",
          planned_open_at: healthyAt,
        });
      }),
  );
});
