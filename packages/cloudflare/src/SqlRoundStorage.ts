import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  ActionStatus,
  AlreadyAnswered,
  Dimension,
  QuestionType,
  QuestionVersionId,
  redact,
  RoundId,
  RoundNotOpen,
  RoundResult,
  RoundStatus,
  selectActionsForRound,
  SubmissionId,
  SubmissionNotFound,
  TeamId,
} from "@surveybeat/domain";
import type {
  HistoricalRoundData,
  PersonId,
  PulseId,
  QuestionInput,
  Roster,
  RoundRecord,
  SubmissionAnswer,
  SubmissionRoundContext,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const OrganizationAiRow = Schema.Struct({
  ai_processing: Schema.Int,
});

const ParticipatedRoundRow = Schema.Struct({
  id: RoundId,
  team_id: TeamId,
  team_name: Schema.String,
  pulse_name: Schema.String,
  planned_open_date: Schema.String,
  status: RoundStatus,
  payload: Schema.NullOr(Schema.String),
});

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

export const makeSqlRoundStorage = (
  sql: SqliteClient.SqliteClient,
  randomBytes: (size: number) => Uint8Array,
  getRound: (roundId: RoundId) => Effect.Effect<RoundRecord | null>,
  hasAnswered: (roundId: RoundId, personId: PersonId) => Effect.Effect<boolean>,
  rows: <S extends Schema.Top & { readonly DecodingServices: never }>(
    schema: S,
  ) => ReturnType<typeof Schema.decodeUnknownEffect<Schema.$Array<S>>>,
) => {
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

    if (res === null) {
      return null;
    }

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
        ...(d.contributors === undefined ? {} : { contributors: d.contributors }),
        meetsMinimumGroupSize: d.meetsMinimumGroupSize,
      })),
    };
  };

  const random128BitKey = (): string =>
    Array.from(randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");

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
    answers: readonly {
      questionVersionId: QuestionVersionId;
      value: number | null;
      comment: string | null;
    }[],
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

            if (redacted !== null) {
              lastRedactedComment = redacted;
            }

            yield* sql`INSERT INTO answer (submission_id, question_version_id, value, comment)
                       VALUES (${submissionId}, ${ans.questionVersionId}, ${ans.value}, ${redacted})
                       ON CONFLICT (submission_id, question_version_id) DO UPDATE SET value = excluded.value, comment = excluded.comment`;
          }

          return { submissionId, shownToLead: lastRedactedComment };
        }),
      )
      .pipe(Effect.catchTag("SqlError", (sqlError) => Effect.die(sqlError)));

  const saveAnswer = (
    editKeyHash: string,
    answers: readonly {
      questionVersionId: QuestionVersionId;
      value: number | null;
      comment: string | null;
    }[],
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

            if (redacted !== null) {
              lastRedactedComment = redacted;
            }

            yield* sql`INSERT INTO answer (submission_id, question_version_id, value, comment)
                       VALUES (${sub.id}, ${ans.questionVersionId}, ${ans.value}, ${redacted})
                       ON CONFLICT (submission_id, question_version_id) DO UPDATE SET value = excluded.value, comment = excluded.comment`;
          }

          return { saved: true, shownToLead: lastRedactedComment };
        }),
      )
      .pipe(Effect.catchTag("SqlError", (sqlError) => Effect.die(sqlError)));

  const getSubmissionRoundContext = (
    roundId: RoundId,
    personId: PersonId | null,
    minimumGroupSize: number,
  ): Effect.Effect<SubmissionRoundContext | null> =>
    Effect.gen(function* () {
      const round = yield* getRound(roundId);

      if (round === null) {
        return null;
      }

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

      const organizationRows = yield* sql`SELECT ai_processing FROM organization LIMIT 1`.pipe(
        Effect.flatMap(rows(OrganizationAiRow)),
        Effect.orDie,
      );

      const aiProcessing = organizationRows[0]?.ai_processing === 1;

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
        aiProcessing,
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

  const deleteRoundResult = (roundId: RoundId): Effect.Effect<void> =>
    sql`DELETE FROM round_result WHERE round_id = ${roundId}`.pipe(Effect.asVoid, Effect.orDie);

  const getRoundResult = (roundId: RoundId): Effect.Effect<RoundResult | null> =>
    sql<{ payload: string; pulse_name: string }>`SELECT rr.payload, r.pulse_name
        FROM round_result rr JOIN round r ON r.id = rr.round_id
       WHERE rr.round_id = ${roundId}`.pipe(
      Effect.map((rows) => {
        const row = rows[0];

        if (row === undefined) {
          return null;
        }

        const result = decodeRoundResultPayload(row.payload);

        return result === null ? null : { ...result, pulseName: row.pulse_name };
      }),
      Effect.orDie,
    );

  const getSharedRoundResultsForTeam = (teamId: TeamId): Effect.Effect<readonly RoundResult[]> =>
    sql<{
      payload: string;
      pulse_name: string;
    }>`SELECT rr.payload, r.pulse_name FROM round_result rr JOIN round r ON r.id = rr.round_id WHERE r.team_id = ${teamId} AND r.status = 'shared' ORDER BY r.planned_open_at ASC, r.id ASC`.pipe(
      Effect.map((rows) =>
        rows.flatMap((row) => {
          const result = decodeRoundResultPayload(row.payload);

          return result === null ? [] : [{ ...result, pulseName: row.pulse_name }];
        }),
      ),
      Effect.orDie,
    );

  const getParticipatedRounds = (personId: PersonId) =>
    sql`SELECT r.id, r.team_id, t.name AS team_name, r.pulse_name, r.planned_open_date, r.status, rr.payload
        FROM participation p
        JOIN round r ON r.id = p.round_id
        JOIN team t ON t.id = r.team_id
        LEFT JOIN round_result rr ON rr.round_id = r.id
        WHERE p.person_id = ${personId}
        ORDER BY r.planned_open_date DESC, r.id DESC`.pipe(
      Effect.flatMap(rows(ParticipatedRoundRow)),
      Effect.map((list) =>
        list.map((row) => ({
          roundId: row.id,
          teamId: row.team_id,
          teamName: row.team_name,
          pulseName: row.pulse_name,
          plannedOpenDate: row.planned_open_date,
          status: row.status,
          result: row.payload === null ? null : decodeRoundResultPayload(row.payload),
        })),
      ),
      Effect.orDie,
    );

  const getRoundMembersCount = (roundId: RoundId): Effect.Effect<number> =>
    sql<{ count: number }>`SELECT count(*) as count FROM round_member WHERE round_id = ${roundId}`.pipe(
      Effect.map((rows) => rows[0]?.count ?? 0),
      Effect.orDie,
    );

  const getRoundQuestionsDetailed = (roundId: RoundId): Effect.Effect<readonly QuestionInput[]> =>
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
  ): Effect.Effect<readonly { id: string; answers: readonly SubmissionAnswer[] }[]> =>
    Effect.gen(function* () {
      const subRows = yield* sql<{
        id: string;
      }>`SELECT id FROM submission WHERE round_id = ${roundId} ORDER BY id ASC`;

      if (subRows.length === 0) {
        return [];
      }

      const ansRows = yield* sql<{
        submission_id: string;
        question_version_id: string;
        value: number | null;
        comment: string | null;
      }>`SELECT a.submission_id, a.question_version_id, a.value, a.comment
         FROM answer a
         JOIN submission s ON s.id = a.submission_id
         WHERE s.round_id = ${roundId}`;

      const grouped = new Map<string, SubmissionAnswer[]>();

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
  ): Effect.Effect<readonly HistoricalRoundData[]> =>
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
            ORDER BY r.planned_open_at DESC
            LIMIT ${limit}`
          : yield* sql<{ payload: string }>`
            SELECT rr.payload
            FROM round_result rr
            JOIN round r ON r.id = rr.round_id
            WHERE r.pulse_id = ${pulseId}
              AND r.status IN ('closed', 'ready', 'shared')
            ORDER BY r.planned_open_at DESC
            LIMIT ${limit}`;

      const history: HistoricalRoundData[] = [];

      for (const row of [...rows].toReversed()) {
        const item = decodeHistoricalPayload(row.payload);

        if (item !== null) {
          history.push(item);
        }
      }

      return history;
    }).pipe(Effect.orDie);

  return {
    recordFirstAnswer,
    saveAnswer,
    getSubmissionRoundContext,
    saveRoundResult,
    deleteRoundResult,
    getRoundResult,
    getSharedRoundResultsForTeam,
    getParticipatedRounds,
    getRoundMembersCount,
    getRoundQuestionsDetailed,
    getSubmissionsForRound,
    getPastRoundsResultsForPulse,
  };
};
