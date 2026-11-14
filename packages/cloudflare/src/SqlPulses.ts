// @effect-diagnostics anyUnknownInErrorContext:off -- the SQL driver's failure type is unknown and orDie turns it into a defect, so the Effect never exposes it.

import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  AnonymityMode,
  AnswerWindowDays,
  Dimension,
  Distribution,
  type PulseChange,
  PulseId,
  type PulseRecord,
  PulseName,
  type PulseState,
  QuestionId,
  QuestionText,
  QuestionType,
  QuestionVersionId,
  ReminderCount,
  ReviewWindowDays,
  SendTime,
  TeamId,
  TemplateQuestionKey,
  Weekday,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const TypeJson = Schema.fromJsonString(QuestionType);
const encodeType = Schema.encodeEffect(TypeJson);

const QuestionRow = Schema.Struct({
  id: QuestionId,
  template_key: Schema.NullOr(TemplateQuestionKey),
  created_at: Schema.Int,
});
const VersionRow = Schema.Struct({
  id: QuestionVersionId,
  question_id: QuestionId,
  number: Schema.Int,
  text: QuestionText,
  dimension: Schema.NullOr(Dimension),
  type: TypeJson,
});
const PulseRow = Schema.Struct({
  id: PulseId,
  team_id: TeamId,
  name: PulseName,
  cadence: Schema.Literal("weekly"),
  weekday: Weekday,
  send_time: SendTime,
  answer_window_days: AnswerWindowDays,
  review_window_days: ReviewWindowDays,
  reminders: ReminderCount,
  anonymity_mode: AnonymityMode,
  distribution: Distribution,
  created_at: Schema.Int,
});
const PulseQuestionRow = Schema.Struct({ pulse_id: PulseId, question_version_id: QuestionVersionId });

const rows = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.Array(schema));

export const makeSqlPulses = (sql: SqliteClient.SqliteClient) => {
  const load: Effect.Effect<PulseState> = Effect.gen(function* () {
    const questions = yield* sql`SELECT id, template_key, created_at FROM question`.pipe(
      Effect.flatMap(rows(QuestionRow)),
    );
    const versions = yield* sql`
      SELECT id, question_id, number, text, dimension, type FROM question_version`.pipe(
      Effect.flatMap(rows(VersionRow)),
    );
    const pulses = yield* sql`
      SELECT id, team_id, name, cadence, weekday, send_time, answer_window_days, review_window_days,
             reminders, anonymity_mode, distribution, created_at
        FROM pulse`.pipe(Effect.flatMap(rows(PulseRow)));
    const asked = yield* sql`
      SELECT pulse_id, question_version_id FROM pulse_question ORDER BY pulse_id, position`.pipe(
      Effect.flatMap(rows(PulseQuestionRow)),
    );
    return {
      questions: questions.map((row) => ({
        id: row.id,
        templateKey: row.template_key,
        createdAt: row.created_at,
      })),
      versions: versions.map((row) => ({
        id: row.id,
        questionId: row.question_id,
        number: row.number,
        content: { text: row.text, dimension: row.dimension, type: row.type },
      })),
      pulses: pulses.map((row): PulseRecord => ({
        id: row.id,
        teamId: row.team_id,
        createdAt: row.created_at,
        settings: {
          name: row.name,
          cadence: { _tag: "Weekly", day: row.weekday, time: row.send_time },
          answerWindowDays: row.answer_window_days,
          reviewWindowDays: row.review_window_days,
          reminders: row.reminders,
          anonymityMode: row.anonymity_mode,
          distribution: row.distribution,
        },
        questions: asked.filter((each) => each.pulse_id === row.id).map((each) => each.question_version_id),
      })),
      answered: [],
    } satisfies PulseState;
  }).pipe(Effect.orDie);

  const setQuestions = (pulseId: PulseId, questions: ReadonlyArray<QuestionVersionId>) =>
    Effect.andThen(
      sql`DELETE FROM pulse_question WHERE pulse_id = ${pulseId}`,
      Effect.forEach(
        questions,
        (versionId, position) =>
          sql`INSERT INTO pulse_question (pulse_id, position, question_version_id)
              VALUES (${pulseId}, ${position}, ${versionId})`,
        { discard: true },
      ),
    );

  const applyOne = (change: PulseChange): Effect.Effect<unknown, unknown> => {
    switch (change._tag) {
      case "PulseAdded": {
        const { pulse } = change;
        const { settings } = pulse;
        return Effect.andThen(
          sql`INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days,
                                 review_window_days, reminders, anonymity_mode, distribution, created_at)
              VALUES (${pulse.id}, ${pulse.teamId}, ${settings.name}, 'weekly', ${settings.cadence.day},
                      ${settings.cadence.time}, ${settings.answerWindowDays}, ${settings.reviewWindowDays},
                      ${settings.reminders}, ${settings.anonymityMode}, ${settings.distribution}, ${pulse.createdAt})`,
          setQuestions(pulse.id, pulse.questions),
        );
      }
      case "PulseSettingsUpdated": {
        const { settings } = change;
        return sql`UPDATE pulse
          SET name = ${settings.name}, cadence = 'weekly', weekday = ${settings.cadence.day},
              send_time = ${settings.cadence.time}, answer_window_days = ${settings.answerWindowDays},
              review_window_days = ${settings.reviewWindowDays}, reminders = ${settings.reminders}, anonymity_mode = ${settings.anonymityMode},
              distribution = ${settings.distribution}
          WHERE id = ${change.pulseId}`;
      }
      case "QuestionAdded": {
        const { question, version } = change;
        return Effect.gen(function* () {
          const type = yield* encodeType(version.content.type);
          yield* sql`INSERT INTO question (id, template_key, created_at)
            VALUES (${question.id}, ${question.templateKey}, ${question.createdAt})`;
          yield* sql`INSERT INTO question_version (id, question_id, number, text, dimension, type)
            VALUES (${version.id}, ${version.questionId}, ${version.number}, ${version.content.text},
                    ${version.content.dimension}, ${type})`;
        });
      }
      case "QuestionRewritten":
        return Effect.gen(function* () {
          const type = yield* encodeType(change.content.type);
          yield* sql`UPDATE question SET template_key = NULL WHERE id = ${change.questionId}`;
          yield* sql`UPDATE question_version
            SET text = ${change.content.text}, dimension = ${change.content.dimension}, type = ${type}
            WHERE id = ${change.versionId}`;
        });
      case "PulseQuestionsSet":
        return setQuestions(change.pulseId, change.questions);
    }
  };

  const apply = (changes: ReadonlyArray<PulseChange>): Effect.Effect<void> =>
    Effect.forEach(changes, applyOne, { discard: true }).pipe(Effect.orDie);

  return { load, apply };
};
