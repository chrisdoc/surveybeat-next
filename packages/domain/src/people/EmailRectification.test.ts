import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Option, Redacted } from "effect";
import { EmailAddress } from "../email/Email.ts";
import { OrganizationDirectory } from "./DirectoryFlow.ts";
import type { CommandResult } from "./DirectoryFlow.ts";
import { AuthUnavailable } from "./SignIn.ts";
import { SignInAgainRequired, WrongEmailCode } from "./EmailErrors.ts";
import {
  confirmEmailChange,
  correctPersonEmail,
  EmailRectification,
  requestEmailChange,
} from "./EmailRectification.ts";
import type { PendingEmailChange } from "./EmailRectification.ts";
import { AuthUserId, identityOf, parseRectifiedEmail, PersonId, SessionId } from "./Identity.ts";
import { OrganizationId } from "./Organization.ts";
import { SessionIdentityProvider } from "./SessionIdentity.ts";
import { PeopleIndex } from "./SignInPorts.ts";
import type { SessionIdentityProviderShape, SignedInSession } from "./SessionIdentity.ts";
import type { Member } from "./SignInFlow.ts";

const ADA = AuthUserId.make("user_ada");

const COOKIE = Redacted.make("cookie");

const ACME = OrganizationId.make("acme");

const GLOBEX = OrganizationId.make("globex");

const sessionWith = (email: string): SignedInSession => ({
  identity: identityOf(ADA, email, true),
  sessionId: SessionId.make("session"),
});

const email = (text: string) => EmailAddress.make(text);

describe("parseRectifiedEmail", () => {
  const accepted: readonly (readonly [string, string])[] = [
    ["ada@example.com", "ada@example.com"],
    ["  Ada.Lovelace@Example.COM  ", "ada.lovelace@example.com"],
    ["ａda@example.com", "ada@example.com"],
    ["ada+news@sub.example.co.uk", "ada+news@sub.example.co.uk"],
  ];

  it.each(accepted)("normalises %j to %j", (input, expected) => {
    expect(parseRectifiedEmail(input)).toEqual(Option.some(expected));
  });

  const refused: readonly string[] = [
    "",
    "   ",
    "ada",
    "ada@example",
    "a da@example.com",
    "ada@exa mple.com",
    "ädä@example.com",
    "ada@exämple.com",
    "ada@example.com\u0000",
    "ada\t@example.com",
    "<ada>@example.com",
    "ada@@example.com",
    "ada@example.com x",
    "ada@例え.jp",
  ];

  it.each(refused)("refuses %j", (input) => {
    expect(parseRectifiedEmail(input)).toEqual(Option.none());
  });

  it("only returns addresses the SQL check and the sign-in match accept", () => {
    const inputs = [
      ...accepted.map(([input]) => input),
      ...refused,
      "MIXED@Case.Example",
      " pad@example.org\n",
    ];

    for (const input of inputs) {
      for (const parsed of Option.toArray(parseRectifiedEmail(input))) {
        expect(parsed).toBe(parsed.trim().toLowerCase());
        expect(parsed).toMatch(/^[ -~]+$/);
        expect(parsed).toMatch(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/);
      }
    }
  });
});

interface World {
  readonly calls: string[];
  current: string;
  pending: Option.Option<PendingEmailChange>;
  readonly takenByOthers: Set<string>;
  readonly takenByAny: Set<string>;
  readonly organizations: OrganizationId[];
  code: "right" | "wrong" | "stale" | "unavailable";
  lookups: number;
}

const newWorld = (): World => ({
  calls: [],
  current: "ada@example.com",
  pending: Option.none(),
  takenByOthers: new Set(),
  takenByAny: new Set(),
  organizations: [ACME, GLOBEX],
  code: "right",
  lookups: 0,
});

const run = <A, E>(
  world: World,
  effect: Effect.Effect<
    A,
    E,
    EmailRectification | SessionIdentityProvider | OrganizationDirectory | PeopleIndex
  >,
) => {
  const rectification = EmailRectification.of({
    takenByAnotherAccount: (_userId, address) =>
      Effect.sync(() => {
        world.lookups += 1;

        return world.takenByOthers.has(address);
      }),
    takenByAnyAccount: (address) =>
      Effect.sync(() => {
        world.lookups += 1;

        return world.takenByAny.has(address);
      }),
    pending: () => Effect.sync(() => world.pending),
    begin: (_userId, change) =>
      Effect.sync(() => {
        world.calls.push(`begin ${change.oldEmail} ${change.newEmail}`);
        world.pending = Option.some(change);
      }),
    abandon: (_userId, newEmail) =>
      Effect.sync(() => {
        world.calls.push(`abandon ${newEmail}`);
        world.pending = Option.none();
      }),
    moveIndex: (_userId, address) =>
      Effect.sync(() => {
        world.calls.push(`moveIndex ${address}`);

        return world.organizations;
      }),
    finish: () =>
      Effect.sync(() => {
        world.calls.push("finish");
        world.pending = Option.none();
      }),
  });

  const sessions: Pick<SessionIdentityProviderShape, "requestEmailChange" | "confirmEmailChange"> = {
    requestEmailChange: (_cookie, address) =>
      Effect.suspend(() => {
        world.calls.push(`code ${address}`);

        return world.code === "stale" ? Effect.fail(new SignInAgainRequired()) : Effect.void;
      }),
    confirmEmailChange: (_cookie, address) =>
      Effect.suspend(
        (): Effect.Effect<Option.Option<string>, SignInAgainRequired | WrongEmailCode | AuthUnavailable> => {
          world.calls.push(`change ${address}`);

          switch (world.code) {
            case "wrong": {
              return Effect.fail(new WrongEmailCode());
            }

            case "stale": {
              return Effect.fail(new SignInAgainRequired());
            }

            case "unavailable": {
              return Effect.fail(new AuthUnavailable());
            }

            case "right": {
              world.current = address;

              return Effect.succeedSome("new-token");
            }
          }
        },
      ),
  };

  const directory: Pick<OrganizationDirectory["Service"], "rectifyEmail" | "run"> = {
    rectifyEmail: (organizationId, _userId, address) =>
      Effect.sync(() => {
        world.calls.push(`rectify ${organizationId} ${address}`);
      }),
    run: (): Effect.Effect<CommandResult> =>
      Effect.sync(() => {
        world.calls.push("command");

        return { _tag: "Accepted", followUps: [] };
      }),
  };

  return effect.pipe(
    Effect.provideService(EmailRectification, rectification),
    Effect.provideService(SessionIdentityProvider, sessions as unknown as SessionIdentityProviderShape),
    Effect.provideService(OrganizationDirectory, directory as unknown as OrganizationDirectory["Service"]),
    Effect.provideService(PeopleIndex, {} as unknown as PeopleIndex["Service"]),
    Effect.exit,
  );
};

const failureTag = (exit: Exit.Exit<unknown, { readonly _tag: string }>): string => {
  if (Exit.isSuccess(exit)) {
    return "Success";
  }

  const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");

  return failure === undefined ? "Defect" : failure.error._tag;
};

describe("asking for a code to change the address", () => {
  it.effect("sends the code for the normalised new address", () =>
    Effect.gen(function* () {
      const world = newWorld();

      const exit = yield* run(
        world,
        requestEmailChange(COOKIE, sessionWith(world.current), "  New@Example.com "),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(world.calls).toEqual(["code new@example.com"]);
    }),
  );

  const unsendable: readonly (readonly [string, string, string])[] = [
    ["an address with a non-ASCII letter", "ädä@example.com", "EmailUnusable"],
    ["not an address", "ada", "EmailUnusable"],
    ["the current address", " ADA@example.com", "EmailUnchanged"],
  ];

  for (const [name, input, tag] of unsendable) {
    it.effect(`refuses ${name} and sends nothing`, () =>
      Effect.gen(function* () {
        const world = newWorld();
        const exit = yield* run(world, requestEmailChange(COOKIE, sessionWith(world.current), input));

        expect(failureTag(exit)).toBe(tag);
        expect(world.calls).toEqual([]);
      }),
    );
  }

  it.effect(
    "refuses an address another account or an unlinked Person already has, instead of staying silent",
    () =>
      Effect.gen(function* () {
        const world = newWorld();
        world.takenByOthers.add("taken@example.com");

        const exit = yield* run(
          world,
          requestEmailChange(COOKIE, sessionWith(world.current), "Taken@example.com"),
        );

        expect(failureTag(exit)).toBe("EmailTaken");
        expect(world.calls).toEqual([]);
      }),
  );

  it.effect("refuses a different address while the account already holds the pending one", () =>
    Effect.gen(function* () {
      const world = newWorld();
      world.current = "pending@example.com";
      world.pending = Option.some({
        oldEmail: email("ada@example.com"),
        newEmail: email("pending@example.com"),
      });

      const exit = yield* run(
        world,
        requestEmailChange(COOKIE, sessionWith(world.current), "other@example.com"),
      );

      expect(failureTag(exit)).toBe("EmailChangePending");
      expect(world.calls).toEqual([]);
    }),
  );

  it.effect("tells the Person to sign in again when Better Auth finds the session stale", () =>
    Effect.gen(function* () {
      const world = newWorld();
      world.code = "stale";

      const exit = yield* run(
        world,
        requestEmailChange(COOKIE, sessionWith(world.current), "new@example.com"),
      );

      expect(failureTag(exit)).toBe("SignInAgainRequired");
    }),
  );
});

describe("confirming the new address", () => {
  it.effect(
    "moves the account, then the index, then every Organization, then forgets the pending change",
    () =>
      Effect.gen(function* () {
        const world = newWorld();

        const exit = yield* run(
          world,
          confirmEmailChange(COOKIE, sessionWith(world.current), "New@Example.com", "123456"),
        );

        expect(exit).toEqual(Exit.succeed(Option.some("new-token")));

        expect(world.calls).toEqual([
          "begin ada@example.com new@example.com",
          "change new@example.com",
          "moveIndex new@example.com",
          "rectify acme new@example.com",
          "rectify globex new@example.com",
          "finish",
        ]);
      }),
  );

  it.effect("leaves no pending change and moves nothing when the code is wrong", () =>
    Effect.gen(function* () {
      const world = newWorld();
      world.code = "wrong";

      const exit = yield* run(
        world,
        confirmEmailChange(COOKIE, sessionWith(world.current), "new@example.com", "000000"),
      );

      expect(failureTag(exit)).toBe("WrongEmailCode");
      expect(Option.isNone(world.pending)).toBe(true);
      expect(world.calls).toEqual([
        "begin ada@example.com new@example.com",
        "change new@example.com",
        "abandon new@example.com",
      ]);
    }),
  );

  it.effect("leaves no pending change when the session is stale", () =>
    Effect.gen(function* () {
      const world = newWorld();
      world.code = "stale";

      const exit = yield* run(
        world,
        confirmEmailChange(COOKIE, sessionWith(world.current), "new@example.com", "1"),
      );

      expect(failureTag(exit)).toBe("SignInAgainRequired");
      expect(Option.isNone(world.pending)).toBe(true);
      expect(world.calls).not.toContain("moveIndex new@example.com");
    }),
  );

  it.effect(
    "keeps the pending change when Better Auth does not answer, because the account may have moved",
    () =>
      Effect.gen(function* () {
        const world = newWorld();
        world.code = "unavailable";

        const exit = yield* run(
          world,
          confirmEmailChange(COOKIE, sessionWith(world.current), "new@example.com", "1"),
        );

        expect(failureTag(exit)).toBe("AuthUnavailable");
        expect(Option.isSome(world.pending)).toBe(true);
        expect(world.calls).not.toContain("moveIndex new@example.com");
      }),
  );

  const unwritable: readonly (readonly [string, string, string])[] = [
    ["an address another account or an unlinked Person has", "taken@example.com", "EmailTaken"],
    ["the current address", "ada@example.com", "EmailUnchanged"],
    ["an address with a non-ASCII letter", "ädä@example.com", "EmailUnusable"],
  ];

  for (const [name, input, tag] of unwritable) {
    it.effect(`writes nothing for ${name}`, () =>
      Effect.gen(function* () {
        const world = newWorld();
        world.takenByOthers.add("taken@example.com");

        const exit = yield* run(
          world,
          confirmEmailChange(COOKIE, sessionWith(world.current), input, "123456"),
        );

        expect(failureTag(exit)).toBe(tag);
        expect(world.calls).toEqual([]);
        expect(Option.isNone(world.pending)).toBe(true);
      }),
    );
  }

  it.effect("finishes an interrupted change for the same address without asking Better Auth again", () =>
    Effect.gen(function* () {
      const world = newWorld();
      world.current = "new@example.com";
      world.pending = Option.some({ oldEmail: email("ada@example.com"), newEmail: email("new@example.com") });

      const exit = yield* run(
        world,
        confirmEmailChange(COOKIE, sessionWith(world.current), "new@example.com", "stale-code"),
      );

      expect(exit).toEqual(Exit.succeed(Option.none()));

      expect(world.calls).toEqual([
        "moveIndex new@example.com",
        "rectify acme new@example.com",
        "rectify globex new@example.com",
        "finish",
      ]);
    }),
  );

  it.effect("refuses a different address until the interrupted change has finished", () =>
    Effect.gen(function* () {
      const world = newWorld();
      world.current = "new@example.com";
      world.pending = Option.some({ oldEmail: email("ada@example.com"), newEmail: email("new@example.com") });

      const exit = yield* run(
        world,
        confirmEmailChange(COOKIE, sessionWith(world.current), "other@example.com", "1"),
      );

      expect(failureTag(exit)).toBe("EmailChangePending");
      expect(world.calls).toEqual([]);
    }),
  );

  it.effect("replaces a pending change for another address while the account still has the old one", () =>
    Effect.gen(function* () {
      const world = newWorld();
      world.pending = Option.some({
        oldEmail: email("ada@example.com"),
        newEmail: email("abandoned@example.com"),
      });

      const exit = yield* run(
        world,
        confirmEmailChange(COOKIE, sessionWith(world.current), "new@example.com", "1"),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(world.calls[0]).toBe("begin ada@example.com new@example.com");
    }),
  );
});

const member = (organizationAdmin: boolean): Member => ({
  organization: { id: ACME, name: "Acme" },
  personId: PersonId.make("acme-admin"),
  organizationAdmin,
  locale: null,
  detectedLocale: null,
  organizationLocale: "en",
});

describe("an Organization admin correcting an address", () => {
  it.effect("runs the command for an address no account has", () =>
    Effect.gen(function* () {
      const world = newWorld();

      const exit = yield* run(
        world,
        correctPersonEmail(member(true), PersonId.make("acme-ada"), "New@Example.com"),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(world.calls).toEqual(["command"]);
    }),
  );

  it.effect("refuses an address an account or a signed-in Person has, before touching the Organization", () =>
    Effect.gen(function* () {
      const world = newWorld();
      world.takenByAny.add("taken@example.com");

      const exit = yield* run(
        world,
        correctPersonEmail(member(true), PersonId.make("acme-ada"), "taken@example.com"),
      );

      expect(failureTag(exit)).toBe("EmailTaken");
      expect(world.calls).toEqual([]);
    }),
  );

  it.effect("does not look anything up for a caller who is not an Organization admin", () =>
    Effect.gen(function* () {
      const world = newWorld();
      world.takenByAny.add("taken@example.com");

      const exit = yield* run(
        world,
        correctPersonEmail(member(false), PersonId.make("acme-ada"), "taken@example.com"),
      );

      expect(failureTag(exit)).toBe("Forbidden");
      expect(world.lookups).toBe(0);
      expect(world.calls).toEqual([]);
    }),
  );

  it.effect("refuses an unusable address", () =>
    Effect.gen(function* () {
      const world = newWorld();

      const exit = yield* run(
        world,
        correctPersonEmail(member(true), PersonId.make("acme-ada"), "ädä@example.com"),
      );

      expect(failureTag(exit)).toBe("EmailUnusable");
      expect(world.calls).toEqual([]);
    }),
  );
});
