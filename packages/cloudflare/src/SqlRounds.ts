import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  AlreadyAnswered,
  AnonymityMode,
  AnswerWindowDays,
  Dimension,
  Distribution,
  EmailAddress,
  type FailedInvitation,
  type FrozenRoundMember,
  type HistoricalRoundData,
  JobId,
  PersonId,
  PulseId,
  type QuestionInput,
  QuestionType,
  QuestionVersionId,
  redact,
  ReminderCount,
  type Roster,
  RoundId,
  RoundNotOpen,
  type RoundRecord,
  RoundResult,
  RoundStatus,
  type ScheduleJobRecord,
  ScheduleJobStatus,
  ScheduleJobType,
  selectActionsForRound,
  ActionStatus,
  SendId,
  type SubmissionAnswer,
  SubmissionId,
  SubmissionNotFound,
  type SubmissionRoundContext,
  TeamId,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
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

const PreviousRoundRow = Schema.Struct({
  opened_at: Schema.NullOr(Schema.Int),
  planned_open_at: Schema.Int,
});

const ActionSummaryRow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: ActionStatus,
  created_at: Schema.Int,
  updated_at: Schema.Int,
  done_at: Schema.NullOr(Schema.Int),
});

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

  const decodeRoundResultPayload = (payload: string): RoundResult | null => {
    try {
      const parsed: unknown = JSON.parse(payload);
      const decoded = Schema.decodeUnknownOption(RoundResult)(parsed);
      return Option.getOrNull(decoded);
    } catch {
      return null;
    }
  };

  const decodeHistoricalPayload = (payload: string): HistoricalRoundData | null => {
    const res = decodeRoundResultPayload(payload);
    if (res === null) return null;
    return {
      roundId: res.roundId,
      plannedOpenDate: res.plannedOpenDate,
      closedAt: res.closedAt,
      effectiveMinimumGroupSize: res.effectiveMinimumGroupSize,
      submissionsCount: res.submissionsCount,
      questions: res.questions.map((q) => ({
        questionVersionId: q.questionVersionId,
        score: q.score,
        contributors: q.contributors,
        meetsMinimumGroupSize: q.meetsMinimumGroupSize,
      })),
      dimensions: res.dimensions.map((d) => ({
        dimension: d.dimension,
        score: d.score,
        usableQuestionCount: d.usableQuestionCount,
        // Results stored before the count was kept lack it.
        ...(d.contributors === undefined ? {} : { contributors: d.contributors }),
        meetsMinimumGroupSize: d.meetsMinimumGroupSize,
      })),
    };
  };

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

  const deleteSubmissionsAndParticipations = (roundId: RoundId): Effect.Effect<void> =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM answer WHERE submission_id IN (SELECT id FROM submission WHERE round_id = ${roundId})`;
          yield* sql`DELETE FROM submission WHERE round_id = ${roundId}`;
          yield* sql`DELETE FROM participation WHERE round_id = ${roundId}`;
        }),
      )
      .pipe(Effect.asVoid, Effect.orDie);

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

  const deleteParticipationForPerson = (personId: PersonId): Effect.Effect<void> =>
    sql`DELETE FROM participation WHERE person_id = ${personId}`.pipe(Effect.asVoid, Effect.orDie);

  const recordParticipation = (roundId: RoundId, personId: PersonId): Effect.Effect<void> =>
    sql`INSERT INTO participation (round_id, person_id)
        VALUES (${roundId}, ${personId})
        ON CONFLICT (round_id, person_id) DO NOTHING`.pipe(Effect.asVoid, Effect.orDie);

  const random128BitKey = (): string =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );

  const getSubmissionByEditKeyHash = (
    editKeyHash: string,
  ): Effect.Effect<{ id: string; roundId: string } | null> =>
    sql<{
      id: string;
      round_id: string;
    }>`SELECT id, round_id FROM submission WHERE edit_key_hash = ${editKeyHash} LIMIT 1`.pipe(
      Effect.map((rows) => {
        const row = rows[0];
        return row === undefined ? null : { id: row.id, roundId: row.round_id };
      }),
      Effect.orDie,
    );

  const recordFirstAnswer = (
    roundId: RoundId,
    personId: PersonId,
    editKeyHash: string,
    answers: ReadonlyArray<{
      questionVersionId: QuestionVersionId;
      value: number | null;
      comment: string | null;
    }>,
    roster: Roster,
  ): Effect.Effect<
    { submissionId: SubmissionId; shownToLead: string | null },
    AlreadyAnswered | RoundNotOpen
  > =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const round = yield* getRound(roundId);
          if (round === null || round.status !== "open") {
            return yield* new RoundNotOpen();
          }
          const answered = yield* hasAnswered(roundId, personId);
          if (answered) {
            return yield* new AlreadyAnswered();
          }

          const submissionId = SubmissionId.make(random128BitKey());
          yield* sql`INSERT INTO participation (round_id, person_id) VALUES (${roundId}, ${personId})`;
          yield* sql`INSERT INTO submission (id, round_id, edit_key_hash) VALUES (${submissionId}, ${roundId}, ${editKeyHash})`;

          let lastRedactedComment: string | null = null;
          for (const ans of answers) {
            const redacted = ans.comment ? redact(ans.comment, roster) : null;
            if (redacted !== null) lastRedactedComment = redacted;
            yield* sql`INSERT INTO answer (submission_id, question_version_id, value, comment)
                       VALUES (${submissionId}, ${ans.questionVersionId}, ${ans.value}, ${redacted})
                       ON CONFLICT (submission_id, question_version_id) DO UPDATE SET value = excluded.value, comment = excluded.comment`;
          }

          return { submissionId, shownToLead: lastRedactedComment };
        }),
      )
      .pipe(
        Effect.catch((err: unknown) => {
          if (err instanceof AlreadyAnswered || err instanceof RoundNotOpen) {
            return Effect.fail(err);
          }
          return Effect.die(err);
        }),
      );

  const saveAnswer = (
    editKeyHash: string,
    answers: ReadonlyArray<{
      questionVersionId: QuestionVersionId;
      value: number | null;
      comment: string | null;
    }>,
    roster: Roster,
  ): Effect.Effect<{ saved: boolean; shownToLead: string | null }, SubmissionNotFound | RoundNotOpen> =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const sub = yield* getSubmissionByEditKeyHash(editKeyHash);
          if (sub === null) {
            return yield* new SubmissionNotFound();
          }
          const round = yield* getRound(RoundId.make(sub.roundId));
          if (round === null || round.status !== "open") {
            return yield* new RoundNotOpen();
          }

          let lastRedactedComment: string | null = null;
          for (const ans of answers) {
            const redacted = ans.comment ? redact(ans.comment, roster) : null;
            if (redacted !== null) lastRedactedComment = redacted;
            yield* sql`INSERT INTO answer (submission_id, question_version_id, value, comment)
                       VALUES (${sub.id}, ${ans.questionVersionId}, ${ans.value}, ${redacted})
                       ON CONFLICT (submission_id, question_version_id) DO UPDATE SET value = excluded.value, comment = excluded.comment`;
          }

          return { saved: true, shownToLead: lastRedactedComment };
        }),
      )
      .pipe(
        Effect.catch((err: unknown) => {
          if (err instanceof SubmissionNotFound || err instanceof RoundNotOpen) {
            return Effect.fail(err);
          }
          return Effect.die(err);
        }),
      );

  const getMyAnswers = (
    editKeyHash: string,
  ): Effect.Effect<ReadonlyArray<SubmissionAnswer>, SubmissionNotFound> =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const sub = yield* getSubmissionByEditKeyHash(editKeyHash);
          if (sub === null) {
            return yield* new SubmissionNotFound();
          }
          const rows = yield* sql<{
            question_version_id: string;
            value: number | null;
            comment: string | null;
          }>`SELECT question_version_id, value, comment FROM answer WHERE submission_id = ${sub.id} ORDER BY question_version_id ASC`;

          return rows.map((r) => ({
            questionVersionId: QuestionVersionId.make(r.question_version_id),
            value: r.value,
            comment: r.comment,
          }));
        }),
      )
      .pipe(
        Effect.catch((err: unknown) => {
          if (err instanceof SubmissionNotFound) {
            return Effect.fail(err);
          }
          return Effect.die(err);
        }),
      );

  const getSubmissionRoundContext = (
    roundId: RoundId,
    personId: PersonId | null,
    minimumGroupSize: number,
  ): Effect.Effect<SubmissionRoundContext | null> =>
    Effect.gen(function* () {
      const round = yield* getRound(roundId);
      if (round === null) return null;

      const questions = yield* sql<{
        position: number;
        id: string;
        text: string;
        type: string;
      }>`SELECT rq.position, qv.id, qv.text, qv.type
         FROM round_question rq
         JOIN question_version qv ON qv.id = rq.question_version_id
         WHERE rq.round_id = ${roundId}
         ORDER BY rq.position ASC`.pipe(Effect.orDie);

      const parsedQuestions = questions.map((q) => {
        let parsedJson: unknown = null;
        try {
          parsedJson = JSON.parse(q.type);
        } catch {
          parsedJson = null;
        }
        const decoded = Schema.decodeUnknownOption(QuestionType)(parsedJson);
        const questionType = Option.getOrElse(decoded, (): QuestionType => ({
          _tag: "Rating",
          lowLabel: "Low",
          highLabel: "High",
          comment: true,
        }));
        return {
          id: QuestionVersionId.make(q.id),
          position: q.position,
          text: q.text,
          type: questionType,
        };
      });

      const answered = personId === null ? false : yield* hasAnswered(roundId, personId);

      const prevRows = yield* sql`
        SELECT opened_at, planned_open_at
        FROM round
        WHERE pulse_id = ${round.pulseId}
          AND planned_open_at < ${round.plannedOpenAt}
        ORDER BY planned_open_at DESC
        LIMIT 1`.pipe(Effect.flatMap(rows(PreviousRoundRow)), Effect.orDie);

      const previousRound = prevRows[0]
        ? { openedAt: prevRows[0].opened_at, plannedOpenAt: prevRows[0].planned_open_at }
        : null;

      const actionRows = yield* sql`
        SELECT id, title, status, created_at, updated_at, done_at
        FROM action
        WHERE team_id = ${round.teamId}
        ORDER BY created_at ASC`.pipe(Effect.flatMap(rows(ActionSummaryRow)), Effect.orDie);

      const eligibleActions = selectActionsForRound(
        actionRows.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          doneAt: r.done_at,
        })),
        previousRound,
      );

      return {
        roundId,
        pulseName: round.pulseName,
        minimumGroupSize,
        questions: parsedQuestions,
        actions: eligibleActions.slice(0, 3).map((a) => ({ id: a.id, title: a.title })),
        closeTime: round.plannedCloseAt,
        state: round.status,
        hasAnswered: answered,
      };
    }).pipe(Effect.orDie);

  const saveRoundResult = (
    roundId: RoundId,
    result: RoundResult,
    computedAt: number,
  ): Effect.Effect<void> => {
    const payload = JSON.stringify(result);
    return sql`INSERT INTO round_result (round_id, computed_at, payload)
        VALUES (${roundId}, ${computedAt}, ${payload})
        ON CONFLICT (round_id) DO UPDATE SET computed_at = excluded.computed_at, payload = excluded.payload`.pipe(
      Effect.asVoid,
      Effect.orDie,
    );
  };

  const getRoundResult = (roundId: RoundId): Effect.Effect<RoundResult | null> =>
    sql<{ payload: string }>`SELECT payload FROM round_result WHERE round_id = ${roundId}`.pipe(
      Effect.map((rows) => {
        const row = rows[0];
        if (row === undefined) return null;
        return decodeRoundResultPayload(row.payload);
      }),
      Effect.orDie,
    );

  const getRoundMembersCount = (roundId: RoundId): Effect.Effect<number> =>
    sql<{ count: number }>`SELECT count(*) as count FROM round_member WHERE round_id = ${roundId}`.pipe(
      Effect.map((rows) => rows[0]?.count ?? 0),
      Effect.orDie,
    );

  const getRoundQuestionsDetailed = (roundId: RoundId): Effect.Effect<ReadonlyArray<QuestionInput>> =>
    sql<{
      position: number;
      id: string;
      text: string;
      dimension: string | null;
      type: string;
    }>`SELECT rq.position, qv.id, qv.text, qv.dimension, qv.type
       FROM round_question rq
       JOIN question_version qv ON qv.id = rq.question_version_id
       WHERE rq.round_id = ${roundId}
       ORDER BY rq.position ASC`.pipe(
      Effect.map((rows) =>
        rows.map((q) => {
          let parsedJson: unknown = null;
          try {
            parsedJson = JSON.parse(q.type);
          } catch {
            parsedJson = null;
          }
          const decoded = Schema.decodeUnknownOption(QuestionType)(parsedJson);
          const questionType = Option.getOrElse(decoded, (): QuestionType => ({
            _tag: "Rating",
            lowLabel: "Low",
            highLabel: "High",
            comment: true,
          }));
          const dimDecoded = Schema.decodeUnknownOption(Dimension)(q.dimension);
          const dimension = Option.getOrNull(dimDecoded);

          return {
            id: QuestionVersionId.make(q.id),
            position: q.position,
            text: q.text,
            type: questionType,
            dimension,
          };
        }),
      ),
      Effect.orDie,
    );

  const getSubmissionsForRound = (
    roundId: RoundId,
  ): Effect.Effect<ReadonlyArray<{ id: string; answers: ReadonlyArray<SubmissionAnswer> }>> =>
    Effect.gen(function* () {
      const subRows = yield* sql<{
        id: string;
      }>`SELECT id FROM submission WHERE round_id = ${roundId} ORDER BY id ASC`;
      if (subRows.length === 0) return [];

      const ansRows = yield* sql<{
        submission_id: string;
        question_version_id: string;
        value: number | null;
        comment: string | null;
      }>`SELECT a.submission_id, a.question_version_id, a.value, a.comment
         FROM answer a
         JOIN submission s ON s.id = a.submission_id
         WHERE s.round_id = ${roundId}`;

      const grouped = new Map<string, Array<SubmissionAnswer>>();
      for (const ans of ansRows) {
        let list = grouped.get(ans.submission_id);
        if (list === undefined) {
          list = [];
          grouped.set(ans.submission_id, list);
        }
        list.push({
          questionVersionId: QuestionVersionId.make(ans.question_version_id),
          value: ans.value,
          comment: ans.comment,
        });
      }

      return subRows.map((s) => ({
        id: s.id,
        answers: grouped.get(s.id) ?? [],
      }));
    }).pipe(Effect.orDie);

  const getPastRoundsResultsForPulse = (
    pulseId: PulseId,
    limit: number,
    beforePlannedOpenDate?: string,
  ): Effect.Effect<ReadonlyArray<HistoricalRoundData>> =>
    Effect.gen(function* () {
      const rows =
        beforePlannedOpenDate !== undefined
          ? yield* sql<{ payload: string }>`
            SELECT rr.payload
            FROM round_result rr
            JOIN round r ON r.id = rr.round_id
            WHERE r.pulse_id = ${pulseId}
              AND r.planned_open_date < ${beforePlannedOpenDate}
              AND r.status IN ('closed', 'ready', 'shared')
            ORDER BY r.planned_open_at ASC
            LIMIT ${limit}`
          : yield* sql<{ payload: string }>`
            SELECT rr.payload
            FROM round_result rr
            JOIN round r ON r.id = rr.round_id
            WHERE r.pulse_id = ${pulseId}
              AND r.status IN ('closed', 'ready', 'shared')
            ORDER BY r.planned_open_at ASC
            LIMIT ${limit}`;

      const history: Array<HistoricalRoundData> = [];
      for (const row of rows) {
        const item = decodeHistoricalPayload(row.payload);
        if (item !== null) {
          history.push(item);
        }
      }
      return history;
    }).pipe(Effect.orDie);

  const updateJobPayload = (jobId: JobId, payload: string): Effect.Effect<void> =>
    sql`UPDATE schedule_job SET payload = ${payload} WHERE id = ${jobId}`.pipe(Effect.asVoid, Effect.orDie);

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
    deleteSubmissionsAndParticipations,
    deleteParticipationForPerson,
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
    // Submissions
    getSubmissionRoundContext,
    recordFirstAnswer,
    saveAnswer,
    getMyAnswers,
    // Results
    saveRoundResult,
    getRoundResult,
    getRoundMembersCount,
    getRoundQuestionsDetailed,
    getSubmissionsForRound,
    getPastRoundsResultsForPulse,
    updateJobPayload,
  };
};

export type SqlRounds = ReturnType<typeof makeSqlRounds>;
