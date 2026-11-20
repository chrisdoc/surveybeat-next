import type * as Cloudflare from "@alchemy.run/cloudflare";
import { EmailAddress, EmailRectification, OrganizationId } from "@surveybeat/domain";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const PendingRow = Schema.Struct({ old_email: EmailAddress, new_email: EmailAddress });

const OrganizationRow = Schema.Struct({ organization_id: OrganizationId });

const decodeRows = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.Array(schema));

export const d1EmailRectification = (db: Cloudflare.D1.QueryDatabaseClient) =>
  Effect.gen(function* () {
    const runtime = yield* Effect.context<RuntimeContext>();

    const run = <A, E>(effect: Effect.Effect<A, E, RuntimeContext>): Effect.Effect<A> =>
      effect.pipe(Effect.provideContext(runtime), Effect.orDie);

    const all = (sql: string, ...binds: readonly unknown[]) =>
      run(
        db
          .prepare(sql)
          .bind(...binds)
          .all()
          .pipe(Effect.map((result) => result.results)),
      );

    const write = (sql: string, ...binds: readonly unknown[]) =>
      run(
        db
          .prepare(sql)
          .bind(...binds)
          .run(),
      ).pipe(Effect.asVoid);

    return EmailRectification.of({
      takenByAnotherAccount: (userId, email) =>
        all(
          `SELECT 1 AS found FROM auth_user WHERE lower(email) = ? AND id <> ?
           UNION ALL
           SELECT 1 AS found FROM person_index
            WHERE email = ? AND (auth_user_id IS NULL OR auth_user_id <> ?)
           LIMIT 1`,
          email,
          userId,
          email,
          userId,
        ).pipe(Effect.map((rows) => rows.length > 0)),

      takenByAnyAccount: (email) =>
        all(
          `SELECT 1 AS found FROM auth_user WHERE lower(email) = ?
           UNION ALL
           SELECT 1 AS found FROM person_index WHERE email = ? AND auth_user_id IS NOT NULL
           LIMIT 1`,
          email,
          email,
        ).pipe(Effect.map((rows) => rows.length > 0)),

      pending: (userId) =>
        all("SELECT old_email, new_email FROM email_rectification WHERE auth_user_id = ?", userId).pipe(
          Effect.flatMap(decodeRows(PendingRow)),
          Effect.orDie,
          Effect.map((rows) =>
            Option.map(Option.fromNullishOr(rows[0]), (row) => ({
              oldEmail: row.old_email,
              newEmail: row.new_email,
            })),
          ),
        ),

      begin: (userId, change) =>
        write(
          `INSERT INTO email_rectification (auth_user_id, old_email, new_email) VALUES (?, ?, ?)
           ON CONFLICT (auth_user_id) DO UPDATE SET
             old_email = excluded.old_email, new_email = excluded.new_email`,
          userId,
          change.oldEmail,
          change.newEmail,
        ),

      abandon: (userId, newEmail) =>
        write("DELETE FROM email_rectification WHERE auth_user_id = ? AND new_email = ?", userId, newEmail),

      moveIndex: (userId, email) =>
        write("UPDATE person_index SET email = ? WHERE auth_user_id = ?", email, userId).pipe(
          Effect.andThen(
            all(
              "SELECT DISTINCT organization_id FROM person_index WHERE auth_user_id = ? ORDER BY organization_id",
              userId,
            ).pipe(Effect.flatMap(decodeRows(OrganizationRow)), Effect.orDie),
          ),
          Effect.map((rows) => rows.map((row) => row.organization_id)),
        ),

      finish: (userId) => write("DELETE FROM email_rectification WHERE auth_user_id = ?", userId),
    });
  });
