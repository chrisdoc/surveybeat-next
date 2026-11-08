import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  AnonymityMode,
  AnswerWindowDays,
  Distribution,
  EmailAddress,
  type FailedInvitation,
  type FrozenRoundMember,
  JobId,
  PersonId,
  PulseId,
  QuestionVersionId,
  ReminderCount,
  RoundId,
  type RoundRecord,
  RoundStatus,
  type ScheduleJobRecord,
  ScheduleJobStatus,
  ScheduleJobType,
  SendId,
  TeamId,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const RoundRow = Schema.Struct({
  id: RoundId,
  pulse_id: PulseId,
  team_id: TeamId,
  status: RoundStatus,
  planned_open_date: Schema.String,
  planned_open_at: Schema.Int,
  opened_at: Schema.NullOr(Schema.Int),
  planned_close_at: Schema.Int,
  closed_at: Schema.NullOr(Schema.Int),
  effective_minimum_group_size: Schema.NullOr(Schema.Int),
  pulse_name: Schema.String,
  answer_window_days: AnswerWindowDays,
  reminders: ReminderCount,
  anonymity_mode: AnonymityMode,
  distribution: Distribution,
  created_at: Schema.Int,
  updated_at: Schema.Int,
});

const ScheduleJobRow = Schema.Struct({
  id: JobId,
  round_id: RoundId,
  type: ScheduleJobType,
  due_at: Schema.Int,
  status: ScheduleJobStatus,
  payload: Schema.NullOr(Schema.String),
  created_at: Schema.Int,
  completed_at: Schema.NullOr(Schema.Int),
});

const RoundQuestionRow = Schema.Struct({
  round_id: RoundId,
  position: Schema.Int,
  question_version_id: QuestionVersionId,
});

const _RoundMemberRow = Schema.Struct({
  round_id: RoundId,
  person_id: Schema.String,
  time_zone: Schema.String,
  send_at: Schema.Int,
});

const InvitationRow = Schema.Struct({
  round_id: RoundId,
  person_id: PersonId,
  token_hash: Schema.String,
  send_id: SendId,
  status: Schema.Literals(["pending", "sending", "sent", "failed", "revoked"]),
  failed_reason: Schema.NullOr(Schema.String),
  resend_count: Schema.Int,
  created_at: Schema.Int,
  updated_at: Schema.Int,
});

const FailedInvitationRow = Schema.Struct({
  person_id: PersonId,
  email: EmailAddress,
  failed_reason: Schema.NullOr(Schema.String),
  resend_count: Schema.Int,
});

export interface InvitationRecord {
  readonly roundId: RoundId;
  readonly personId: PersonId;
  readonly tokenHash: string;
  readonly sendId: SendId;
  readonly status: "pending" | "sending" | "sent" | "failed" | "revoked";
  readonly failedReason: string | null;
  readonly resendCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const rows = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.Array(schema));

export const makeSqlRounds = (sql: SqliteClient.SqliteClient) => {
  const toRoundRecord = (row: typeof RoundRow.Type): RoundRecord => ({
    id: row.id,
    pulseId: row.pulse_id,
    teamId: row.team_id,
    status: row.status,
    plannedOpenDate: row.planned_open_date,
    plannedOpenAt: row.planned_open_at,
    openedAt: row.opened_at,
    plannedCloseAt: row.planned_close_at,
    closedAt: row.closed_at,
    effectiveMinimumGroupSize: row.effective_minimum_group_size,
    pulseName: row.pulse_name,
    answerWindowDays: row.answer_window_days,
    reminders: row.reminders,
    anonymityMode: row.anonymity_mode,
    distribution: row.distribution,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const toScheduleJobRecord = (row: typeof ScheduleJobRow.Type): ScheduleJobRecord => ({
    id: row.id,
    roundId: row.round_id,
    type: row.type,
    dueAt: row.due_at,
    status: row.status,
    payload: row.payload,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  });

  const toInvitationRecord = (row: typeof InvitationRow.Type): InvitationRecord => ({
    roundId: row.round_id,
    personId: row.person_id,
    tokenHash: row.token_hash,
    sendId: row.send_id,
    status: row.status,
    failedReason: row.failed_reason,
    resendCount: row.resend_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const getRound = (roundId: RoundId): Effect.Effect<RoundRecord | null> =>
    sql`SELECT * FROM round WHERE id = ${roundId}`.pipe(
      Effect.flatMap(rows(RoundRow)),
      Effect.map((r) => {
        const row = r[0];
        return row === undefined ? null : toRoundRecord(row);
      }),
      Effect.orDie,
    );

  const getRoundsForPulse = (pulseId: PulseId): Effect.Effect<ReadonlyArray<RoundRecord>> =>
    sql`SELECT * FROM round WHERE pulse_id = ${pulseId} ORDER BY planned_open_at DESC`.pipe(
      Effect.flatMap(rows(RoundRow)),
      Effect.map((all) => all.map(toRoundRecord)),
      Effect.orDie,
    );

  const getRoundQuestions = (roundId: RoundId): Effect.Effect<ReadonlyArray<QuestionVersionId>> =>
    sql`SELECT round_id, position, question_version_id FROM round_question WHERE round_id = ${roundId} ORDER BY position ASC`.pipe(
      Effect.flatMap(rows(RoundQuestionRow)),
      Effect.map((all) => all.map((q) => q.question_version_id)),
      Effect.orDie,
    );

  const findScheduledRound = (pulseId: PulseId): Effect.Effect<RoundRecord | null> =>
    sql`SELECT * FROM round WHERE pulse_id = ${pulseId} AND status = 'scheduled' LIMIT 1`.pipe(
      Effect.flatMap(rows(RoundRow)),
      Effect.map((r) => {
        const row = r[0];
        return row === undefined ? null : toRoundRecord(row);
      }),
      Effect.orDie,
    );

  const findOpenRound = (pulseId: PulseId): Effect.Effect<RoundRecord | null> =>
    sql`SELECT * FROM round WHERE pulse_id = ${pulseId} AND status = 'open' LIMIT 1`.pipe(
      Effect.flatMap(rows(RoundRow)),
      Effect.map((r) => {
        const row = r[0];
        return row === undefined ? null : toRoundRecord(row);
      }),
      Effect.orDie,
    );

  const insertRound = (round: RoundRecord): Effect.Effect<boolean> =>
    sql`INSERT INTO round (
          id, pulse_id, team_id, status, planned_open_date, planned_open_at, opened_at,
          planned_close_at, closed_at, effective_minimum_group_size, pulse_name,
          answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at
        ) VALUES (
          ${round.id}, ${round.pulseId}, ${round.teamId}, ${round.status}, ${round.plannedOpenDate},
          ${round.plannedOpenAt}, ${round.openedAt}, ${round.plannedCloseAt}, ${round.closedAt},
          ${round.effectiveMinimumGroupSize}, ${round.pulseName}, ${round.answerWindowDays},
          ${round.reminders}, ${round.anonymityMode}, ${round.distribution}, ${round.createdAt}, ${round.updatedAt}
        ) ON CONFLICT (pulse_id, planned_open_date) DO NOTHING`.pipe(Effect.as(true), Effect.orDie);

  const updateScheduledRound = (
    roundId: RoundId,
    pulseName: string,
    answerWindowDays: number,
    reminders: number,
    plannedOpenAt: number,
    plannedCloseAt: number,
    now: number,
  ): Effect.Effect<void> =>
    sql`UPDATE round
        SET pulse_name = ${pulseName}, answer_window_days = ${answerWindowDays}, reminders = ${reminders},
            planned_open_at = ${plannedOpenAt}, planned_close_at = ${plannedCloseAt}, updated_at = ${now}
        WHERE id = ${roundId} AND status = 'scheduled'`.pipe(Effect.asVoid, Effect.orDie);

  const openRound = (
    roundId: RoundId,
    openedAt: number,
    plannedCloseAt: number,
    questions: ReadonlyArray<QuestionVersionId>,
    members: ReadonlyArray<FrozenRoundMember>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* sql`UPDATE round
                 SET status = 'open', opened_at = ${openedAt}, planned_close_at = ${plannedCloseAt}, updated_at = ${openedAt}
                 WHERE id = ${roundId} AND status = 'scheduled'`;

      yield* sql`DELETE FROM round_question WHERE round_id = ${roundId}`;
      yield* Effect.forEach(
        questions,
        (qId, position) =>
          sql`INSERT INTO round_question (round_id, position, question_version_id)
              VALUES (${roundId}, ${position}, ${qId})
              ON CONFLICT (round_id, position) DO NOTHING`,
        { discard: true },
      );

      yield* sql`DELETE FROM round_member WHERE round_id = ${roundId}`;
      yield* Effect.forEach(
        members,
        (m) =>
          sql`INSERT INTO round_member (round_id, person_id, time_zone, send_at)
              VALUES (${roundId}, ${m.personId}, ${m.timeZone}, ${m.sendAt})
              ON CONFLICT (round_id, person_id) DO NOTHING`,
        { discard: true },
      );
    }).pipe(Effect.orDie);

  const closeRound = (roundId: RoundId, closedAt: number, effectiveN: number): Effect.Effect<void> =>
    sql`UPDATE round
        SET status = 'closed', closed_at = ${closedAt}, effective_minimum_group_size = ${effectiveN}, updated_at = ${closedAt}
        WHERE id = ${roundId} AND status = 'open'`.pipe(Effect.asVoid, Effect.orDie);

  const markRoundReadyAndShared = (roundId: RoundId, now: number): Effect.Effect<void> =>
    sql`UPDATE round
        SET status = 'shared', updated_at = ${now}
        WHERE id = ${roundId} AND status = 'closed'`.pipe(Effect.asVoid, Effect.orDie);

  const cancelRound = (roundId: RoundId, now: number): Effect.Effect<void> =>
    sql`UPDATE round
        SET status = 'cancelled', updated_at = ${now}
        WHERE id = ${roundId} AND status IN ('scheduled', 'open')`.pipe(Effect.asVoid, Effect.orDie);

  const deleteSubmissionsAndParticipationsSeam = (_roundId: RoundId): Effect.Effect<void> =>
    // Seam for slice 09: submission and participation tables do not exist yet.
    Effect.void;

  // Pulse pause / skip methods
  const pausePulse = (pulseId: PulseId, now: number): Effect.Effect<void> =>
    sql`UPDATE pulse SET paused_at = ${now} WHERE id = ${pulseId}`.pipe(Effect.asVoid, Effect.orDie);

  const resumePulse = (pulseId: PulseId): Effect.Effect<void> =>
    sql`UPDATE pulse SET paused_at = NULL WHERE id = ${pulseId}`.pipe(Effect.asVoid, Effect.orDie);

  const isPulsePaused = (pulseId: PulseId): Effect.Effect<boolean> =>
    sql<{ paused_at: number | null }>`SELECT paused_at FROM pulse WHERE id = ${pulseId}`.pipe(
      Effect.map((rows) => {
        const row = rows[0];
        return row !== undefined && row.paused_at !== null;
      }),
      Effect.orDie,
    );

  const skipWeek = (pulseId: PulseId, plannedOpenDate: string, now: number): Effect.Effect<void> =>
    sql`INSERT INTO pulse_skip (pulse_id, planned_open_date, created_at)
        VALUES (${pulseId}, ${plannedOpenDate}, ${now})
        ON CONFLICT (pulse_id, planned_open_date) DO NOTHING`.pipe(Effect.asVoid, Effect.orDie);

  const unskipWeek = (pulseId: PulseId, plannedOpenDate: string): Effect.Effect<void> =>
    sql`DELETE FROM pulse_skip WHERE pulse_id = ${pulseId} AND planned_open_date = ${plannedOpenDate}`.pipe(
      Effect.asVoid,
      Effect.orDie,
    );

  const getSkippedWeeks = (pulseId: PulseId): Effect.Effect<ReadonlySet<string>> =>
    sql<{
      planned_open_date: string;
    }>`SELECT planned_open_date FROM pulse_skip WHERE pulse_id = ${pulseId}`.pipe(
      Effect.map((rows) => new Set(rows.map((r) => r.planned_open_date))),
      Effect.orDie,
    );

  // Schedule Job methods
  const insertJob = (job: ScheduleJobRecord): Effect.Effect<void> =>
    sql`INSERT INTO schedule_job (id, round_id, type, due_at, status, payload, created_at, completed_at)
        VALUES (${job.id}, ${job.roundId}, ${job.type}, ${job.dueAt}, ${job.status}, ${job.payload}, ${job.createdAt}, ${job.completedAt})
        ON CONFLICT (id) DO NOTHING`.pipe(Effect.asVoid, Effect.orDie);

  const updateJobDueAt = (roundId: RoundId, type: ScheduleJobType, dueAt: number): Effect.Effect<void> =>
    sql`UPDATE schedule_job SET due_at = ${dueAt} WHERE round_id = ${roundId} AND type = ${type} AND status = 'pending'`.pipe(
      Effect.asVoid,
      Effect.orDie,
    );

  const markJobCompleted = (jobId: JobId, now: number): Effect.Effect<void> =>
    sql`UPDATE schedule_job SET status = 'completed', completed_at = ${now} WHERE id = ${jobId}`.pipe(
      Effect.asVoid,
      Effect.orDie,
    );

  const cancelJobsForRound = (
    roundId: RoundId,
    types?: ReadonlyArray<ScheduleJobType>,
  ): Effect.Effect<void> => {
    if (types === undefined || types.length === 0) {
      return sql`UPDATE schedule_job SET status = 'cancelled' WHERE round_id = ${roundId} AND status = 'pending'`.pipe(
        Effect.asVoid,
        Effect.orDie,
      );
    }
    return Effect.forEach(
      types,
      (type) =>
        sql`UPDATE schedule_job SET status = 'cancelled' WHERE round_id = ${roundId} AND type = ${type} AND status = 'pending'`,
      { discard: true },
    ).pipe(Effect.orDie);
  };

  const getJob = (jobId: JobId): Effect.Effect<ScheduleJobRecord | null> =>
    sql`SELECT * FROM schedule_job WHERE id = ${jobId}`.pipe(
      Effect.flatMap(rows(ScheduleJobRow)),
      Effect.map((r) => {
        const row = r[0];
        return row === undefined ? null : toScheduleJobRecord(row);
      }),
      Effect.orDie,
    );

  const getDueJobs = (now: number): Effect.Effect<ReadonlyArray<ScheduleJobRecord>> =>
    sql`SELECT * FROM schedule_job WHERE status = 'pending' AND due_at <= ${now} ORDER BY due_at ASC, id ASC`.pipe(
      Effect.flatMap(rows(ScheduleJobRow)),
      Effect.map((all) => all.map(toScheduleJobRecord)),
      Effect.orDie,
    );

  const getEarliestPendingJobDueAt = (): Effect.Effect<number | null> =>
    sql<{ due_at: number }>`SELECT MIN(due_at) as due_at FROM schedule_job WHERE status = 'pending'`.pipe(
      Effect.map((rows) => {
        const row = rows[0];
        return row === undefined || row.due_at === null ? null : row.due_at;
      }),
      Effect.orDie,
    );

  // Invitation methods
  const insertInvitations = (invitations: ReadonlyArray<InvitationRecord>): Effect.Effect<void> =>
    Effect.forEach(
      invitations,
      (inv) =>
        sql`INSERT INTO invitation (round_id, person_id, token_hash, send_id, status, failed_reason, resend_count, created_at, updated_at)
            VALUES (${inv.roundId}, ${inv.personId}, ${inv.tokenHash}, ${inv.sendId}, ${inv.status}, ${inv.failedReason}, ${inv.resendCount}, ${inv.createdAt}, ${inv.updatedAt})
            ON CONFLICT (round_id, person_id) DO NOTHING`,
      { discard: true },
    ).pipe(Effect.orDie);

  const getInvitations = (roundId: RoundId): Effect.Effect<ReadonlyArray<InvitationRecord>> =>
    sql`SELECT * FROM invitation WHERE round_id = ${roundId}`.pipe(
      Effect.flatMap(rows(InvitationRow)),
      Effect.map((all) => all.map(toInvitationRecord)),
      Effect.orDie,
    );

  const getInvitation = (roundId: RoundId, personId: PersonId): Effect.Effect<InvitationRecord | null> =>
    sql`SELECT * FROM invitation WHERE round_id = ${roundId} AND person_id = ${personId}`.pipe(
      Effect.flatMap(rows(InvitationRow)),
      Effect.map((r) => (r[0] === undefined ? null : toInvitationRecord(r[0]))),
      Effect.orDie,
    );

  const getInvitationByTokenHash = (tokenHash: string): Effect.Effect<InvitationRecord | null> =>
    sql`SELECT * FROM invitation WHERE token_hash = ${tokenHash}`.pipe(
      Effect.flatMap(rows(InvitationRow)),
      Effect.map((r) => (r[0] === undefined ? null : toInvitationRecord(r[0]))),
      Effect.orDie,
    );

  const updateInvitationStatus = (
    roundId: RoundId,
    personId: PersonId,
    status: "pending" | "sending" | "sent" | "failed" | "revoked",
    failedReason: string | null,
    now: number,
  ): Effect.Effect<void> =>
    sql`UPDATE invitation
        SET status = ${status}, failed_reason = ${failedReason}, updated_at = ${now}
        WHERE round_id = ${roundId} AND person_id = ${personId}`.pipe(Effect.asVoid, Effect.orDie);

  const getInvitationBySendId = (sendId: SendId): Effect.Effect<InvitationRecord | null> =>
    sql`SELECT * FROM invitation WHERE send_id = ${sendId}`.pipe(
      Effect.flatMap(rows(InvitationRow)),
      Effect.map((r) => (r[0] === undefined ? null : toInvitationRecord(r[0]))),
      Effect.orDie,
    );

  const getFailedInvitations = (roundId: RoundId): Effect.Effect<ReadonlyArray<FailedInvitation>> =>
    sql`SELECT i.person_id, p.email, COALESCE(i.failed_reason, es.status) as failed_reason, i.resend_count
        FROM invitation i
        JOIN person p ON p.id = i.person_id
        LEFT JOIN email_send es ON es.id = i.send_id
        WHERE i.round_id = ${roundId} AND (i.status = 'failed' OR es.status = 'Failed')`.pipe(
      Effect.flatMap(rows(FailedInvitationRow)),
      Effect.map((rows) =>
        rows.map((r) => ({
          personId: r.person_id,
          email: r.email,
          reason: r.failed_reason ?? "unknown",
          resendCount: r.resend_count,
        })),
      ),
      Effect.orDie,
    );

  const resendInvitation = (
    roundId: RoundId,
    personId: PersonId,
    newSendId: SendId,
    newTokenHash: string,
    now: number,
  ): Effect.Effect<InvitationRecord | null> =>
    Effect.gen(function* () {
      yield* sql`UPDATE invitation
                 SET token_hash = ${newTokenHash}, send_id = ${newSendId}, status = 'pending', failed_reason = NULL,
                     resend_count = resend_count + 1, updated_at = ${now}
                 WHERE round_id = ${roundId} AND person_id = ${personId}`;
      return yield* getInvitation(roundId, personId);
    }).pipe(Effect.orDie);

  const revokeInvitationsForRound = (roundId: RoundId, now: number): Effect.Effect<ReadonlyArray<string>> =>
    Effect.gen(function* () {
      const invs = yield* getInvitations(roundId);
      yield* sql`UPDATE invitation SET status = 'revoked', updated_at = ${now} WHERE round_id = ${roundId}`;
      return invs.map((i) => i.tokenHash);
    }).pipe(Effect.orDie);

  const revokeInvitationForPerson = (personId: PersonId, now: number): Effect.Effect<ReadonlyArray<string>> =>
    Effect.gen(function* () {
      const invs = yield* sql`SELECT * FROM invitation WHERE person_id = ${personId}`.pipe(
        Effect.flatMap(rows(InvitationRow)),
        Effect.map((all) => all.map(toInvitationRecord)),
        Effect.orDie,
      );
      yield* sql`UPDATE invitation SET status = 'revoked', updated_at = ${now} WHERE person_id = ${personId}`;
      return invs.map((i) => i.tokenHash);
    }).pipe(Effect.orDie);

  const optOutReminders = (pulseId: PulseId, personId: PersonId, now: number): Effect.Effect<void> =>
    sql`INSERT INTO pulse_reminder_opt_out (pulse_id, person_id, opted_out_at)
        VALUES (${pulseId}, ${personId}, ${now})
        ON CONFLICT (pulse_id, person_id) DO NOTHING`.pipe(Effect.asVoid, Effect.orDie);

  const isOptedOut = (pulseId: PulseId, personId: PersonId): Effect.Effect<boolean> =>
    sql<{
      count: number;
    }>`SELECT COUNT(*) as count FROM pulse_reminder_opt_out WHERE pulse_id = ${pulseId} AND person_id = ${personId}`.pipe(
      Effect.map((rows) => (rows[0]?.count ?? 0) > 0),
      Effect.orDie,
    );

  const hasAnswered = (roundId: RoundId, personId: PersonId): Effect.Effect<boolean> =>
    sql<{
      count: number;
    }>`SELECT COUNT(*) as count FROM participation WHERE round_id = ${roundId} AND person_id = ${personId}`.pipe(
      Effect.map((rows) => (rows[0]?.count ?? 0) > 0),
      Effect.orDie,
    );

  const getPersonTimeZone = (personId: PersonId): Effect.Effect<string | null> =>
    sql<{ time_zone: string | null }>`SELECT time_zone FROM person WHERE id = ${personId}`.pipe(
      Effect.map((rows) => rows[0]?.time_zone ?? null),
      Effect.orDie,
    );

  const setPersonTimeZone = (personId: PersonId, timeZone: string): Effect.Effect<void> =>
    sql`UPDATE person SET time_zone = ${timeZone} WHERE id = ${personId}`.pipe(Effect.asVoid, Effect.orDie);

  const recordParticipation = (
    roundId: RoundId,
    personId: PersonId,
    answeredAt: number,
  ): Effect.Effect<void> =>
    sql`INSERT INTO participation (round_id, person_id, answered_at)
        VALUES (${roundId}, ${personId}, ${answeredAt})
        ON CONFLICT (round_id, person_id) DO NOTHING`.pipe(Effect.asVoid, Effect.orDie);

  return {
    getRound,
    getRoundsForPulse,
    getRoundQuestions,
    findScheduledRound,
    findOpenRound,
    insertRound,
    updateScheduledRound,
    openRound,
    closeRound,
    markRoundReadyAndShared,
    cancelRound,
    deleteSubmissionsAndParticipationsSeam,
    pausePulse,
    resumePulse,
    isPulsePaused,
    skipWeek,
    unskipWeek,
    getSkippedWeeks,
    insertJob,
    updateJobDueAt,
    markJobCompleted,
    cancelJobsForRound,
    getJob,
    getDueJobs,
    getEarliestPendingJobDueAt,
    // Invitations
    insertInvitations,
    getInvitations,
    getInvitation,
    getInvitationByTokenHash,
    getInvitationBySendId,
    updateInvitationStatus,
    getFailedInvitations,
    resendInvitation,
    revokeInvitationsForRound,
    revokeInvitationForPerson,
    optOutReminders,
    isOptedOut,
    hasAnswered,
    recordParticipation,
    getPersonTimeZone,
    setPersonTimeZone,
  };
};

export type SqlRounds = ReturnType<typeof makeSqlRounds>;
