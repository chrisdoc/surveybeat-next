import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  EmailAddress,
  SendId,
  type SendRecord,
  type SendRepository,
  SendState,
  TransactionalEmail,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const StateJson = Schema.fromJsonString(SendState);
const ContentJson = Schema.fromJsonString(TransactionalEmail);

const Row = Schema.Struct({
  id: SendId,
  recipient: EmailAddress,
  content: ContentJson,
  state: StateJson,
});

const decodeRow = Schema.decodeUnknownEffect(Row);
const encodeState = Schema.encodeEffect(StateJson);
const encodeContent = Schema.encodeEffect(ContentJson);

/**
 * The `email_send` table of the Organization Durable Object. Rows hold only what the domain's
 * `SendStore` decides; every transition is in `@surveybeat/domain`. A corrupt row is a defect.
 */
export const makeSqlSendRepository = (sql: SqliteClient.SqliteClient): SendRepository => ({
  get: (id) =>
    sql`SELECT id, recipient, content, state FROM email_send WHERE id = ${id}`.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed(Option.none<SendRecord>())
          : decodeRow(rows[0]).pipe(
              Effect.map((row): Option.Option<SendRecord> =>
                Option.some({ id: row.id, recipient: row.recipient, email: row.content, state: row.state }),
              ),
            ),
      ),
      Effect.orDie,
    ),

  insert: (record) =>
    Effect.gen(function* () {
      const content = yield* encodeContent(record.email);
      const state = yield* encodeState(record.state);
      yield* sql`INSERT INTO email_send (id, recipient, content, status, state)
        VALUES (${record.id}, ${record.recipient}, ${content}, ${record.state._tag}, ${state})
        ON CONFLICT (id) DO NOTHING`;
    }).pipe(Effect.orDie),

  setState: (id, state) =>
    encodeState(state).pipe(
      Effect.flatMap(
        (json) => sql`UPDATE email_send SET status = ${state._tag}, state = ${json} WHERE id = ${id}`,
      ),
      Effect.asVoid,
      Effect.orDie,
    ),

  transaction: (effect) => sql.withTransaction(effect).pipe(Effect.orDie),
});
