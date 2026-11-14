import { Schema } from "effect";
import { EmailAddress } from "../email/Email.ts";
import { PersonId } from "../people/Identity.ts";
import { TeamId } from "../people/Team.ts";
import { Dimension } from "../pulses/Question.ts";
import { RoundId } from "../rounds/Round.ts";

export const ActionId = Schema.String.pipe(Schema.brand("ActionId"));
export type ActionId = typeof ActionId.Type;

export const ActionStatus = Schema.Literals(["proposed", "committed", "done", "dropped"]);
export type ActionStatus = typeof ActionStatus.Type;

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

export const ActionList = Schema.Struct({
  teamId: TeamId,
  actions: Schema.Array(ActionItem),
});
export type ActionList = typeof ActionList.Type;

export const CreateAction = Schema.Struct({
  roundId: RoundId,
  title: Schema.NonEmptyString,
  ownerId: PersonId,
  dueDate: Schema.NullOr(Schema.String),
  dimension: Schema.NullOr(Dimension),
});
export type CreateAction = typeof CreateAction.Type;

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
