import type { SqliteClient } from "@effect/sql-sqlite-do";
import { isoTimestamp, OrganizationId } from "@surveybeat/domain";
import type { OrganizationPersonalData } from "@surveybeat/domain";
import * as Effect from "effect/Effect";

interface PersonRow {
  readonly id: string;
  readonly email: string;
  readonly time_zone: string | null;
  readonly locale: string | null;
  readonly detected_locale: string | null;
  readonly organization_admin: number;
  readonly removed_at: number | null;
}

export const organizationPersonalData = (sql: SqliteClient.SqliteClient) => ({
  exportPersonalData: (authUserId: string): Effect.Effect<OrganizationPersonalData | null> =>
    Effect.gen(function* () {
      const people = yield* sql<PersonRow>`
        SELECT id, email, time_zone, locale, detected_locale, organization_admin, removed_at
          FROM person WHERE auth_user_id = ${authUserId}`;

      const person = people[0];

      if (person === undefined) {
        return null;
      }

      const organizations = yield* sql<{ id: string; name: string }>`
        SELECT id, name FROM organization LIMIT 1`;

      const memberships = yield* sql<{
        id: string;
        team_id: string;
        team_name: string;
        role: string;
        started_at: number;
        ended_at: number | null;
      }>`
        SELECT membership.id, membership.team_id, team.name AS team_name, membership.role,
               membership.started_at, membership.ended_at
          FROM membership JOIN team ON team.id = membership.team_id
         WHERE membership.person_id = ${person.id}
         ORDER BY membership.started_at, membership.id`;

      const participation = yield* sql<{ round_id: string; planned_open_date: string; pulse_name: string }>`
        SELECT round.id AS round_id, round.planned_open_date, round.pulse_name
          FROM participation JOIN round ON round.id = participation.round_id
         WHERE participation.person_id = ${person.id}
         ORDER BY round.planned_open_date, round.id`;

      const roundMembers = yield* sql<{
        round_id: string;
        planned_open_date: string;
        pulse_name: string;
        send_at: number;
        time_zone: string;
      }>`
        SELECT round.id AS round_id, round.planned_open_date, round.pulse_name,
               round_member.send_at, round_member.time_zone
          FROM round_member JOIN round ON round.id = round_member.round_id
         WHERE round_member.person_id = ${person.id}
         ORDER BY round.planned_open_date, round.id`;

      const invitations = yield* sql<{
        round_id: string;
        planned_open_date: string;
        pulse_name: string;
        status: string;
        resend_count: number;
        created_at: number;
        updated_at: number;
      }>`
        SELECT round.id AS round_id, round.planned_open_date, round.pulse_name,
               invitation.status, invitation.resend_count, invitation.created_at, invitation.updated_at
          FROM invitation JOIN round ON round.id = invitation.round_id
         WHERE invitation.person_id = ${person.id}
         ORDER BY round.planned_open_date, round.id`;

      const reminderOptOuts = yield* sql<{ pulse_id: string; pulse_name: string; opted_out_at: number }>`
        SELECT pulse.id AS pulse_id, pulse.name AS pulse_name, pulse_reminder_opt_out.opted_out_at
          FROM pulse_reminder_opt_out JOIN pulse ON pulse.id = pulse_reminder_opt_out.pulse_id
         WHERE pulse_reminder_opt_out.person_id = ${person.id}
         ORDER BY pulse.id`;

      const actions = yield* sql<{
        id: string;
        team_id: string;
        round_id: string;
        title: string;
        due_date: string | null;
        dimension: string | null;
        status: string;
        created_at: number;
        updated_at: number;
        done_at: number | null;
      }>`
        SELECT id, team_id, round_id, title, due_date, dimension, status, created_at, updated_at, done_at
          FROM action WHERE owner_id = ${person.id} ORDER BY created_at, id`;

      const emailSends = yield* sql<{
        id: string;
        kind: string | null;
        status: string;
        sent_at: number | null;
        failed_at: number | null;
      }>`
        SELECT id, json_extract(content, '$._tag') AS kind, status,
               json_extract(state, '$.sentAt') AS sent_at, json_extract(state, '$.failedAt') AS failed_at
          FROM email_send WHERE recipient = ${person.email} ORDER BY id`;

      const testSends = yield* sql<{
        send_id: string;
        pulse_id: string;
        pulse_name: string | null;
        sent_at: number;
      }>`
        SELECT test_send.send_id, test_send.pulse_id, pulse.name AS pulse_name, test_send.sent_at
          FROM test_send LEFT JOIN pulse ON pulse.id = test_send.pulse_id
         WHERE test_send.person_id = ${person.id} ORDER BY test_send.sent_at, test_send.send_id`;

      const organization = organizations[0];

      return {
        organization: {
          id: OrganizationId.make(organization?.id ?? ""),
          name: organization?.name ?? "",
        },
        person: {
          id: person.id,
          email: person.email,
          timeZone: person.time_zone,
          locale: person.locale,
          detectedLocale: person.detected_locale,
          organizationAdmin: person.organization_admin === 1,
          removedAt: isoTimestamp(person.removed_at),
        },
        memberships: memberships.map((row) => ({
          id: row.id,
          teamId: row.team_id,
          teamName: row.team_name,
          role: row.role,
          startedAt: isoTimestamp(row.started_at),
          endedAt: isoTimestamp(row.ended_at),
        })),
        participation: participation.map((row) => ({
          roundId: row.round_id,
          plannedOpenDate: row.planned_open_date,
          pulseName: row.pulse_name,
          participated: true as const,
        })),
        roundMembers: roundMembers.map((row) => ({
          roundId: row.round_id,
          plannedOpenDate: row.planned_open_date,
          pulseName: row.pulse_name,
          sendAt: isoTimestamp(row.send_at),
          timeZone: row.time_zone,
        })),
        invitations: invitations.map((row) => ({
          roundId: row.round_id,
          plannedOpenDate: row.planned_open_date,
          pulseName: row.pulse_name,
          status: row.status,
          resendCount: row.resend_count,
          createdAt: isoTimestamp(row.created_at),
          updatedAt: isoTimestamp(row.updated_at),
        })),
        reminderOptOuts: reminderOptOuts.map((row) => ({
          pulseId: row.pulse_id,
          pulseName: row.pulse_name,
          optedOutAt: isoTimestamp(row.opted_out_at),
        })),
        actions: actions.map((row) => ({
          id: row.id,
          teamId: row.team_id,
          roundId: row.round_id,
          title: row.title,
          dueDate: row.due_date,
          dimension: row.dimension,
          status: row.status,
          createdAt: isoTimestamp(row.created_at),
          updatedAt: isoTimestamp(row.updated_at),
          doneAt: isoTimestamp(row.done_at),
        })),
        emailSends: emailSends.map((row) => ({
          id: row.id,
          kind: row.kind ?? "unknown",
          status: row.status,
          sentAt: isoTimestamp(row.sent_at),
          failedAt: isoTimestamp(row.failed_at),
        })),
        testSends: testSends.map((row) => ({
          id: row.send_id,
          pulseId: row.pulse_id,
          pulseName: row.pulse_name,
          sentAt: isoTimestamp(row.sent_at),
        })),
      } satisfies OrganizationPersonalData;
    }).pipe(Effect.orDie),
});
