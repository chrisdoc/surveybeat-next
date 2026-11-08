import type * as Cloudflare from "@alchemy.run/cloudflare";
import { EmailSender } from "@surveybeat/domain";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

/**
 * `EmailSender` for every stage except production: records each message in the `captured_email`
 * table of the stage's D1 database and sends nothing. Built inside a handler.
 */
export const capturingEmailSender = (db: Cloudflare.D1.QueryDatabaseClient) =>
  Effect.gen(function* () {
    const runtime = yield* Effect.context<RuntimeContext>();
    return EmailSender.of({
      send: (message) =>
        Effect.gen(function* () {
          const messageId = `captured-${crypto.randomUUID()}`;
          const headers = message.headers !== undefined ? JSON.stringify(message.headers) : null;
          yield* db
            .prepare(
              "INSERT INTO captured_email (message_id, recipient, subject, html, text, captured_at, headers) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(
              messageId,
              message.to,
              message.subject,
              message.html,
              message.text,
              yield* Clock.currentTimeMillis,
              headers,
            )
            .run();
          return { messageId };
        }).pipe(Effect.provideContext(runtime)),
    });
  });
