// @effect-diagnostics asyncFunction:off -- node:sqlite's transaction callback is async; the harness exposes it to the test, not to an Effect runtime.

import type { DatabaseSync, SQLInputValue } from "node:sqlite";

/**
 * The part of a Durable Object's `storage` that `@effect/sql-sqlite-do` uses (`sql.exec` and
 * `transaction`), backed by an in-memory `node:sqlite` database. It lets adapter code such as
 * `makeSqlRounds` run for real, with real transactions, inside a plain Vitest test: no workerd and no
 * test route. Cast it to `DurableObjectStorage` at the call site.
 */
export interface SqliteStorage {
  readonly sql: {
    readonly exec: (
      query: string,
      ...bindings: ReadonlyArray<SQLInputValue>
    ) => {
      readonly columnNames: ReadonlyArray<string>;
      readonly raw: () => IterableIterator<ReadonlyArray<unknown>>;
    };
  };
  readonly transaction: <T>(callback: (txn: { readonly rollback: () => void }) => Promise<T>) => Promise<T>;
}

export const makeSqliteStorage = (db: DatabaseSync): SqliteStorage => {
  let depth = 0;
  return {
    sql: {
      exec: (query, ...bindings) => {
        const statement = db.prepare(query);
        statement.setReturnArrays(true);
        const columnNames = statement.columns().map((column) => column.name);
        const rows: Array<ReadonlyArray<unknown>> = [];
        if (columnNames.length === 0) {
          statement.run(...bindings);
        } else {
          for (const row of statement.all(...bindings)) rows.push(Object.values(row));
        }
        return { columnNames, raw: () => rows[Symbol.iterator]() };
      },
    },
    transaction: async (callback) => {
      const level = depth++;
      const savepoint = `storage_level_${level}`;
      db.exec(level === 0 ? "BEGIN" : `SAVEPOINT ${savepoint}`);
      let rolledBack = false;
      const undo = () => {
        if (level === 0) db.exec("ROLLBACK");
        else db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      };
      try {
        const result = await callback({
          rollback: () => {
            rolledBack = true;
          },
        });
        if (rolledBack) undo();
        else db.exec(level === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
        return result;
      } catch (cause) {
        undo();
        throw cause;
      } finally {
        depth = level;
      }
    },
  };
};
