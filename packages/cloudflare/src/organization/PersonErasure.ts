import type { SqliteClient } from "@effect/sql-sqlite-do";
import { erasedEmailOf, SendId } from "@surveybeat/domain";
import type { PersonRef } from "@surveybeat/domain";
import * as Effect from "effect/Effect";

export interface ErasedRows {
  readonly sendIds: readonly SendId[];
  readonly testTokenHashes: readonly string[];
}

export const erasePersonRows = (
  sql: SqliteClient.SqliteClient,
  person: PersonRef,
): Effect.Effect<ErasedRows> =>
  Effect.gen(function* () {
    const testTokens = yield* sql<{ token_hash: string }>`
      SELECT token_hash FROM test_send WHERE person_id = ${person.id}`;

    const sends = yield* sql<{ id: string }>`SELECT id FROM email_send WHERE recipient = ${person.email}`;

    yield* sql`DELETE FROM participation WHERE person_id = ${person.id}`;
    yield* sql`DELETE FROM round_member WHERE person_id = ${person.id}`;
    yield* sql`DELETE FROM invitation WHERE person_id = ${person.id}`;
    yield* sql`DELETE FROM pulse_reminder_opt_out WHERE person_id = ${person.id}`;
    yield* sql`DELETE FROM test_send WHERE person_id = ${person.id}`;
    yield* sql`DELETE FROM email_outbox
      WHERE send_id IN (SELECT id FROM email_send WHERE recipient = ${person.email})`;
    yield* sql`DELETE FROM email_send WHERE recipient = ${person.email}`;
    yield* sql`UPDATE email_send SET content = json_set(content, '$.leadName', ${erasedEmailOf(person.id)})
      WHERE json_extract(content, '$._tag') = 'AddedToTeam'
        AND json_extract(content, '$.leadName') = ${person.email}`;

    return {
      sendIds: sends.map((row) => SendId.make(row.id)),
      testTokenHashes: testTokens.map((row) => row.token_hash),
    };
  }).pipe(Effect.orDie);
