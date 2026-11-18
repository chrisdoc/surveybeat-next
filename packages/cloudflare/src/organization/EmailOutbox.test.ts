import type * as Cloudflare from "@alchemy.run/cloudflare";
import { SqliteClient } from "@effect/sql-sqlite-do";
import { assert, describe, it } from "@effect/vitest";
import {
  EmailAddress,
  SendId,
  type RequeueResult,
  type SendState,
  type SendStoreShape,
} from "@surveybeat/domain";
import { migratedDatabase, SqliteStorage } from "@surveybeat/testing";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { makeEmailOutbox } from "./EmailOutbox.ts";

const migrationsDir = new URL("../../migrations/", import.meta.url);

const pending: SendState = { _tag: "Pending", attempts: 0, lastCode: null };
const sent = { _tag: "Sent", messageId: "m-1" } as unknown as SendState;

const email = {
  _tag: "AddedToTeam",
  locale: "en",
  teamName: "Platform",
  leadName: "Grace Hopper",
  signInUrl: "https://app.surveybeat.app/",
} as const;

/** The Organization object's tables on the real migrations, a recording fake queue, and the outbox. */
const setUp = (options: { readonly onBatch?: () => void; readonly failSend?: boolean } = {}) =>
  Effect.gen(function* () {
    const db = migratedDatabase(migrationsDir);
    db.prepare("INSERT INTO organization (id, name) VALUES ('org-1', 'Acme')").run();
    const sql = yield* SqliteClient.make({
      storage: SqliteStorage.makeSqliteStorage(db) as unknown as NonNullable<
        Parameters<typeof SqliteClient.make>[0]["storage"]
      >,
    }).pipe(Effect.provideService(Scope.Scope, yield* Scope.make()), Effect.provide(Reactivity.layer));

    const batches: Array<ReadonlyArray<unknown>> = [];
    const queue = {
      sendBatch: (messages: ReadonlyArray<{ readonly body: unknown }>) =>
        options.failSend === true
          ? Effect.die("queue unavailable")
          : Effect.sync(() => {
              batches.push(messages.map((message) => message.body));
              options.onBatch?.();
            }),
    } as unknown as Cloudflare.Queues.WriteQueueClient;

    const outbox = makeEmailOutbox(sql, queue);
    const rows = () =>
      db
        .prepare("SELECT send_id FROM email_outbox ORDER BY id")
        .all()
        .map((row) => row.send_id);
    return { db, outbox, batches, rows };
  });

const storeAnswering = (created: SendState, requeued: RequeueResult) =>
  ({
    create: () => Effect.succeed(created),
    requeue: () => Effect.succeed(requeued),
  }) as unknown as SendStoreShape;

describe("the Organization's email outbox", () => {
  it.effect("records a send that is created Pending or requeued, and nothing else", () =>
    Effect.gen(function* () {
      const { outbox, rows } = yield* setUp();
      let recorded = 0;
      const after = Effect.sync(() => void recorded++);

      const fresh = outbox.recording(storeAnswering(pending, { _tag: "Requeued" }), after);
      yield* fresh.create(SendId.make("a"), EmailAddress.make("ada@example.com"), email);
      yield* fresh.requeue(SendId.make("b"));

      const finished = outbox.recording(storeAnswering(sent, { _tag: "Unchanged", state: sent }), after);
      yield* finished.create(SendId.make("c"), EmailAddress.make("ada@example.com"), email);
      yield* finished.requeue(SendId.make("d"));

      assert.deepStrictEqual(rows(), ["a", "b"]);
      assert.strictEqual(recorded, 2);
      assert.isTrue(yield* outbox.isWaiting);
    }),
  );

  it.effect("puts every waiting send on the queue in batches of at most 100, then empties", () =>
    Effect.gen(function* () {
      const { db, outbox, batches, rows } = yield* setUp();
      const insert = db.prepare("INSERT INTO email_outbox (send_id) VALUES (?)");
      for (let i = 0; i < 205; i++) insert.run(`send-${i}`);

      yield* outbox.dispatch.pipe(Effect.provide(RuntimeContext.phantom));

      assert.deepStrictEqual(
        batches.map((batch) => batch.length),
        [100, 100, 5],
      );
      assert.deepStrictEqual(batches[0]?.[0], { organizationId: "org-1", sendId: "send-0" });
      assert.deepStrictEqual(batches[2]?.[4], { organizationId: "org-1", sendId: "send-204" });
      assert.deepStrictEqual(rows(), []);
      assert.isFalse(yield* outbox.isWaiting);
    }),
  );

  it.effect("keeps a send recorded while its batch was on the way to the queue", () =>
    Effect.gen(function* () {
      let late: (() => void) | undefined;
      const { db, outbox, batches, rows } = yield* setUp({ onBatch: () => late?.() });
      db.prepare("INSERT INTO email_outbox (send_id) VALUES ('early')").run();
      late = () => {
        late = undefined;
        db.prepare("INSERT INTO email_outbox (send_id) VALUES ('late')").run();
      };

      yield* outbox.dispatch.pipe(Effect.provide(RuntimeContext.phantom));

      assert.deepStrictEqual(batches, [[{ organizationId: "org-1", sendId: "early" }]]);
      assert.deepStrictEqual(rows(), ["late"]);
    }),
  );

  it.effect("keeps every waiting send when the queue refuses the batch", () =>
    Effect.gen(function* () {
      const { db, outbox, rows } = yield* setUp({ failSend: true });
      db.prepare("INSERT INTO email_outbox (send_id) VALUES ('a')").run();

      const exit = yield* Effect.exit(outbox.dispatch.pipe(Effect.provide(RuntimeContext.phantom)));

      assert.isTrue(Exit.isFailure(exit));
      assert.deepStrictEqual(rows(), ["a"]);
    }),
  );
});
