import type * as Cloudflare from "@alchemy.run/cloudflare";
import {
  AuthUserId,
  EmailAddress,
  normaliseEmail,
  OrganizationId,
  PeopleIndex,
  PersonId,
} from "@surveybeat/domain";
import type { ClaimStatus, PersonCandidate } from "@surveybeat/domain";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const CandidateRow = Schema.Struct({
  organization_id: OrganizationId,
  name: Schema.String,
  person_id: PersonId,
  linked: Schema.Finite,
});

const ClaimRow = Schema.Struct({
  organization_id: OrganizationId,
  name: Schema.String,
  admin_person_id: PersonId,
  completed_at: Schema.NullOr(Schema.Finite),
});

const IndexedRow = Schema.Struct({ auth_user_id: Schema.NullOr(AuthUserId) });

const decodeRows = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.Array(schema));

const toCandidate = (row: typeof CandidateRow.Type): PersonCandidate => ({
  organization: { id: row.organization_id, name: row.name },
  personId: row.person_id,
  linked: row.linked === 1,
});

const toClaim = (row: typeof ClaimRow.Type): ClaimStatus => ({
  organization: { id: row.organization_id, name: row.name },
  adminPersonId: row.admin_person_id,
  completed: row.completed_at !== null,
});

export const d1PeopleIndex = (db: Cloudflare.D1.QueryDatabaseClient) =>
  Effect.gen(function* () {
    const runtime = yield* Effect.context<RuntimeContext>();

    const run = <A, E>(effect: Effect.Effect<A, E, RuntimeContext>): Effect.Effect<A> =>
      effect.pipe(Effect.provideContext(runtime), Effect.orDie);

    const all = (sql: string, ...binds: readonly unknown[]) =>
      db
        .prepare(sql)
        .bind(...binds)
        .all()
        .pipe(Effect.map((result) => result.results));

    const write = (sql: string, ...binds: readonly unknown[]) =>
      run(
        db
          .prepare(sql)
          .bind(...binds)
          .run(),
      ).pipe(Effect.asVoid);

    const claimOf = (userId: string) =>
      run(
        all(
          `SELECT organization_id, name, admin_person_id, completed_at
             FROM organization_claim WHERE auth_user_id = ?`,
          userId,
        ).pipe(Effect.flatMap(decodeRows(ClaimRow))),
      ).pipe(Effect.map((rows) => Option.map(Option.fromNullishOr(rows[0]), toClaim)));

    const hasPersons = (userId: AuthUserId) =>
      run(all("SELECT 1 AS found FROM person_index WHERE auth_user_id = ? LIMIT 1", userId)).pipe(
        Effect.map((rows) => rows.length > 0),
      );

    const accountStatements: readonly (readonly [string, number])[] = [
      ["DELETE FROM captured_email WHERE recipient = (SELECT email FROM auth_user WHERE id = ?)", 1],
      [
        `DELETE FROM auth_verification
          WHERE identifier IN (
            SELECT 'sign-in-otp-' || email FROM auth_user WHERE id = ?
            UNION ALL
            SELECT 'forget-password-otp-' || email FROM auth_user WHERE id = ?
            UNION ALL
            SELECT 'email-verification-otp-' || email FROM auth_user WHERE id = ?
            UNION ALL
            SELECT 'change-email-otp-' || id || ':' || email FROM auth_user WHERE id = ?
          )
          OR substr(identifier, 1, length('change-email-otp-' || ? || ':')) = 'change-email-otp-' || ? || ':'`,
        6,
      ],
      [
        "DELETE FROM auth_session_organization WHERE session_id IN (SELECT id FROM auth_session WHERE userId = ?)",
        1,
      ],
      ["DELETE FROM auth_session WHERE userId = ?", 1],
      ["DELETE FROM auth_account WHERE userId = ?", 1],
      ["DELETE FROM auth_passkey WHERE userId = ?", 1],
      ["DELETE FROM auth_member WHERE userId = ?", 1],
      [
        "DELETE FROM auth_invitation WHERE inviterId = ? OR email = (SELECT email FROM auth_user WHERE id = ?)",
        2,
      ],
      ["DELETE FROM organization_claim WHERE auth_user_id = ?", 1],
      ["DELETE FROM email_rectification WHERE auth_user_id = ?", 1],
      ["DELETE FROM auth_user WHERE id = ?", 1],
    ];

    const deleteAccount = (userId: AuthUserId) =>
      Effect.forEach(
        accountStatements,
        ([statement, binds]) => write(statement, ...Array.from({ length: binds }, () => userId)),
        { discard: true },
      );

    return PeopleIndex.of({
      linkedPersons: (userId) =>
        run(
          all(
            `SELECT p.organization_id, o.name, p.person_id, 1 AS linked
               FROM person_index p JOIN organization_index o ON o.organization_id = p.organization_id
              WHERE p.auth_user_id = ? AND p.removed_at IS NULL
              ORDER BY p.organization_id`,
            userId,
          ).pipe(Effect.flatMap(decodeRows(CandidateRow))),
        ).pipe(Effect.map((rows) => rows.map(toCandidate))),

      unlinkedPersons: (email) =>
        run(
          all(
            `SELECT p.organization_id, o.name, p.person_id, 0 AS linked
               FROM person_index p JOIN organization_index o ON o.organization_id = p.organization_id
              WHERE p.email = ? AND p.auth_user_id IS NULL AND p.removed_at IS NULL
              ORDER BY p.organization_id`,
            normaliseEmail(email),
          ).pipe(Effect.flatMap(decodeRows(CandidateRow))),
        ).pipe(Effect.map((rows) => rows.map(toCandidate))),

      putOrganization: (organization) =>
        write(
          `INSERT INTO organization_index (organization_id, name) VALUES (?, ?)
           ON CONFLICT (organization_id) DO UPDATE SET name = excluded.name`,
          organization.id,
          organization.name,
        ),

      putPerson: (person) =>
        write(
          `INSERT INTO person_index (organization_id, person_id, email, auth_user_id) VALUES (?, ?, ?, ?)
           ON CONFLICT (organization_id, person_id) DO UPDATE SET
             auth_user_id = coalesce(auth_user_id, excluded.auth_user_id),
             removed_at = NULL`,
          person.organizationId,
          person.personId,
          EmailAddress.make(normaliseEmail(person.email)),
          Option.getOrNull(person.userId),
        ),

      removePerson: (organizationId, personId) =>
        write(
          `UPDATE person_index SET removed_at = unixepoch() * 1000
            WHERE organization_id = ? AND person_id = ? AND removed_at IS NULL`,
          organizationId,
          personId,
        ),

      correctEmail: (organizationId, personId, email) =>
        write(
          `UPDATE person_index SET email = ?
            WHERE organization_id = ? AND person_id = ? AND auth_user_id IS NULL`,
          EmailAddress.make(normaliseEmail(email)),
          organizationId,
          personId,
        ),

      erasePerson: (erased) =>
        Effect.gen(function* () {
          const { organizationId, personId } = erased;

          const indexed = yield* run(
            all(
              "SELECT auth_user_id FROM person_index WHERE organization_id = ? AND person_id = ?",
              organizationId,
              personId,
            ).pipe(Effect.flatMap(decodeRows(IndexedRow))),
          );

          const userId = Option.orElse(erased.userId, () => Option.fromNullishOr(indexed[0]?.auth_user_id));

          const sendIds = JSON.stringify(erased.sendIds);
          const testTokenHashes = JSON.stringify(erased.testTokenHashes);

          yield* write(
            "DELETE FROM invitation_index WHERE organization_id = ? AND person_id = ?",
            organizationId,
            personId,
          );
          yield* write(
            `DELETE FROM test_invitation_index
              WHERE organization_id = ? AND token_hash IN (SELECT value FROM json_each(?))`,
            organizationId,
            testTokenHashes,
          );
          yield* write(
            `DELETE FROM captured_email WHERE message_id IN (
               SELECT message_id FROM email_message
                WHERE organization_id = ? AND send_id IN (SELECT value FROM json_each(?)))`,
            organizationId,
            sendIds,
          );
          yield* write(
            "DELETE FROM email_message WHERE organization_id = ? AND send_id IN (SELECT value FROM json_each(?))",
            organizationId,
            sendIds,
          );
          yield* write(
            "DELETE FROM person_index WHERE organization_id = ? AND person_id = ?",
            organizationId,
            personId,
          );

          if (Option.isNone(userId)) {
            return;
          }

          yield* write(
            `DELETE FROM auth_session_organization
              WHERE organization_id = ? AND session_id IN (SELECT id FROM auth_session WHERE userId = ?)`,
            organizationId,
            userId.value,
          );
          yield* write(
            "DELETE FROM organization_claim WHERE auth_user_id = ? AND organization_id = ?",
            userId.value,
            organizationId,
          );

          if (!(yield* hasPersons(userId.value))) {
            yield* deleteAccount(userId.value);
          }
        }),

      eraseAccount: (userId) =>
        Effect.gen(function* () {
          if (yield* hasPersons(userId)) {
            return false;
          }

          yield* deleteAccount(userId);

          return true;
        }),

      linkPerson: (organizationId, personId, userId) =>
        write(
          `UPDATE person_index SET auth_user_id = ?
            WHERE organization_id = ? AND person_id = ? AND auth_user_id IS NULL AND removed_at IS NULL`,
          userId,
          organizationId,
          personId,
        ),

      claimOrganization: (userId, proposed) =>
        write(
          `INSERT INTO organization_claim (auth_user_id, organization_id, name, admin_person_id)
           VALUES (?, ?, ?, ?) ON CONFLICT (auth_user_id) DO NOTHING`,
          userId,
          proposed.organization.id,
          proposed.organization.name,
          proposed.adminPersonId,
        ).pipe(
          Effect.andThen(claimOf(userId)),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.die("organization_claim row vanished after insert"),
              onSome: Effect.succeed,
            }),
          ),
        ),

      claimOf,

      completeClaim: (userId, now) =>
        write(
          "UPDATE organization_claim SET completed_at = ? WHERE auth_user_id = ? AND completed_at IS NULL",
          now,
          userId,
        ),
    });
  });
