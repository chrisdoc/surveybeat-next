import { Schema } from "effect";
import { RoundId } from "../rounds/Round.ts";

export const NOTE_MAX_LENGTH = 2000;

export const NoteText = Schema.String.pipe(Schema.check(Schema.isMaxLength(NOTE_MAX_LENGTH)));
export type NoteText = typeof NoteText.Type;

export const RoundNote = Schema.Struct({
  roundId: RoundId,
  text: Schema.String,
  updatedAt: Schema.Int,
});
export type RoundNote = typeof RoundNote.Type;

export const RoundNoteView = Schema.Struct({
  roundId: RoundId,
  note: Schema.NullOr(RoundNote),
});
export type RoundNoteView = typeof RoundNoteView.Type;

export const SaveNote = Schema.Struct({
  text: NoteText,
});
export type SaveNote = typeof SaveNote.Type;

export type NoteChange = { readonly _tag: "Delete" } | { readonly _tag: "Upsert"; readonly text: string };

export const noteChange = (text: string): NoteChange => {
  const trimmed = text.trim();
  return trimmed === "" ? { _tag: "Delete" } : { _tag: "Upsert", text: trimmed };
};
