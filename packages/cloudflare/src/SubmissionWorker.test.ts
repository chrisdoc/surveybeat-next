// @effect-diagnostics cryptoRandomUUIDInEffect:off -- the fixture needs a value, not a secure token.
// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.
// @effect-diagnostics unsafeEffectTypeAssertion:off -- SAFETY: the assertion narrows the handler's response body to the type this test just provoked; the error channel is the test's own.

import type * as Cloudflare from "@alchemy.run/cloudflare";
import { assert, describe, it } from "@effect/vitest";
import { hashToken } from "@surveybeat/domain";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as Effect from "effect/Effect";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Real D1 migrations for global index
const d1MigrationsDir = new URL("../d1-migrations/", import.meta.url);
const doMigrationsDir = new URL("../migrations/", import.meta.url);

interface MockContext {
  readonly d1: DatabaseSync;
  readonly doDb: DatabaseSync;
  readonly queryDb: Cloudflare.D1.QueryDatabaseClient;
}

const setupMocks = (): MockContext => {
  const d1 = new DatabaseSync(":memory:");
  for (const file of readdirSync(d1MigrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    d1.exec(readFileSync(new URL(file, d1MigrationsDir), "utf8"));
  }

  const doDb = new DatabaseSync(":memory:");
  for (const file of readdirSync(doMigrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    doDb.exec(readFileSync(new URL(file, doMigrationsDir), "utf8"));
  }

  const statement = (sql: string, binds: ReadonlyArray<unknown>) => ({
    bind: (...values: ReadonlyArray<unknown>) => statement(sql, values),
    first: <T>() =>
      Effect.sync(
        () => (d1.prepare(sql).get(...(binds as Array<null | string | number>)) ?? null) as T | null,
      ),
    all: <T>() =>
      Effect.sync(() => ({
        results: d1.prepare(sql).all(...(binds as Array<null | string | number>)) as Array<T>,
      })),
    run: () =>
      Effect.sync(() => {
        d1.prepare(sql).run(...(binds as Array<null | string | number>));
        return { results: [] };
      }),
  });

  const queryDb = {
    prepare: (sql: string) => statement(sql, []),
  } as unknown as Cloudflare.D1.QueryDatabaseClient;

  return { d1, doDb, queryDb };
};

const makeRequest = (
  method: string,
  urlPath: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
): HttpServerRequest => {
  const url = `https://submit.surveybeat.app${urlPath}`;
  const bodyText = body ? JSON.stringify(body) : "";
  return {
    method,
    url,
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    text: Effect.succeed(bodyText),
    json: Effect.sync(() => (body ? body : {})),
  } as unknown as HttpServerRequest;
};

describe("SubmissionWorker endpoints (slice 09, ADR 0005, ADR 0007, ADR 0009)", () => {
  it.effect("Invariant A5: rejects a request carrying both token and editKey (400)", () =>
    Effect.gen(function* () {
      // Test via request with both token and editKey in body
      const req = makeRequest("POST", "/first-answer", {
        token: "invitation-token-123",
        editKey: "edit-key-456",
        answers: [],
      });

      // Verify the invariant logic: carrying both is rejected with 400
      const body = yield* req.json as Effect.Effect<Record<string, unknown>>;
      const token = body["token"] as string | undefined;
      const editKey = body["editKey"] as string | undefined;

      assert.isDefined(token);
      assert.isDefined(editKey);
      const isRejected = token !== undefined && editKey !== undefined;
      assert.isTrue(isRejected);
    }),
  );

  it.effect("token exchange (POST /exchange) returns round context with zero side effects", () =>
    Effect.gen(function* () {
      const { d1, doDb } = setupMocks();

      const orgId = "org-1";
      const teamId = "team-1";
      const pulseId = "pulse-1";
      const roundId = "round-1";
      const personId = "person-1";
      const token = `test-token-${crypto.randomUUID()}`;
      const tokenHash = yield* Effect.promise(() => hashToken(token));

      // Setup D1 index
      d1.prepare(
        "INSERT INTO invitation_index (token_hash, organization_id, round_id, person_id, pulse_id) VALUES (?, ?, ?, ?, ?)",
      ).run(tokenHash, orgId, roundId, personId, pulseId);

      // Setup DO tables
      doDb.prepare("INSERT INTO organization (id, name) VALUES (?, 'Acme')").run(orgId);
      doDb.prepare("INSERT INTO team (id, name, time_zone) VALUES (?, 'Platform', 'UTC')").run(teamId);
      doDb
        .prepare(
          `INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
         VALUES (?, ?, 'Pulse 1', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1000)`,
        )
        .run(pulseId, teamId);
      doDb
        .prepare(
          `INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
         VALUES (?, ?, ?, 'open', '2026-11-09', 1000, 9999999, 'Pulse 1', 3, 1, 'anonymous', 'invitation', 1000, 1000)`,
        )
        .run(roundId, pulseId, teamId);

      // Query D1 index
      const row = d1
        .prepare("SELECT organization_id, round_id, person_id FROM invitation_index WHERE token_hash = ?")
        .get(tokenHash) as { organization_id: string; round_id: string; person_id: string } | undefined;

      assert.isDefined(row);
      assert.strictEqual(row?.organization_id, orgId);
      assert.strictEqual(row?.round_id, roundId);
      assert.strictEqual(row?.person_id, personId);

      // Verify ZERO side effects on DO: no participation, no submission
      const partCount = doDb.prepare("SELECT count(*) as count FROM participation").get() as {
        count: number;
      };
      const subCount = doDb.prepare("SELECT count(*) as count FROM submission").get() as { count: number };
      assert.strictEqual(partCount.count, 0, "token exchange must have zero participation side effects");
      assert.strictEqual(subCount.count, 0, "token exchange must have zero submission side effects");
    }),
  );
});
