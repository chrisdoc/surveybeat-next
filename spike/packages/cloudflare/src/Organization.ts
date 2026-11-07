import * as Cloudflare from "@alchemy.run/cloudflare";
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-do";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";

const ALARM_DELAY_MS = 30_000;

/** Walk the `cause`/`reason` chain and collect every message (SqlError wraps the SQLite message). */
const messages = (e: unknown): string[] => {
  const out: string[] = [];
  let cur: any = e;
  for (let i = 0; cur && i < 6; i++) {
    if (typeof cur.message === "string") out.push(cur.message);
    cur = cur.cause ?? cur.reason;
  }
  return out;
};

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Second migration set, applied with Effect's SqliteMigrator (the first uses Cloudflare.SqlMigrations). */
const effectMigrations = SqliteMigrator.fromRecord({
  "1_audit": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE audit (n INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL)`;
  }),
  "2_alarm_and_dlq": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE alarm_log (n INTEGER PRIMARY KEY AUTOINCREMENT, fired_at INTEGER NOT NULL, retry_count INTEGER NOT NULL)`;
    yield* sql`CREATE TABLE dlq_log (n INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, attempts INTEGER NOT NULL)`;
  }),
});

export default class Organization extends Cloudflare.DurableObject<Organization>()(
  "Organization",
  Effect.gen(function* () {
    // Outer (class-level) phase: capture the SQL migration files into the bundle.
    const migrations = yield* Cloudflare.SqlMigrations("../packages/cloudflare/migrations");

    // Inner phase: runs once per object activation, before methods are exposed.
    return Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState;

      // `storage` (not just `db`) so withTransaction uses storage.transaction().
      const scope = yield* Scope.make();
      const sql = yield* SqliteClient.make({ storage: state.raw.storage }).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.provide(Reactivity.layer),
      );

      // 1) Cloudflare.SqlMigrations (WITHOUT ROWID `organization` table)
      yield* migrations.apply().pipe(Effect.orDie);
      // 2) Effect's SqliteMigrator (audit, alarm_log, dlq_log)
      yield* SqliteMigrator.run({ loader: effectMigrations }).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.orDie,
      );

      const create = (idHex: string, name: string) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO organization (id, name) VALUES (${hexToBytes(idHex)}, ${name})`;
              yield* sql`INSERT INTO audit (event) VALUES (${`created:${idHex}`})`;
            }),
          )
          .pipe(Effect.orDie);

      return {
        create: (idHex: string, name: string) =>
          create(idHex, name).pipe(Effect.as({ id: idHex, name })),

        /** Multi-statement write that fails midway: proves the transaction rolls back. */
        createThenFail: (idHex: string, name: string) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                yield* sql`INSERT INTO organization (id, name) VALUES (${hexToBytes(idHex)}, ${name})`;
                yield* sql`INSERT INTO audit (event) VALUES ('should-roll-back')`;
                return yield* Effect.fail("boom");
              }),
            )
            .pipe(
              Effect.match({
                onFailure: (e) => ({ failed: String(e) }),
                onSuccess: () => ({ failed: null }),
              }),
            ),

        get: (idHex: string) =>
          sql<{
            id: Uint8Array;
            name: string;
          }>`SELECT id, name FROM organization WHERE id = ${hexToBytes(idHex)}`.pipe(
            Effect.map((rows) => {
              const row = rows[0];
              return row ? { id: bytesToHex(row.id), name: row.name } : null;
            }),
            Effect.orDie,
          ),

        counts: () =>
          Effect.gen(function* () {
            const [o] = yield* sql<{ c: number }>`SELECT count(*) AS c FROM organization`;
            const [a] = yield* sql<{ c: number }>`SELECT count(*) AS c FROM audit`;
            return { organizations: o?.c ?? 0, audit: a?.c ?? 0 };
          }).pipe(Effect.orDie),

        /** Reports what SQLite says about the table, and whether `rowid` is selectable. */
        introspect: () =>
          Effect.gen(function* () {
            const master = yield* sql<{
              name: string;
              sql: string;
            }>`SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name`;
            const tableList = yield* sql<Record<string, unknown>>`PRAGMA table_list`;
            const orgInfo = tableList.filter((t) => t.name === "organization");
            const rowid = yield* sql`SELECT rowid FROM organization`.pipe(
              Effect.match({
                onFailure: (e) => ({ ok: false as const, error: messages(e) }),
                onSuccess: () => ({ ok: true as const, error: null }),
              }),
            );
            const migrationTables = yield* sql<
              Record<string, unknown>
            >`SELECT * FROM effect_sql_migrations`;
            const alchemyMigrations = yield* sql<
              Record<string, unknown>
            >`SELECT name FROM __alchemy_migrations`;
            return {
              master: master.map((m) => ({ name: m.name, sql: m.sql })),
              pragmaTableListOrganization: orgInfo,
              selectRowid: rowid,
              effectMigrations: migrationTables,
              alchemyMigrations,
            };
          }).pipe(Effect.orDie),

        /** Arms the alarm `delayMs` from now (default 30 s). */
        armAlarm: (delayMs: number = ALARM_DELAY_MS) =>
          state.storage.setAlarm(Date.now() + delayMs).pipe(Effect.as({ armedInMs: delayMs })),

        alarmLog: () =>
          sql<{
            n: number;
            fired_at: number;
            retry_count: number;
          }>`SELECT n, fired_at, retry_count FROM alarm_log ORDER BY n`.pipe(Effect.orDie),

        /** Alarm handler: writes a row, and re-arms itself exactly once. */
        alarm: (info?: { retryCount: number; isRetry: boolean }) =>
          Effect.gen(function* () {
            yield* sql`INSERT INTO alarm_log (fired_at, retry_count) VALUES (${Date.now()}, ${info?.retryCount ?? 0})`;
            const [row] = yield* sql<{ c: number }>`SELECT count(*) AS c FROM alarm_log`;
            if ((row?.c ?? 0) === 1) {
              yield* state.storage.setAlarm(Date.now() + ALARM_DELAY_MS);
            }
          }).pipe(Effect.orDie),

        logDlq: (body: string, attempts: number) =>
          sql`INSERT INTO dlq_log (body, attempts) VALUES (${body}, ${attempts})`.pipe(
            Effect.asVoid,
            Effect.orDie,
          ),
        dlqLog: () =>
          sql<{
            n: number;
            body: string;
            attempts: number;
          }>`SELECT n, body, attempts FROM dlq_log ORDER BY n`.pipe(Effect.orDie),
      };
    });
  }),
) {}
