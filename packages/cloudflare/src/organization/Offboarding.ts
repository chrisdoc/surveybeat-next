import type { SqliteClient } from "@effect/sql-sqlite-do";
import {
  offboardingAccess,
  offboardingConfirmation,
  offboardingExportOf,
  OrganizationId,
  PersonId,
} from "@surveybeat/domain";
import type { DirectoryState, PulseState } from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const OrganizationIdRow = Schema.Struct({ id: OrganizationId });

const TimeZoneRow = Schema.Struct({ id: PersonId, time_zone: Schema.NullOr(Schema.String) });

export interface OrganizationStorage {
  readonly deleteAlarm: () => Promise<void>;
  readonly deleteAll: () => Promise<void>;
}

export const organizationOffboarding = ({
  sql,
  directory,
  pulses,
  storage,
}: {
  readonly sql: SqliteClient.SqliteClient;
  readonly directory: { readonly load: Effect.Effect<DirectoryState> };
  readonly pulses: { readonly load: Effect.Effect<PulseState> };
  readonly storage: OrganizationStorage;
}) => ({
  viewOffboardingExport: (actorId: PersonId, now: number) =>
    Effect.gen(function* () {
      const state = yield* directory.load;
      const access = offboardingAccess(state, actorId);

      if (access._tag === "Rejected") {
        return access;
      }

      const [organization] = yield* sql`SELECT id FROM organization LIMIT 1`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(OrganizationIdRow))),
      );

      const timeZones = yield* sql`SELECT id, time_zone FROM person`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(TimeZoneRow))),
      );

      if (organization === undefined) {
        return yield* Effect.die("organization row missing");
      }

      return {
        _tag: "Viewed" as const,
        value: offboardingExportOf({
          organizationId: organization.id,
          state,
          timeZones: new Map(timeZones.map((row) => [row.id, row.time_zone])),
          pulses: yield* pulses.load,
          now,
        }),
      };
    }).pipe(Effect.orDie),

  confirmOffboarding: (actorId: PersonId, confirmation: string) =>
    directory.load.pipe(Effect.map((state) => offboardingConfirmation(state, actorId, confirmation))),

  wipeOrganization: () =>
    Effect.promise(() => storage.deleteAlarm()).pipe(
      Effect.andThen(Effect.promise(() => storage.deleteAll())),
    ),
});
