import { Clock, Context, Effect } from "effect";
import type { PersonId } from "../people/Identity.ts";
import type { OrganizationId } from "../people/Organization.ts";
import { Forbidden } from "../people/SignIn.ts";
import type { Member } from "../people/SignInFlow.ts";
import { PersonNotFound, type TeamId, TeamNotFound } from "../people/Team.ts";
import { RoundNotFound } from "../rounds/Round.ts";
import {
  type ActionId,
  type ActionItem,
  type ActionList,
  ActionNotFound,
  type CreateAction,
  OwnerNotInTeam,
  type UpdateAction,
} from "./Action.ts";

export type ActionRejection =
  | { readonly _tag: "Forbidden" }
  | { readonly _tag: "TeamNotFound" }
  | { readonly _tag: "RoundNotFound" }
  | { readonly _tag: "ActionNotFound" }
  | { readonly _tag: "OwnerNotInTeam" }
  | { readonly _tag: "PersonNotFound" };

export type ActionViewed<A> =
  | { readonly _tag: "Viewed"; readonly value: A }
  | { readonly _tag: "Rejected"; readonly rejection: ActionRejection };

export interface OrganizationActionsShape {
  readonly list: (
    organizationId: OrganizationId,
    actorId: PersonId,
    teamId: TeamId,
  ) => Effect.Effect<ActionViewed<ActionList>>;
  readonly create: (
    organizationId: OrganizationId,
    actorId: PersonId,
    teamId: TeamId,
    payload: CreateAction,
    now: number,
  ) => Effect.Effect<ActionViewed<ActionItem>>;
  readonly update: (
    organizationId: OrganizationId,
    actorId: PersonId,
    teamId: TeamId,
    actionId: ActionId,
    payload: UpdateAction,
    now: number,
  ) => Effect.Effect<ActionViewed<ActionItem>>;
}

export class OrganizationActions extends Context.Service<OrganizationActions, OrganizationActionsShape>()(
  "@surveybeat/domain/OrganizationActions",
) {}

export type ActionError =
  | Forbidden
  | TeamNotFound
  | RoundNotFound
  | ActionNotFound
  | OwnerNotInTeam
  | PersonNotFound;

const mapRejection = (rejection: ActionRejection): ActionError => {
  switch (rejection._tag) {
    case "Forbidden":
      return new Forbidden();
    case "TeamNotFound":
      return new TeamNotFound();
    case "RoundNotFound":
      return new RoundNotFound();
    case "ActionNotFound":
      return new ActionNotFound();
    case "OwnerNotInTeam":
      return new OwnerNotInTeam();
    case "PersonNotFound":
      return new PersonNotFound();
  }
};

const unwrap = <A>(result: ActionViewed<A>): Effect.Effect<A, ActionError> =>
  result._tag === "Viewed" ? Effect.succeed(result.value) : Effect.fail(mapRejection(result.rejection));

export const listActions = (
  member: Member,
  teamId: TeamId,
): Effect.Effect<ActionList, ActionError, OrganizationActions> =>
  Effect.flatMap(OrganizationActions, (actions) =>
    actions.list(member.organization.id, member.personId, teamId).pipe(Effect.flatMap(unwrap)),
  );

export const createAction = (
  member: Member,
  teamId: TeamId,
  payload: CreateAction,
): Effect.Effect<ActionItem, ActionError, OrganizationActions> =>
  Effect.gen(function* () {
    const actions = yield* OrganizationActions;
    const now = yield* Clock.currentTimeMillis;
    const result = yield* actions.create(member.organization.id, member.personId, teamId, payload, now);
    return yield* unwrap(result);
  });

export const updateAction = (
  member: Member,
  teamId: TeamId,
  actionId: ActionId,
  payload: UpdateAction,
): Effect.Effect<ActionItem, ActionError, OrganizationActions> =>
  Effect.gen(function* () {
    const actions = yield* OrganizationActions;
    const now = yield* Clock.currentTimeMillis;
    const result = yield* actions.update(
      member.organization.id,
      member.personId,
      teamId,
      actionId,
      payload,
      now,
    );
    return yield* unwrap(result);
  });
