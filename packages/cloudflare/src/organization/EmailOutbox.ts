import type * as Cloudflare from "@alchemy.run/cloudflare";
import type { SqliteClient } from "@effect/sql-sqlite-do";
import { OrganizationId, SendId } from "@surveybeat/domain";
import type { SendStoreShape } from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { EmailSendRequested } from "../Email.ts";

const QUEUE_BATCH_LIMIT = 100;

const OutboxRow = Schema.Struct({ id: Schema.Int, send_id: SendId });
const decodeOutboxRows = Schema.decodeUnknownEffect(Schema.Array(OutboxRow));
const decodeOrganizationRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ id: OrganizationId })),
);
const encodeRequest = Schema.encodeEffect(EmailSendRequested);

export const makeEmailOutbox = (
  sql: SqliteClient.SqliteClient,
  queue: Cloudflare.Queues.WriteQueueClient,
) => {
  const record = (id: SendId) =>
    sql`INSERT INTO email_outbox (send_id) VALUES (${id})`.pipe(Effect.asVoid, Effect.orDie);

  const recording = (store: SendStoreShape, afterRecord: Effect.Effect<void>): SendStoreShape => ({
    ...store,
    create: (id, recipient, email) =>
      store
        .create(id, recipient, email)
        .pipe(
          Effect.tap((state) =>
            state._tag === "Pending" ? Effect.andThen(record(id), afterRecord) : Effect.void,
          ),
        ),
    requeue: (id) =>
      store
        .requeue(id)
        .pipe(
          Effect.tap((result) =>
            result._tag === "Requeued" ? Effect.andThen(record(id), afterRecord) : Effect.void,
          ),
        ),
  });

  const isWaiting = sql<{ waiting: number }>`SELECT EXISTS (SELECT 1 FROM email_outbox) AS waiting`.pipe(
    Effect.map((rows) => (rows[0]?.waiting ?? 0) === 1),
    Effect.orDie,
  );

  const dispatchBatch = Effect.gen(function* () {
    const rows = yield* sql`SELECT id, send_id FROM email_outbox ORDER BY id LIMIT ${QUEUE_BATCH_LIMIT}`.pipe(
      Effect.flatMap(decodeOutboxRows),
    );
    const last = rows.at(-1);
    if (last === undefined) {
      return false;
    }
    const [organization] = yield* sql`SELECT id FROM organization LIMIT 1`.pipe(
      Effect.flatMap(decodeOrganizationRows),
    );
    if (organization === undefined) {
      return yield* Effect.die("an Organization with sends has no organization row");
    }
    const messages = yield* Effect.forEach(rows, (row) =>
      encodeRequest({ organizationId: organization.id, sendId: row.send_id }).pipe(
        Effect.map((body) => ({ body })),
      ),
    );
    yield* queue.sendBatch(messages);
    yield* sql`DELETE FROM email_outbox WHERE id <= ${last.id}`;
    return rows.length === QUEUE_BATCH_LIMIT;
  });

  const dispatch = Effect.gen(function* () {
    while (yield* dispatchBatch) {}
  }).pipe(Effect.orDie);

  return { recording, isWaiting, dispatch };
};
