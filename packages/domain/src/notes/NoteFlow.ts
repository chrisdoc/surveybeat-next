import { Clock, Context, Effect } from "effect";
import type { PersonId } from "../people/Identity.ts";
import type { OrganizationId } from "../people/Organization.ts";
import { Forbidden } from "../people/SignIn.ts";
import type { Member } from "../people/SignInFlow.ts";
import { type TeamId, TeamNotFound } from "../people/Team.ts";
import { RoundNotFound, type RoundId } from "../rounds/Round.ts";
import { type RoundNoteView, type SaveNote } from "./Note.ts";

export type NoteRejection =
  | { readonly _tag: "Forbidden" }
  | { readonly _tag: "TeamNotFound" }
  | { readonly _tag: "RoundNotFound" };

export type NoteViewed<A> =
  | { readonly _tag: "Viewed"; readonly value: A }
  | { readonly _tag: "Rejected"; readonly rejection: NoteRejection };

export interface OrganizationNotesShape {
  readonly get: (
    organizationId: OrganizationId,
    actorId: PersonId,
    teamId: TeamId,
    roundId: RoundId,
  ) => Effect.Effect<NoteViewed<RoundNoteView>>;
  readonly save: (
    organizationId: OrganizationId,
    actorId: PersonId,
    teamId: TeamId,
    roundId: RoundId,
    text: string,
    now: number,
  ) => Effect.Effect<NoteViewed<RoundNoteView>>;
}

export class OrganizationNotes extends Context.Service<OrganizationNotes, OrganizationNotesShape>()(
  "@surveybeat/domain/OrganizationNotes",
) {}

export type NoteError = Forbidden | TeamNotFound | RoundNotFound;

const mapRejection = (rejection: NoteRejection): NoteError => {
  switch (rejection._tag) {
    case "Forbidden":
      return new Forbidden();
    case "TeamNotFound":
      return new TeamNotFound();
    case "RoundNotFound":
      return new RoundNotFound();
  }
};

const unwrap = <A>(result: NoteViewed<A>): Effect.Effect<A, NoteError> =>
  result._tag === "Viewed" ? Effect.succeed(result.value) : Effect.fail(mapRejection(result.rejection));

export const getRoundNote = (
  member: Member,
  teamId: TeamId,
  roundId: RoundId,
): Effect.Effect<RoundNoteView, NoteError, OrganizationNotes> =>
  Effect.gen(function* () {
    const notes = yield* OrganizationNotes;
    const result = yield* notes.get(member.organization.id, member.personId, teamId, roundId);
    return yield* unwrap(result);
  });

/**
 * Writes the Lead's Note. The Note is not run through Redaction (ADR 0009): the Lead writes it
 * under their own name, so it is not a Comment.
 */
export const saveRoundNote = (
  member: Member,
  teamId: TeamId,
  roundId: RoundId,
  payload: SaveNote,
): Effect.Effect<RoundNoteView, NoteError, OrganizationNotes> =>
  Effect.gen(function* () {
    const notes = yield* OrganizationNotes;
    const now = yield* Clock.currentTimeMillis;
    const result = yield* notes.save(
      member.organization.id,
      member.personId,
      teamId,
      roundId,
      payload.text,
      now,
    );
    return yield* unwrap(result);
  });
