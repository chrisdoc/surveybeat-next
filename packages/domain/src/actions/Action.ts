import { Schema } from "effect";
import { EmailAddress } from "../email/Email.ts";
import { PersonId } from "../people/Identity.ts";
import { TeamId } from "../people/Team.ts";
import { Dimension } from "../pulses/Question.ts";
import { RoundId } from "../rounds/Round.ts";

/** An Action committed by a Team in response to a Result (GLOSSARY.md). */
export const ActionId = Schema.String.pipe(Schema.brand("ActionId"));
export type ActionId = typeof ActionId.Type;

/**
 * Statuses an Action can have.
 * Release 1 uses `committed`, `done`, and `dropped`. `proposed` is modelled but unused in R1.
 */
export const ActionStatus = Schema.Literals(["proposed", "committed", "done", "dropped"]);
export type ActionStatus = typeof ActionStatus.Type;

/** Internal stored Action record in the DO sqlite database. */
export const ActionRecord = Schema.Struct({
  id: ActionId,
  teamId: TeamId,
  roundId: RoundId,
  title: Schema.NonEmptyString,
  ownerId: PersonId,
  dueDate: Schema.NullOr(Schema.String),
  dimension: Schema.NullOr(Dimension),
  status: ActionStatus,
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
  doneAt: Schema.NullOr(Schema.Int),
});
export type ActionRecord = typeof ActionRecord.Type;

/** An Action as viewed by the team or API callers, including the owner's email address. */
export const ActionItem = Schema.Struct({
  id: ActionId,
  teamId: TeamId,
  roundId: RoundId,
  title: Schema.String,
  ownerId: PersonId,
  ownerEmail: EmailAddress,
  dueDate: Schema.NullOr(Schema.String),
  dimension: Schema.NullOr(Dimension),
  status: ActionStatus,
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
  doneAt: Schema.NullOr(Schema.Int),
});
export type ActionItem = typeof ActionItem.Type;

/** The list of Actions for a Team. Actions have no minimum group size. */
export const ActionList = Schema.Struct({
  teamId: TeamId,
  actions: Schema.Array(ActionItem),
});
export type ActionList = typeof ActionList.Type;

/** Payload to create an Action from a Result. */
export const CreateAction = Schema.Struct({
  roundId: RoundId,
  title: Schema.NonEmptyString,
  ownerId: PersonId,
  dueDate: Schema.NullOr(Schema.String),
  dimension: Schema.NullOr(Dimension),
});
export type CreateAction = typeof CreateAction.Type;

/** Payload to update an Action. */
export const UpdateAction = Schema.Struct({
  title: Schema.optional(Schema.NonEmptyString),
  ownerId: Schema.optional(PersonId),
  dueDate: Schema.optional(Schema.NullOr(Schema.String)),
  dimension: Schema.optional(Schema.NullOr(Dimension)),
  status: Schema.optional(ActionStatus),
});
export type UpdateAction = typeof UpdateAction.Type;

export class ActionNotFound extends Schema.TaggedError<ActionNotFound, { readonly brand: unique symbol }>()(
  "ActionNotFound",
  {},
  { httpApiStatus: 404 },
) {}

export class OwnerNotInTeam extends Schema.TaggedError<OwnerNotInTeam, { readonly brand: unique symbol }>()(
  "OwnerNotInTeam",
  {},
  { httpApiStatus: 400 },
) {}

export interface ActionSelectionInput {
  readonly id: ActionId | string;
  readonly title: string;
  readonly status: ActionStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly doneAt: number | null;
}

export interface PreviousRoundInfo {
  readonly openedAt: number | null;
  readonly plannedOpenAt: number;
}

/**
 * Selects up to three Actions to show on the next Invitation email and the thank-you screen:
 * those still committed, plus those marked done since the previous Round.
 * Excludes proposed and dropped actions.
 * Actions list has no minimum group size.
 */
export const selectActionsForRound = <A extends ActionSelectionInput>(
  actions: ReadonlyArray<A>,
  previousRound: PreviousRoundInfo | null,
): ReadonlyArray<A> => {
  const previousCutoff = previousRound ? (previousRound.openedAt ?? previousRound.plannedOpenAt) : 0;
  return actions
    .filter((action) => {
      if (action.status === "committed") return true;
      if (action.status === "done" && action.doneAt !== null) {
        return previousRound !== null ? action.doneAt >= previousCutoff : false;
      }
      return false;
    })
    .slice(0, 3);
};
