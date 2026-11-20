import type * as Cloudflare from "@alchemy.run/cloudflare";
import { AuthUserId, OrganizationId, OrganizationOffboarding } from "@surveybeat/domain";
import type { OrganizationOffboardingShape } from "@surveybeat/domain";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const ActorRow = Schema.Struct({ actor_user_id: AuthUserId });

const PendingRow = Schema.Struct({ organization_id: OrganizationId });

const IndexedRow = Schema.Struct({ auth_user_id: AuthUserId });

const decodeRows = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.Array(schema));

const tokenIndexes = [
  "invitation_index",
  "test_invitation_index",
  "test_submission_index",
  "submission_index",
] as const;

export const d1OrganizationOffboarding = (
  db: Cloudflare.D1.QueryDatabaseClient,
  wipe: OrganizationOffboardingShape["wipe"],
) =>
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

    return OrganizationOffboarding.of({
      begin: (organizationId, userId, now) =>
        Effect.gen(function* () {
          yield* write(
            `INSERT INTO organization_offboarding (organization_id, actor_user_id, confirmed_at)
             VALUES (?, ?, ?) ON CONFLICT (organization_id) DO NOTHING`,
            organizationId,
            userId,
            now,
          );

          const rows = yield* all(
            "SELECT actor_user_id FROM organization_offboarding WHERE organization_id = ?",
            organizationId,
          ).pipe(Effect.flatMap(decodeRows(ActorRow)), Effect.orDie);

          return rows[0]?.actor_user_id === userId;
        }),

      pending: (userId) =>
        all(
          `SELECT organization_id FROM organization_offboarding
            WHERE actor_user_id = ? ORDER BY confirmed_at, organization_id LIMIT 1`,
          userId,
        ).pipe(
          Effect.flatMap(decodeRows(PendingRow)),
          Effect.orDie,
          Effect.map((rows) => Option.map(Option.fromNullishOr(rows[0]), (row) => row.organization_id)),
        ),

      revokeAccess: (organizationId) =>
        Effect.gen(function* () {
          for (const table of tokenIndexes) {
            yield* write(`DELETE FROM ${table} WHERE organization_id = ?`, organizationId);
          }

          yield* write("DELETE FROM auth_session_organization WHERE organization_id = ?", organizationId);
        }),

      wipe,

      removeIndex: (organizationId) =>
        Effect.gen(function* () {
          const indexed = yield* all(
            "SELECT DISTINCT auth_user_id FROM person_index WHERE organization_id = ? AND auth_user_id IS NOT NULL",
            organizationId,
          ).pipe(Effect.flatMap(decodeRows(IndexedRow)), Effect.orDie);

          const statements = [
            [
              `DELETE FROM captured_email WHERE message_id IN (
                 SELECT message_id FROM email_message WHERE organization_id = ?)`,
              organizationId,
            ],
            ["DELETE FROM email_message WHERE organization_id = ?", organizationId],
            ["DELETE FROM person_index WHERE organization_id = ?", organizationId],
            ["DELETE FROM organization_claim WHERE organization_id = ?", organizationId],
            ["DELETE FROM organization_offboarding WHERE organization_id = ?", organizationId],
            ["DELETE FROM organization_index WHERE organization_id = ?", organizationId],
          ] as const;

          yield* run(db.batch(statements.map(([sql, id]) => db.prepare(sql).bind(id))));

          return indexed.map((row) => row.auth_user_id);
        }),
    });
  });
