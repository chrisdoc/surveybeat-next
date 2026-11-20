import type { SqliteClient } from "@effect/sql-sqlite-do";
import * as Effect from "effect/Effect";

export const LEGACY_PERSON_COLUMN = "workos_user_id";

export const PERSON_AUTH_COLUMN = "auth_user_id";

export const needsPersonColumnRename = (columns: readonly string[]): boolean =>
  columns.includes(LEGACY_PERSON_COLUMN) && !columns.includes(PERSON_AUTH_COLUMN);

const hasPersonColumn = (sql: SqliteClient.SqliteClient, column: string) =>
  sql`SELECT ${sql(column)} FROM person LIMIT 0`.pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );

export const renameLegacyPersonColumn = (sql: SqliteClient.SqliteClient) =>
  Effect.gen(function* () {
    const columns = [
      ...((yield* hasPersonColumn(sql, LEGACY_PERSON_COLUMN)) ? [LEGACY_PERSON_COLUMN] : []),
      ...((yield* hasPersonColumn(sql, PERSON_AUTH_COLUMN)) ? [PERSON_AUTH_COLUMN] : []),
    ];

    if (!needsPersonColumnRename(columns)) {
      return false;
    }

    yield* sql`ALTER TABLE person RENAME COLUMN workos_user_id TO auth_user_id`;
    yield* Effect.logWarning("PERSON_AUTH_COLUMN_RENAMED");

    return true;
  });
