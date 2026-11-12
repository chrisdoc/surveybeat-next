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

  /**
   * The state of a test send the actor made (ADR 0021), read from its test row and its email's state. A
   * send whose email row is missing is still queued: nothing has been recorded for it yet.
   */
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
  /**
   * The Organization's last 50 failed sends, newest first, for its admins (ADR 0006). Reads the kind, the
   * recipient, and the state's reason, code, and time, never `content` or `state` whole: a legacy row's
   * content may still hold a token. A row this build cannot read is skipped, not fatal.
   */
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

  /**
   * An admin's Resend of a failed send (ADR 0006), in one transaction: the send goes from failed to pending
   * under the same id and content, and a failed Invitation is cleared so the Lead's list stops showing it.
   * `queue` is set while the send still waits for its first attempt, so a repeated request (a double click)
   * may queue it twice but delivery sends it once. Nothing here reads a body or token, and nothing links a Submission to anyone.
   */
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
          // Already queued, sending, or sent: a repeated request (a double click) changes nothing. A send still
          // waiting for its first attempt is handed to the queue again, in case the earlier enqueue failed after
          // this object committed; delivery claims it once, so it is still sent once.
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

  /** One send's status for an admin, polled after a Resend. Only its state is returned, never its content. */
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

  /** Lead controls: skip, pause, resume, close early, cancel. Authorised through permission table. */
});

/**
 * What an admin's failed-sends list and Resend read about a send: its recipient and failure, and the facts that
 * decide whether it may be resent. Never `content` whole: a legacy row's content may still hold a token, so only
 * the stored email's kind, Invitation reference, and Invitation generation are read. The Invitation and test send
 * are joined on their keys only. Callers add a `WHERE` (and any order or limit) to it.
 */
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

/** One row of `SEND_FACTS_SQL`. The Invitation columns are null when the email names no Invitation row. */
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

/** The facts `isResendable` decides on, from one row of `SEND_FACTS_SQL` and the send's failure reason. */
const resendFactsOf = (row: SendFactsRow, reason: FailureReason): ResendFacts => ({
  kind: row.kind,
  reason,
  generation: row.generation,
  invitation: invitationOf(row),
  testSend: row.test_send === 1,
});

/** A test send's row: whose it is, and which Pulse it tests. */
const TestSendRow = Schema.Struct({ person_id: PersonId, pulse_id: PulseId, sent_at: Schema.Int });
