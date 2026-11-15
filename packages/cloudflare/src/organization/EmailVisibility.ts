import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  emailStatusView,
  FailedEmail,
  failedEmailsView,
  FailureReason,
  type InvitationFacts,
  isEmailAdmin,
  isResendable,
  makeSendStore,
  pending,
  PersonId,
  progressOf,
  PulseId,
  type ResendFacts,
  type ResendResult,
  RoundId,
  SendId,
  TeamId,
  type TestSendFound,
  testSendView,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { makeSqlDirectory } from "../SqlDirectory.ts";
import type { makeSqlRounds } from "../SqlRounds.ts";

export const organizationEmailVisibility = ({
  sql,
  sends,
  rounds,
  directory,
}: {
  sql: SqliteClient.SqliteClient;
  sends: ReturnType<typeof makeSendStore>;
  rounds: ReturnType<typeof makeSqlRounds>;
  directory: ReturnType<typeof makeSqlDirectory>;
}) => ({
  getTestSendBySendId: (sendId: string) =>
    sql<{ token_hash: string; pulse_id: string; sent_at: number }>`
      SELECT token_hash, pulse_id, sent_at FROM test_send WHERE send_id = ${sendId}`.pipe(
      Effect.map((rows) => {
        const row = rows[0];
        return row === undefined
          ? null
          : { tokenHash: row.token_hash, pulseId: row.pulse_id, sentAt: row.sent_at };
      }),
      Effect.orDie,
    ),

  viewTestSend: (actorId: PersonId, teamId: TeamId, pulseId: PulseId, sendId: SendId, now: number) =>
    Effect.gen(function* () {
      const dirState = yield* directory.load;
      const rows =
        yield* sql`SELECT person_id, pulse_id, sent_at FROM test_send WHERE send_id = ${sendId}`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(TestSendRow))),
          Effect.orDie,
        );
      const row = rows[0];
      const record = yield* sends.get(sendId);
      const found: TestSendFound | null =
        row === undefined
          ? null
          : {
              personId: row.person_id,
              pulseId: row.pulse_id,
              sentAt: row.sent_at,
              state: Option.match(record, {
                onNone: () => pending,
                onSome: (each) => each.state,
              }),
            };
      return testSendView(dirState, actorId, teamId, pulseId, found, now);
    }),
  listFailedEmails: (actorId: PersonId) =>
    Effect.gen(function* () {
      const dirState = yield* directory.load;
      const rows = yield* sql
        .unsafe<SendFactsRow>(
          `${SEND_FACTS_SQL} WHERE es.status = 'Failed' ORDER BY failed_at DESC, es.id DESC LIMIT 50`,
        )
        .pipe(Effect.orDie);
      const failed = rows.flatMap((row) => {
        const reason = decodeFailureReason(row.reason);
        const resendable =
          Option.isSome(reason) && isResendable(SendId.make(row.id), resendFactsOf(row, reason.value));
        const decoded = Schema.decodeUnknownOption(FailedEmail)({
          sendId: row.id,
          kind: row.kind,
          recipient: row.recipient,
          reason: row.reason,
          code: row.code,
          failedAt: row.failed_at,
          resendable,
        });
        return Option.isSome(decoded) ? [decoded.value] : [];
      });
      return failedEmailsView(dirState, actorId, failed);
    }),

  resendFailedEmail: (actorId: PersonId, sendId: SendId, now: number) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const dirState = yield* directory.load;
          if (!isEmailAdmin(dirState, actorId))
            return { _tag: "Rejected", rejection: { _tag: "Forbidden" } } satisfies ResendResult;
          const record = yield* sends.get(sendId);
          if (Option.isNone(record))
            return {
              _tag: "Rejected",
              rejection: { _tag: "FailedEmailNotFound" },
            } satisfies ResendResult;
          const { state } = record.value;
          if (state._tag !== "Failed")
            return {
              _tag: "Accepted",
              status: { sendId, state: progressOf(state) },
              queue: state._tag === "Pending" && state.attempts === 0,
            } satisfies ResendResult;
          const rows = yield* sql
            .unsafe<SendFactsRow>(`${SEND_FACTS_SQL} WHERE es.id = ?`, [sendId])
            .pipe(Effect.orDie);
          const row = rows[0];
          if (row === undefined)
            return {
              _tag: "Rejected",
              rejection: { _tag: "EmailNotResendable" },
            } satisfies ResendResult;
          const facts = resendFactsOf(row, state.reason);
          if (!isResendable(sendId, facts))
            return {
              _tag: "Rejected",
              rejection: { _tag: "EmailNotResendable" },
            } satisfies ResendResult;

          yield* sends.requeue(sendId);
          const invitation = invitationOf(row);
          if (
            facts.kind === "InvitationEmail" &&
            invitation !== null &&
            invitation.sendId === sendId &&
            invitation.status === "failed"
          ) {
            yield* rounds.updateInvitationStatus(
              RoundId.make(invitation.roundId),
              PersonId.make(invitation.personId),
              "pending",
              null,
              now,
            );
          }
          return {
            _tag: "Accepted",
            status: { sendId, state: progressOf(pending) },
            queue: true,
          } satisfies ResendResult;
        }),
      )
      .pipe(Effect.orDie),

  viewEmailStatus: (actorId: PersonId, sendId: SendId) =>
    Effect.gen(function* () {
      const dirState = yield* directory.load;
      const record = yield* sends.get(sendId);
      const status = Option.match(record, {
        onNone: () => null,
        onSome: (each) => ({ sendId, state: progressOf(each.state) }),
      });
      return emailStatusView(dirState, actorId, status);
    }),
});

const SEND_FACTS_SQL = `SELECT es.id, es.recipient, json_extract(es.content, '$._tag') AS kind,
    json_extract(es.state, '$.reason') AS reason, json_extract(es.state, '$.code') AS code,
    json_extract(es.state, '$.failedAt') AS failed_at,
    json_extract(es.content, '$.invitation.generation') AS generation,
    i.round_id AS invitation_round_id, i.person_id AS invitation_person_id, i.status AS invitation_status,
    i.resend_count AS invitation_resend_count, i.send_id AS invitation_send_id,
    EXISTS (SELECT 1 FROM test_send ts WHERE ts.send_id = es.id) AS test_send
  FROM email_send es
  LEFT JOIN invitation i ON i.round_id = json_extract(es.content, '$.invitation.roundId')
    AND i.person_id = json_extract(es.content, '$.invitation.personId')`;

interface SendFactsRow {
  readonly id: string;
  readonly recipient: string;
  readonly kind: string | null;
  readonly reason: string | null;
  readonly code: string | null;
  readonly failed_at: number | null;
  readonly generation: number | null;
  readonly invitation_round_id: string | null;
  readonly invitation_person_id: string | null;
  readonly invitation_status: string | null;
  readonly invitation_resend_count: number | null;
  readonly invitation_send_id: string | null;
  readonly test_send: number;
}

const decodeFailureReason = Schema.decodeUnknownOption(FailureReason);

const invitationOf = (row: SendFactsRow): InvitationFacts | null =>
  row.invitation_round_id === null ||
  row.invitation_person_id === null ||
  row.invitation_status === null ||
  row.invitation_resend_count === null ||
  row.invitation_send_id === null
    ? null
    : {
        roundId: row.invitation_round_id,
        personId: row.invitation_person_id,
        status: row.invitation_status,
        resendCount: row.invitation_resend_count,
        sendId: row.invitation_send_id,
      };

const resendFactsOf = (row: SendFactsRow, reason: FailureReason): ResendFacts => ({
  kind: row.kind,
  reason,
  generation: row.generation,
  invitation: invitationOf(row),
  testSend: row.test_send === 1,
});

const TestSendRow = Schema.Struct({ person_id: PersonId, pulse_id: PulseId, sent_at: Schema.Int });
