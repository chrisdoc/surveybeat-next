import { Schema } from "effect";
import { RoundId } from "../rounds/Round.ts";

/** The longest a Note can be, in characters, before trimming. */
export const NOTE_MAX_LENGTH = 2000;

/**
 * The text the Lead submits. Not trimmed here: `noteChange` decides what to store, and a
 * whitespace-only text is a valid request that deletes the Note.
 */
export const NoteText = Schema.String.pipe(Schema.check(Schema.isMaxLength(NOTE_MAX_LENGTH)));
export type NoteText = typeof NoteText.Type;

/** The Lead's Note on one Round, as stored. */
export const RoundNote = Schema.Struct({
  roundId: RoundId,
  text: Schema.String,
  updatedAt: Schema.Int,
});
export type RoundNote = typeof RoundNote.Type;

/** A Round's Note as a Team member sees it: `null` when the Lead has written none (or cleared it). */
export const RoundNoteView = Schema.Struct({
  roundId: RoundId,
  note: Schema.NullOr(RoundNote),
});
export type RoundNoteView = typeof RoundNoteView.Type;

/** Payload to write the Lead's Note on a Round. */
export const SaveNote = Schema.Struct({
  text: NoteText,
});
export type SaveNote = typeof SaveNote.Type;

/** What saving `text` does: store the trimmed text, or delete the Note when nothing is left after trimming. */
export type NoteChange = { readonly _tag: "Delete" } | { readonly _tag: "Upsert"; readonly text: string };

export const noteChange = (text: string): NoteChange => {
  const trimmed = text.trim();
  return trimmed === "" ? { _tag: "Delete" } : { _tag: "Upsert", text: trimmed };
};
