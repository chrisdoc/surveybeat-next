import * as Cloudflare from "@alchemy.run/cloudflare";
import { SqliteClient } from "@effect/sql-sqlite-do";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";

/**
 * Relative to the directory Alchemy runs in, which is the repository root (`pnpm infra:deploy`, `pnpm test`).
 * It must be a literal: the same expression runs again inside the bundle, where `import.meta.url` differs.
 */
const migrationsDirectory = "packages/cloudflare/migrations";

/**
 * The Organization Durable Object (ADR 0006): one object per Organization, SQLite storage.
 * Methods return plain data. The Main Worker maps it to the domain schemas.
 */
export default class Organization extends Cloudflare.DurableObject<Organization>()(
  "Organization",
  Effect.gen(function* () {
    // Outer phase: capture the SQL files into the bundle.
    const migrations = yield* Cloudflare.SqlMigrations(migrationsDirectory);

    // Inner phase: runs once per object activation, before any method is exposed.
    return Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState;

      // Pass `storage` (not just `db`) so `withTransaction` uses `storage.transaction()`.
      const scope = yield* Scope.make();
      const sql = yield* SqliteClient.make({ storage: state.raw.storage }).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.provide(Reactivity.layer),
      );

      yield* migrations.apply().pipe(Effect.orDie);

      return {
        create: (id: string, name: string) =>
          sql
            .withTransaction(sql`INSERT INTO organization (id, name) VALUES (${id}, ${name})`)
            .pipe(Effect.as({ id, name }), Effect.orDie),

        get: (id: string) =>
          sql<{ id: string; name: string }>`SELECT id, name FROM organization WHERE id = ${id}`.pipe(
            Effect.map((rows) => rows[0] ?? null),
            Effect.orDie,
          ),
      };
    });
  }),
) {}
