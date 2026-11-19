import { Schema } from "effect";
import type { MembershipRecord } from "../people/Directory.ts";
import type { PersonId } from "../people/Identity.ts";
import type { TeamId } from "../people/Team.ts";

export const InvitationSummary = Schema.Struct({
  invited: Schema.Int,
  joinedAfterOpen: Schema.Int,
});

export type InvitationSummary = typeof InvitationSummary.Type;

export interface InvitationSummaryRound {
  readonly teamId: TeamId;
  readonly openedAt: number | null;
  readonly closedAt: number | null;
  readonly plannedCloseAt: number;
}

export interface InvitationSummaryInput {
  readonly round: InvitationSummaryRound;
  readonly invitedPersonIds: ReadonlySet<PersonId>;
  readonly memberships: readonly MembershipRecord[];
}

export const invitationSummaryOf = ({
  round,
  invitedPersonIds,
  memberships,
}: InvitationSummaryInput): InvitationSummary | null => {
  if (round.openedAt === null) {
    return null;
  }

  const openedAt = round.openedAt;
  const windowEnd = round.closedAt ?? round.plannedCloseAt;
  const joinedAfterOpen = new Set<PersonId>();

  for (const membership of memberships) {
    if (membership.teamId !== round.teamId) {
      continue;
    }

    if (membership.role !== "lead" && membership.role !== "member") {
      continue;
    }

    if (membership.startedAt <= openedAt || membership.startedAt > windowEnd) {
      continue;
    }

    if (membership.endedAt !== null && membership.endedAt <= windowEnd) {
      continue;
    }

    if (invitedPersonIds.has(membership.personId)) {
      continue;
    }

    joinedAfterOpen.add(membership.personId);
  }

  return { invited: invitedPersonIds.size, joinedAfterOpen: joinedAfterOpen.size };
};
