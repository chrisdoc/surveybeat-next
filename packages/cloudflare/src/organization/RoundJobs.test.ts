import { SqliteClient } from "@effect/sql-sqlite-do";
import { assert, describe, it } from "@effect/vitest";
import {
  defaultSendPolicy,
  EmailAddress,
  makeSendStore,
  PersonId,
  RoundId,
  type SendId,
  type InvitationTokenRef,
  type SendStoreShape,
  type StoredEmail,
  TeamId,
} from "@surveybeat/domain";
import { migratedDatabase, SqliteStorage } from "@surveybeat/testing";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { makeSqlActions } from "../SqlActions.ts";
import { makeSqlDirectory } from "../SqlDirectory.ts";
import { makeSqlPulses } from "../SqlPulses.ts";
import { makeSqlRounds, secureRandomBytes } from "../SqlRounds.ts";
import { makeSqlSendRepository } from "../SqlSendRepository.ts";
import { organizationRoundCommands } from "./RoundCommands.ts";
import { makeRoundJobs } from "./RoundJobs.ts";
import { makeScheduling } from "./Scheduling.ts";

const migrationsDir = new URL("../../migrations/", import.meta.url);
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 23, 9);

const QUESTION_A = { text: "How clear is the plan?", lowLabel: "Unclear", highLabel: "Clear" };
const QUESTION_B = { text: "How heard do you feel?", lowLabel: "Unheard", highLabel: "Heard" };

type RecordedSend = {
  readonly sendId: SendId;
  readonly recipient: EmailAddress;
  readonly email: StoredEmail;
};

const seed = (db: ReturnType<typeof migratedDatabase>) => {
  const rating = (text: string, lowLabel: string, highLabel: string) =>
    JSON.stringify({ _tag: "Rating", lowLabel, highLabel, comment: false });
  db.exec(`
    INSERT INTO organization (id, name) VALUES ('org-1', 'Acme');
    INSERT INTO team (id, name, time_zone) VALUES ('team-1', 'Platform', 'UTC');
    INSERT INTO person (id, email) VALUES ('lead-1', 'lead@example.com'), ('member-1', 'member@example.com');
    INSERT INTO membership (id, team_id, person_id, role, started_at, ended_at) VALUES
      ('m-lead', 'team-1', 'lead-1', 'lead', 1000, NULL),
      ('m-member', 'team-1', 'member-1', 'member', 1000, NULL);
    INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders,
                       anonymity_mode, distribution, created_at)
      VALUES ('pulse-1', 'team-1', 'Pulse 1', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000);
    INSERT INTO question (id, template_key, created_at) VALUES ('q-a', NULL, 1000), ('q-b', NULL, 1000);
    INSERT INTO question_version (id, question_id, number, text, dimension, type) VALUES
      ('qv-a', 'q-a', 1, '${QUESTION_A.text}', NULL, '${rating(QUESTION_A.text, QUESTION_A.lowLabel, QUESTION_A.highLabel)}'),
      ('qv-b', 'q-b', 1, '${QUESTION_B.text}', NULL, '${rating(QUESTION_B.text, QUESTION_B.lowLabel, QUESTION_B.highLabel)}');
    INSERT INTO pulse_question (pulse_id, position, question_version_id) VALUES ('pulse-1', 0, 'qv-a'), ('pulse-1', 1, 'qv-b');
  `);
};

/** The Lead reorders the live Pulse after the Round has frozen its Questions. */
const reorderPulse = (db: ReturnType<typeof migratedDatabase>) => {
  db.exec(`
    DELETE FROM pulse_question WHERE pulse_id = 'pulse-1';
    INSERT INTO pulse_question (pulse_id, position, question_version_id) VALUES ('pulse-1', 0, 'qv-b'), ('pulse-1', 1, 'qv-a');
  `);
};

const insertRound = (
  db: ReturnType<typeof migratedDatabase>,
  round: {
    readonly id: string;
    readonly status: string;
    readonly openedAt: number | null;
    readonly closedAt: number | null;
    readonly reviewEndsAt: number | null;
  },
) => {
  db.prepare(
    `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, opened_at,
       planned_close_at, closed_at, review_ends_at, pulse_name, answer_window_days, reminders,
       anonymity_mode, distribution, created_at, updated_at)
     VALUES (?, 'pulse-1', 'team-1', ?, '2026-11-23', ?, ?, ?, ?, ?, 'Pulse 1', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
  ).run(round.id, round.status, T0, round.openedAt, T0 + 3 * DAY, round.closedAt, round.reviewEndsAt);
};

const freezeQuestions = (
  db: ReturnType<typeof migratedDatabase>,
  roundId: string,
  versionIds: ReadonlyArray<string>,
) => {
  versionIds.forEach((versionId, position) => {
    db.prepare("INSERT INTO round_question (round_id, position, question_version_id) VALUES (?, ?, ?)").run(
      roundId,
      position,
      versionId,
    );
  });
};

const insertInvitation = (db: ReturnType<typeof migratedDatabase>, roundId: string, personId: string) => {
  db.prepare(
    `INSERT INTO invitation (round_id, person_id, token_hash, send_id, status, failed_reason, resend_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', NULL, 0, ?, ?)`,
  ).run(roundId, personId, `hash-${personId}`, `send-${personId}`, T0, T0);
};

const insertJob = (
  db: ReturnType<typeof migratedDatabase>,
  job: {
    readonly id: string;
    readonly roundId: string;
    readonly type: string;
    readonly dueAt: number;
    readonly payload: string | null;
  },
) => {
  db.prepare(
    `INSERT INTO schedule_job (id, round_id, type, due_at, status, payload, created_at, completed_at)
     VALUES (?, ?, ?, ?, 'pending', ?, 1000, NULL)`,
  ).run(job.id, job.roundId, job.type, job.dueAt, job.payload);
};

const jobStatus = (db: ReturnType<typeof migratedDatabase>, jobId: string) =>
  db.prepare("SELECT status FROM schedule_job WHERE id = ?").get(jobId)?.status;

const roundStatus = (db: ReturnType<typeof migratedDatabase>, roundId: string) =>
  db.prepare("SELECT status FROM round WHERE id = ?").get(roundId)?.status;

const ratingOf = (email: StoredEmail) => ("ratingQuestion" in email ? email.ratingQuestion : null);

/**
 * The Organization's Round machinery on the real migrations. Outgoing sends are recorded; the
 * Results-ready notification insert can be made to fail, the one step the compute job must survive.
 */
const build = (options: { readonly failNotifications?: boolean } = {}) =>
  Effect.gen(function* () {
    const db = migratedDatabase(migrationsDir);
    seed(db);
    const sql = yield* SqliteClient.make({
      storage: SqliteStorage.makeSqliteStorage(db) as unknown as NonNullable<
        Parameters<typeof SqliteClient.make>[0]["storage"]
      >,
    }).pipe(Effect.provideService(Scope.Scope, yield* Scope.make()), Effect.provide(Reactivity.layer));

    const rounds = makeSqlRounds(sql, secureRandomBytes);
    const pulses = makeSqlPulses(sql);
    const realSends = makeSendStore(makeSqlSendRepository(sql), defaultSendPolicy);
    const directory = makeSqlDirectory(sql, realSends);
    const actions = makeSqlActions(sql);
    const recorded: Array<RecordedSend> = [];
    const sends = {
      create: (sendId: SendId, recipient: EmailAddress, email: StoredEmail) =>
        Effect.sync(() => {
          recorded.push({ sendId, recipient, email });
        }),
    } as unknown as SendStoreShape;

    let ids = 0;
    const randomId = () => `generated-${++ids}`;
    const scheduling = makeScheduling({
      rounds,
      directory,
      pulses,
      repairAlarm: () => Effect.void,
      randomId,
    });
    const failingRounds = {
      ...rounds,
      insertJob: (job: Parameters<typeof rounds.insertJob>[0]) =>
        job.type === "send" ? Effect.die(new Error("notification insert failed")) : rounds.insertJob(job),
    };
    const wired = options.failNotifications === true ? failingRounds : rounds;
    const deps = {
      sql,
      rounds: wired,
      directory,
      pulses,
      actions,
      sends,
      scheduling,
      repairAlarm: () => Effect.void,
      randomId,
      tokenOf: (ref: InvitationTokenRef) => Effect.succeed(`token-${ref.personId}`),
      appOrigin: "https://app.test",
      ai: {} as never,
    };
    const jobs = makeRoundJobs(deps);
    const commands = organizationRoundCommands({ ...deps, jobs });
    return { db, jobs, commands, recorded };
  });

describe("the Invitations and reminders of a Round", () => {
  it.effect("show the Round's frozen first Question, not the Pulse's, after the Pulse is reordered", () =>
    Effect.gen(function* () {
      const { db, jobs, recorded } = yield* build();
      insertRound(db, { id: "round-1", status: "open", openedAt: T0, closedAt: null, reviewEndsAt: null });
      freezeQuestions(db, "round-1", ["qv-a", "qv-b"]);
      reorderPulse(db);
      insertInvitation(db, "round-1", "member-1");
      insertJob(db, {
        id: "job-send",
        roundId: "round-1",
        type: "send",
        dueAt: T0 + HOUR,
        payload: JSON.stringify({ personId: "member-1" }),
      });

      yield* jobs.runScheduleJob("job-send", T0 + 2 * HOUR);

      assert.deepStrictEqual(
        recorded.map((each) => each.email._tag),
        ["InvitationEmail"],
      );
      assert.deepStrictEqual(
        recorded.map((each) => ratingOf(each.email)),
        [QUESTION_A],
      );
    }),
  );

  it.effect("show the Round's frozen first Question on a reminder", () =>
    Effect.gen(function* () {
      const { db, jobs, recorded } = yield* build();
      insertRound(db, { id: "round-1", status: "open", openedAt: T0, closedAt: null, reviewEndsAt: null });
      freezeQuestions(db, "round-1", ["qv-a", "qv-b"]);
      reorderPulse(db);
      insertInvitation(db, "round-1", "member-1");
      insertJob(db, {
        id: "job-remind",
        roundId: "round-1",
        type: "remind",
        dueAt: T0 + DAY,
        payload: JSON.stringify({ personId: "member-1" }),
      });

      yield* jobs.runScheduleJob("job-remind", T0 + DAY);

      assert.deepStrictEqual(
        recorded.map((each) => each.email._tag),
        ["ReminderEmail"],
      );
      assert.deepStrictEqual(
        recorded.map((each) => ratingOf(each.email)),
        [QUESTION_A],
      );
    }),
  );

  it.effect("show the Round's frozen first Question on a resent Invitation", () =>
    Effect.gen(function* () {
      const { db, commands, recorded } = yield* build();
      insertRound(db, { id: "round-1", status: "open", openedAt: T0, closedAt: null, reviewEndsAt: null });
      freezeQuestions(db, "round-1", ["qv-a", "qv-b"]);
      reorderPulse(db);
      insertInvitation(db, "round-1", "member-1");

      const result = yield* commands.runRoundCommand(
        PersonId.make("lead-1"),
        {
          _tag: "ResendInvitation",
          teamId: TeamId.make("team-1"),
          roundId: RoundId.make("round-1"),
          personId: PersonId.make("member-1"),
        },
        T0 + HOUR,
      );

      assert.deepStrictEqual(result, { _tag: "Accepted" });
      assert.deepStrictEqual(
        recorded.map((each) => each.email._tag),
        ["InvitationEmail"],
      );
      assert.deepStrictEqual(
        recorded.map((each) => ratingOf(each.email)),
        [QUESTION_A],
      );
    }),
  );
});

describe("the Results follow-up after a Round is computed", () => {
  const CLOSED_AT = T0 + DAY;
  const NOW = CLOSED_AT + HOUR;

  const seedClosedRound = (db: ReturnType<typeof migratedDatabase>, reviewEndsAt: number) => {
    insertRound(db, { id: "round-1", status: "closed", openedAt: T0, closedAt: CLOSED_AT, reviewEndsAt });
    freezeQuestions(db, "round-1", ["qv-a"]);
    db.exec(`
      INSERT INTO round_member (round_id, person_id, time_zone, send_at) VALUES
        ('round-1', 'lead-1', 'UTC', ${T0}), ('round-1', 'member-1', 'UTC', ${T0});
    `);
    insertJob(db, {
      id: "job-compute",
      roundId: "round-1",
      type: "compute",
      dueAt: CLOSED_AT,
      payload: null,
    });
  };

  it.effect(
    "leaves a pending share job due at the review window's end when the Lead notification fails",
    () =>
      Effect.gen(function* () {
        const { db, jobs } = yield* build({ failNotifications: true });
        seedClosedRound(db, CLOSED_AT + 3 * DAY);

        yield* jobs.runScheduleJob("job-compute", NOW);

        assert.strictEqual(roundStatus(db, "round-1"), "ready");
        const shares = db
          .prepare("SELECT status, due_at FROM schedule_job WHERE round_id = 'round-1' AND type = 'share'")
          .all();
        const round = db.prepare("SELECT review_ends_at FROM round WHERE id = 'round-1'").get();
        assert.deepStrictEqual(shares, [{ status: "pending", due_at: Number(round?.review_ends_at) }]);
      }),
  );

  it.effect("leaves the Round shared when the notification fails and there is no review window", () =>
    Effect.gen(function* () {
      const { db, jobs } = yield* build({ failNotifications: true });
      seedClosedRound(db, CLOSED_AT);

      yield* jobs.runScheduleJob("job-compute", NOW);

      assert.strictEqual(roundStatus(db, "round-1"), "shared");
    }),
  );

  it.effect("shares a Round with no review window and queues results for the Lead and the Members", () =>
    Effect.gen(function* () {
      const { db, jobs } = yield* build();
      seedClosedRound(db, CLOSED_AT);

      yield* jobs.runScheduleJob("job-compute", NOW);

      assert.strictEqual(roundStatus(db, "round-1"), "shared");
      assert.strictEqual(jobStatus(db, "job-compute"), "completed");
      const resultsJobs = db
        .prepare("SELECT id FROM schedule_job WHERE round_id = 'round-1' AND type = 'send' ORDER BY id")
        .all()
        .map((row) => row.id);
      assert.deepStrictEqual(resultsJobs, ["results-ready-round-1-lead-1", "results-ready-round-1-member-1"]);
    }),
  );

  it.effect("queues results for the Lead only and keeps the share job while the review window is open", () =>
    Effect.gen(function* () {
      const { db, jobs } = yield* build();
      seedClosedRound(db, CLOSED_AT + 3 * DAY);

      yield* jobs.runScheduleJob("job-compute", NOW);

      assert.strictEqual(roundStatus(db, "round-1"), "ready");
      const resultsJobs = db
        .prepare("SELECT id FROM schedule_job WHERE round_id = 'round-1' AND type = 'send' ORDER BY id")
        .all()
        .map((row) => row.id);
      assert.deepStrictEqual(resultsJobs, ["results-ready-round-1-lead-1"]);
      assert.strictEqual(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM schedule_job WHERE round_id = 'round-1' AND type = 'share' AND status = 'pending'",
          )
          .get()?.n,
        1,
      );
    }),
  );
});

describe("the open job", () => {
  it.effect("does not open a Round before the open job's due time has been moved to later", () =>
    Effect.gen(function* () {
      const { db, jobs } = yield* build();
      insertRound(db, {
        id: "round-1",
        status: "scheduled",
        openedAt: null,
        closedAt: null,
        reviewEndsAt: null,
      });
      insertJob(db, { id: "job-open", roundId: "round-1", type: "open", dueAt: T0 + HOUR, payload: null });

      yield* jobs.runScheduleJob("job-open", T0);

      assert.strictEqual(roundStatus(db, "round-1"), "scheduled");
      assert.strictEqual(jobStatus(db, "job-open"), "pending");

      yield* jobs.runScheduleJob("job-open", T0 + HOUR);

      assert.strictEqual(roundStatus(db, "round-1"), "open");
      assert.strictEqual(jobStatus(db, "job-open"), "completed");
    }),
  );
});
