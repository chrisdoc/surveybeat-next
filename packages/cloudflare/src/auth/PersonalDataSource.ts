import type * as Cloudflare from "@alchemy.run/cloudflare";
import {
  assemblePersonalDataExport,
  isoTimestamp,
  OrganizationId,
  PersonalDataSource,
} from "@surveybeat/domain";
import type { AccountData, AuthUserId, OrganizationPersonalData } from "@surveybeat/domain";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const Stamp = Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]));

const UserRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Union([Schema.Finite, Schema.String]),
  createdAt: Stamp,
  updatedAt: Stamp,
});

const SessionRow = Schema.Struct({
  id: Schema.String,
  expiresAt: Stamp,
  createdAt: Stamp,
  updatedAt: Stamp,
  ipAddress: Schema.NullOr(Schema.String),
  userAgent: Schema.NullOr(Schema.String),
});

const LinkRow = Schema.Struct({
  id: Schema.String,
  providerId: Schema.String,
  accountId: Schema.String,
  createdAt: Stamp,
  updatedAt: Stamp,
});

const PasskeyRow = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  deviceType: Schema.String,
  createdAt: Stamp,
});

const IndexRow = Schema.Struct({
  organization_id: OrganizationId,
  name: Schema.String,
  person_id: Schema.String,
  email: Schema.String,
});

const ClaimRow = Schema.Struct({
  organization_id: OrganizationId,
  name: Schema.String,
  admin_person_id: Schema.String,
  completed_at: Stamp,
});

const isActive = (expiresAt: string | number | null, now: number): boolean => {
  const iso = isoTimestamp(expiresAt);

  return (
    iso !== null && Option.exists(DateTime.make(iso), (expires) => DateTime.toEpochMillis(expires) > now)
  );
};

export const readAccountData = (db: Cloudflare.D1.QueryDatabaseClient) => {
  const all = <S extends Schema.Top & { readonly DecodingServices: never }>(
    schema: S,
    sql: string,
    userId: string,
  ) =>
    db
      .prepare(sql)
      .bind(userId)
      .all()
      .pipe(Effect.flatMap((result) => Schema.decodeEffect(Schema.Array(schema))(result.results)));

  return (userId: AuthUserId, now: number): Effect.Effect<AccountData, never, RuntimeContext> =>
    Effect.gen(function* () {
      const users = yield* all(
        UserRow,
        "SELECT id, name, email, emailVerified, createdAt, updatedAt FROM auth_user WHERE id = ?",
        userId,
      );

      const sessions = yield* all(
        SessionRow,
        `SELECT id, expiresAt, createdAt, updatedAt, ipAddress, userAgent
           FROM auth_session WHERE userId = ? ORDER BY createdAt, id`,
        userId,
      );

      const links = yield* all(
        LinkRow,
        `SELECT id, providerId, accountId, createdAt, updatedAt
           FROM auth_account WHERE userId = ? ORDER BY createdAt, id`,
        userId,
      );

      const passkeys = yield* all(
        PasskeyRow,
        "SELECT id, name, deviceType, createdAt FROM auth_passkey WHERE userId = ? ORDER BY createdAt, id",
        userId,
      );

      const index = yield* all(
        IndexRow,
        `SELECT p.organization_id, o.name, p.person_id, p.email
           FROM person_index p JOIN organization_index o ON o.organization_id = p.organization_id
          WHERE p.auth_user_id = ? ORDER BY p.organization_id`,
        userId,
      );

      const claims = yield* all(
        ClaimRow,
        `SELECT organization_id, name, admin_person_id, completed_at
           FROM organization_claim WHERE auth_user_id = ? ORDER BY organization_id`,
        userId,
      );

      const user = users[0];

      return {
        user:
          user === undefined
            ? null
            : {
                id: user.id,
                name: user.name,
                email: user.email,
                emailVerified: user.emailVerified === 1 || user.emailVerified === "1",
                createdAt: isoTimestamp(user.createdAt),
                updatedAt: isoTimestamp(user.updatedAt),
              },
        activeSessions: sessions
          .filter((row) => isActive(row.expiresAt, now))
          .map((row) => ({
            id: row.id,
            createdAt: isoTimestamp(row.createdAt),
            updatedAt: isoTimestamp(row.updatedAt),
            expiresAt: isoTimestamp(row.expiresAt),
            ipAddress: row.ipAddress,
            userAgent: row.userAgent,
          })),
        providerLinks: links.map((row) => ({
          id: row.id,
          providerId: row.providerId,
          accountId: row.accountId,
          createdAt: isoTimestamp(row.createdAt),
          updatedAt: isoTimestamp(row.updatedAt),
        })),
        passkeys: passkeys.map((row) => ({
          id: row.id,
          name: row.name,
          deviceType: row.deviceType,
          createdAt: isoTimestamp(row.createdAt),
        })),
        personIndex: index.map((row) => ({
          organizationId: row.organization_id,
          organizationName: row.name,
          personId: row.person_id,
          email: row.email,
        })),
        organizationClaims: claims.map((row) => ({
          organizationId: row.organization_id,
          name: row.name,
          adminPersonId: row.admin_person_id,
          completedAt: isoTimestamp(row.completed_at),
        })),
      } satisfies AccountData;
    }).pipe(Effect.orDie);
};

export interface PersonalDataOrganizations {
  readonly getByName: (id: string) => {
    readonly exportPersonalData: (authUserId: string) => Effect.Effect<OrganizationPersonalData | null>;
  };
}

export const personalDataSource = (
  db: Cloudflare.D1.QueryDatabaseClient,
  organizations: PersonalDataOrganizations,
) =>
  Effect.gen(function* () {
    const runtime = yield* Effect.context<RuntimeContext>();
    const account = readAccountData(db);

    return PersonalDataSource.of({
      gather: (userId, now) =>
        Effect.gen(function* () {
          const data = yield* account(userId, now).pipe(Effect.provideContext(runtime));

          const organizationIds = [
            ...new Set([
              ...data.personIndex.map((entry) => entry.organizationId),
              ...data.organizationClaims.map((claim) => claim.organizationId),
            ]),
          ].sort();

          const found = yield* Effect.forEach(
            organizationIds,
            (id) => organizations.getByName(id).exportPersonalData(userId),
            { concurrency: 4 },
          );

          return assemblePersonalDataExport({
            now,
            account: data,
            organizations: found.filter((each): each is OrganizationPersonalData => each !== null),
          });
        }),
    });
  });
