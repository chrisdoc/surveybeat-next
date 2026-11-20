import type { SqliteClient } from "@effect/sql-sqlite-do";
import { AuthUserId, EmailAddress, erasedEmailOf, SendId } from "@surveybeat/domain";
import type { PersonRef } from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export interface ErasedRows {
  readonly person: PersonRef;
  readonly sendIds: readonly SendId[];
  readonly testTokenHashes: readonly string[];
}

const StoredErasure = Schema.Struct({
  email: EmailAddress,
  auth_user_id: Schema.NullOr(AuthUserId),
  send_ids: Schema.String,
  test_token_hashes: Schema.String,
});

const readSendIds = (text: string) =>
  Effect.try((): unknown => JSON.parse(text)).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SendId))),
    Effect.orDie,
  );

const readHashes = (text: string) =>
  Effect.try((): unknown => JSON.parse(text)).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.String))),
    Effect.orDie,
  );

export const erasePersonRows = (
  sql: SqliteClient.SqliteClient,
  person: PersonRef,
): Effect.Effect<ErasedRows> =>
  Effect.gen(function* () {
    const storedRows = yield* sql`SELECT email, auth_user_id, send_ids, test_token_hashes
      FROM person_erasure WHERE person_id = ${person.id}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredErasure))),
    );

    const stored = storedRows[0];

    if (stored !== undefined) {
      return {
        person: { id: person.id, email: stored.email, authUserId: stored.auth_user_id },
        sendIds: yield* readSendIds(stored.send_ids),
        testTokenHashes: yield* readHashes(stored.test_token_hashes),
      };
    }

    const testTokens = yield* sql<{ token_hash: string }>`
      SELECT token_hash FROM test_send WHERE person_id = ${person.id} ORDER BY token_hash`;

    const sends = yield* sql<{ id: string }>`
      SELECT id FROM email_send WHERE recipient = ${person.email} ORDER BY id`;

    const sendIds = sends.map((row) => SendId.make(row.id));

    const testTokenHashes = testTokens.map((row) => row.token_hash);

    yield* sql`INSERT INTO person_erasure (person_id, email, auth_user_id, send_ids, test_token_hashes)
      VALUES (${person.id}, ${person.email}, ${person.authUserId}, ${JSON.stringify(sendIds)},
              ${JSON.stringify(testTokenHashes)})`;
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

    return { person, sendIds, testTokenHashes };
  }).pipe(Effect.orDie);
