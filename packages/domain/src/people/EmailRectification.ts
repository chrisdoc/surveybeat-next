import { Context, Effect, Option } from "effect";
import type { Redacted } from "effect";
import type { EmailAddress } from "../email/Email.ts";
import { runDirectoryCommand, OrganizationDirectory } from "./DirectoryFlow.ts";
import { EmailChangePending, EmailTaken, EmailUnchanged, EmailUnusable } from "./EmailErrors.ts";
import { parseRectifiedEmail } from "./Identity.ts";
import type { AuthUserId, PersonId } from "./Identity.ts";
import type { OrganizationId } from "./Organization.ts";
import { SessionIdentityProvider } from "./SessionIdentity.ts";
import type { SignedInSession } from "./SessionIdentity.ts";
import { Forbidden } from "./SignIn.ts";
import type { Member } from "./SignInFlow.ts";

export interface PendingEmailChange {
  readonly oldEmail: EmailAddress;
  readonly newEmail: EmailAddress;
}

export interface EmailRectificationShape {
  readonly takenByAnotherAccount: (userId: AuthUserId, email: EmailAddress) => Effect.Effect<boolean>;

  readonly takenByAnyAccount: (email: EmailAddress) => Effect.Effect<boolean>;

  readonly pending: (userId: AuthUserId) => Effect.Effect<Option.Option<PendingEmailChange>>;

  readonly begin: (userId: AuthUserId, change: PendingEmailChange) => Effect.Effect<void>;

  readonly abandon: (userId: AuthUserId, newEmail: EmailAddress) => Effect.Effect<void>;

  readonly moveIndex: (userId: AuthUserId, email: EmailAddress) => Effect.Effect<readonly OrganizationId[]>;

  readonly finish: (userId: AuthUserId) => Effect.Effect<void>;
}

export class EmailRectification extends Context.Service<EmailRectification, EmailRectificationShape>()(
  "@surveybeat/domain/EmailRectification",
) {}

const usable = (input: string) =>
  Effect.fromOption(parseRectifiedEmail(input)).pipe(Effect.mapError(() => new EmailUnusable()));

const finishChange = Effect.fnUntraced(function* (userId: AuthUserId, email: EmailAddress) {
  const rectification = yield* EmailRectification;
  const directory = yield* OrganizationDirectory;

  const organizations = yield* rectification.moveIndex(userId, email);

  for (const organizationId of organizations) {
    yield* directory.rectifyEmail(organizationId, userId, email);
  }

  yield* rectification.finish(userId);
});

export const resumeEmailChange = Effect.fnUntraced(function* (session: SignedInSession) {
  const rectification = yield* EmailRectification;
  const pending = yield* rectification.pending(session.identity.userId);

  if (Option.isSome(pending) && pending.value.newEmail === session.identity.email) {
    yield* finishChange(session.identity.userId, session.identity.email);
  }
});

export const requestEmailChange = Effect.fnUntraced(function* (
  cookie: Redacted.Redacted,
  session: SignedInSession,
  input: string,
) {
  const email = yield* usable(input);
  const rectification = yield* EmailRectification;
  const { userId } = session.identity;
  const current = session.identity.email;

  if (email === current) {
    yield* resumeEmailChange(session);

    return yield* new EmailUnchanged();
  }

  const pending = yield* rectification.pending(userId);

  if (Option.isSome(pending) && pending.value.newEmail === current) {
    return yield* new EmailChangePending();
  }

  if (yield* rectification.takenByAnotherAccount(userId, email)) {
    return yield* new EmailTaken();
  }

  yield* (yield* SessionIdentityProvider).requestEmailChange(cookie, email);
});

export const confirmEmailChange = Effect.fnUntraced(function* (
  cookie: Redacted.Redacted,
  session: SignedInSession,
  input: string,
  code: string,
) {
  const email = yield* usable(input);
  const rectification = yield* EmailRectification;
  const { userId } = session.identity;
  const current = session.identity.email;
  const pending = yield* rectification.pending(userId);

  if (Option.isSome(pending) && pending.value.newEmail === current) {
    if (email !== current) {
      return yield* new EmailChangePending();
    }

    yield* finishChange(userId, email);

    return Option.none<string>();
  }

  if (email === current) {
    return yield* new EmailUnchanged();
  }

  if (yield* rectification.takenByAnotherAccount(userId, email)) {
    return yield* new EmailTaken();
  }

  yield* rectification.begin(userId, { oldEmail: current, newEmail: email });

  const token = yield* (yield* SessionIdentityProvider)
    .confirmEmailChange(cookie, email, code)
    .pipe(
      Effect.tapError((error) =>
        error._tag === "AuthUnavailable" ? Effect.void : rectification.abandon(userId, email),
      ),
    );

  yield* finishChange(userId, email);

  return token;
});

export const correctPersonEmail = Effect.fnUntraced(function* (
  member: Member,
  personId: PersonId,
  input: string,
) {
  const email = yield* usable(input);

  if (!member.organizationAdmin) {
    return yield* new Forbidden();
  }

  if (yield* (yield* EmailRectification).takenByAnyAccount(email)) {
    return yield* new EmailTaken();
  }

  yield* runDirectoryCommand(member, { _tag: "CorrectEmail", personId, email });
});
