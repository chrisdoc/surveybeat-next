import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  authorizeRoundAction,
  noteChange,
  type NoteViewed,
  PersonId,
  RoundId,
  type RoundNoteView,
  TeamId,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import type { makeSqlDirectory } from "../SqlDirectory.ts";
import type { makeSqlNotes } from "../SqlNotes.ts";
import type { makeSqlRounds } from "../SqlRounds.ts";

export const organizationNotes = ({
  notes,
  rounds,
  directory,
  sql,
}: {
  notes: ReturnType<typeof makeSqlNotes>;
  rounds: ReturnType<typeof makeSqlRounds>;
  directory: ReturnType<typeof makeSqlDirectory>;
  sql: SqliteClient.SqliteClient;
}) => ({
  viewRoundNote: (
    actorId: PersonId,
    teamId: TeamId,
    roundId: RoundId,
  ): Effect.Effect<NoteViewed<RoundNoteView>, never, never> =>
    Effect.gen(function* () {
      const dirState = yield* directory.load;
      const auth = authorizeRoundAction(dirState, actorId, "team.viewNote", teamId);
      if (auth._tag === "Rejected") {
        const rejected: NoteViewed<RoundNoteView> = {
          _tag: "Rejected",
          rejection: { _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden" },
        };
        return rejected;
      }
      const round = yield* rounds.getRound(roundId);
      if (round === null || round.teamId !== teamId) {
        const rejected: NoteViewed<RoundNoteView> = {
          _tag: "Rejected",
          rejection: { _tag: "RoundNotFound" },
        };
        return rejected;
      }
      const isLead = auth.actor.roles.get(teamId) === "lead";
      const note = isLead || round.status === "shared" ? yield* notes.getNote(roundId) : null;
      const viewed: NoteViewed<RoundNoteView> = { _tag: "Viewed", value: { roundId, note } };
      return viewed;
    }).pipe(Effect.orDie),

  saveRoundNote: (
    actorId: PersonId,
    teamId: TeamId,
    roundId: RoundId,
    text: string,
    now: number,
  ): Effect.Effect<NoteViewed<RoundNoteView>, never, never> =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const dirState = yield* directory.load;
          const auth = authorizeRoundAction(dirState, actorId, "team.writeNote", teamId);
          if (auth._tag === "Rejected") {
            const rejected: NoteViewed<RoundNoteView> = {
              _tag: "Rejected",
              rejection: {
                _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden",
              },
            };
            return rejected;
          }
          const round = yield* rounds.getRound(roundId);
          if (round === null || round.teamId !== teamId) {
            const rejected: NoteViewed<RoundNoteView> = {
              _tag: "Rejected",
              rejection: { _tag: "RoundNotFound" },
            };
            return rejected;
          }
          const change = noteChange(text);
          if (change._tag === "Delete") {
            yield* notes.deleteNote(roundId);
          } else {
            yield* notes.upsertNote({ roundId, teamId, text: change.text, updatedAt: now });
          }
          const note = yield* notes.getNote(roundId);
          const viewed: NoteViewed<RoundNoteView> = { _tag: "Viewed", value: { roundId, note } };
          return viewed;
        }),
      )
      .pipe(Effect.orDie),
});
