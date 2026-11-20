import { SqliteClient } from "@effect/sql-sqlite-do";
import { assert, describe, it } from "@effect/vitest";
import { ActionId, EmailAddress, PersonId, RoundId, TeamId } from "@surveybeat/domain";
import { migratedDatabase, SqliteStorage } from "@surveybeat/testing";
import * as Effect from "effect/Effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { makeSqlActions } from "./SqlActions.ts";

const migrations = new URL("../migrations/", import.meta.url);

const seed = () => {
  const db = migratedDatabase(migrations);
  db.exec(`
    INSERT INTO organization (id, name) VALUES ('acme', 'Acme');
    INSERT INTO team (id, name, time_zone) VALUES ('team', 'Platform', 'UTC');
    INSERT INTO person (id, email, auth_user_id) VALUES
      ('ada', 'ada@example.com', 'user_ada'),
      ('grace', 'grace@example.com', 'user_grace');
    INSERT INTO pulse (id, team_id, name, cadence, weekday, send_time, answer_window_days, reminders, anonymity_mode, distribution, created_at)
      VALUES ('pulse', 'team', 'Pulse', 'weekly', 'monday', '09:00', 3, 1, 'anonymous', 'invitation', 1);
    INSERT INTO round (id, pulse_id, team_id, status, planned_open_date, planned_open_at, planned_close_at, pulse_name, answer_window_days, reminders, anonymity_mode, distribution, created_at, updated_at)
      VALUES ('round', 'pulse', 'team', 'open', '2026-11-16', 1, 9, 'Pulse', 3, 1, 'anonymous', 'invitation', 1, 1);
    INSERT INTO action (id, team_id, round_id, title, owner_id, due_date, dimension, status, created_at, updated_at, done_at)
      VALUES
        ('ada-action', 'team', 'round', 'Fewer meetings', 'ada', NULL, NULL, 'committed', 1, 1, NULL),
        ('grace-action', 'team', 'round', 'Clearer plan', 'grace', NULL, NULL, 'proposed', 2, 2, NULL);
    UPDATE person
       SET email = 'erased-ada@erased.invalid', auth_user_id = NULL, removed_at = 5, erased_at = 5
     WHERE id = 'ada';
  `);

  return db;
};

describe("action owner addresses", () => {
  it.effect("hides an erased owner's address and keeps a live owner's address", () =>
    Effect.gen(function* () {
      const db = seed();

      const sql = yield* SqliteClient.make({
        storage: SqliteStorage.makeSqliteStorage(db) as unknown as NonNullable<
          Parameters<typeof SqliteClient.make>[0]["storage"]
        >,
      }).pipe(Effect.provideService(Scope.Scope, yield* Scope.make()), Effect.provide(Reactivity.layer));

      const actions = makeSqlActions(sql);
      const teamId = TeamId.make("team");
      const roundId = RoundId.make("round");
      const ada = yield* actions.getActionItem(ActionId.make("ada-action"));
      const grace = yield* actions.getActionItem(ActionId.make("grace-action"));
      const listed = yield* actions.getActionsForTeam(teamId);
      const forRound = yield* actions.getActionsForTeam(teamId, roundId);

      assert.strictEqual(ada?.ownerId, PersonId.make("ada"));
      assert.strictEqual(ada?.ownerEmail, null);
      assert.strictEqual(grace?.ownerEmail, EmailAddress.make("grace@example.com"));
      assert.deepStrictEqual(
        listed.map((action) => action.ownerEmail),
        [null, EmailAddress.make("grace@example.com")],
      );
      assert.deepStrictEqual(
        forRound.map((action) => action.ownerEmail),
        [null, EmailAddress.make("grace@example.com")],
      );
      assert.notInclude(JSON.stringify(listed), "erased-ada@erased.invalid");
      assert.notInclude(JSON.stringify(listed), "ada@example.com");
    }),
  );
});
