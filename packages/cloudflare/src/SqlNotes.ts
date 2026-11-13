import type { SqliteClient } from "@effect/sql-sqlite-do";
import { type RoundNote, RoundId, TeamId } from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const NoteRow = Schema.Struct({
  round_id: RoundId,
  text: Schema.String,
  updated_at: Schema.Int,
});

const decodeNote = (row: typeof NoteRow.Type): RoundNote => ({
  roundId: row.round_id,
  text: row.text,
  updatedAt: row.updated_at,
});

/** The Lead's Note on a Round (`migrations/0014_round_notes.sql`): one row per Round, at most. */
export const makeSqlNotes = (sql: SqliteClient.SqliteClient) => {
  const getNote = (roundId: RoundId): Effect.Effect<RoundNote | null> =>
    sql`SELECT round_id, text, updated_at FROM round_note WHERE round_id = ${roundId}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(NoteRow))),
      Effect.map((rows) => (rows[0] ? decodeNote(rows[0]) : null)),
      Effect.orDie,
    );

  const upsertNote = (note: {
    readonly roundId: RoundId;
    readonly teamId: TeamId;
    readonly text: string;
    readonly updatedAt: number;
  }): Effect.Effect<void> =>
    sql`INSERT INTO round_note (round_id, team_id, text, updated_at)
        VALUES (${note.roundId}, ${note.teamId}, ${note.text}, ${note.updatedAt})
        ON CONFLICT (round_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`.pipe(
      Effect.asVoid,
      Effect.orDie,
    );

  const deleteNote = (roundId: RoundId): Effect.Effect<void> =>
    sql`DELETE FROM round_note WHERE round_id = ${roundId}`.pipe(Effect.asVoid, Effect.orDie);

  return { getNote, upsertNote, deleteNote };
};

export type SqlNotes = ReturnType<typeof makeSqlNotes>;
