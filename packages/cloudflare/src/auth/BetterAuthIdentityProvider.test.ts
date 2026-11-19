import { describe, expect, it } from "@effect/vitest";
import { SESSION_COOKIE, memoryAuth } from "@surveybeat/auth";
import type { SessionId } from "@surveybeat/domain";
import { OrganizationId } from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { betterAuthIdentityProvider } from "./BetterAuthIdentityProvider.ts";

const origin = "http://localhost:5173";

const address = "person@example.com";

const sessionValue = (response: Response): string => {
  const pair = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

  return pair.slice(`${SESSION_COOKIE}=`.length);
};

const signedIn = () =>
  Effect.gen(function* () {
    const codes: string[] = [];
    const sent: string[] = [];

    const auth = memoryAuth({
      sendSignInCode: ({ otp }) =>
        Effect.sync(() => {
          codes.push(otp);
        }),
      sendMagicLink: () => Effect.void,
    });

    yield* Effect.promise(() =>
      auth.handler(
        new Request(`${origin}/auth/email-otp/send-verification-otp`, {
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify({ email: address, type: "sign-in" }),
        }),
      ),
    );

    const response = yield* Effect.promise(() =>
      auth.handler(
        new Request(`${origin}/auth/sign-in/email-otp`, {
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify({ email: address, otp: codes[0] ?? "" }),
        }),
      ),
    );

    const chosen = new Map<SessionId, OrganizationId>();

    const provider = betterAuthIdentityProvider({
      auth,
      chosenOrganization: (sessionId) => Effect.sync(() => Option.fromNullishOr(chosen.get(sessionId))),
      rememberOrganization: (sessionId, organizationId) =>
        Effect.sync(() => {
          chosen.set(sessionId, organizationId);
        }),
      deleteSession: (sessionId) =>
        Effect.sync(() => {
          sent.push(sessionId);
        }),
    });

    return { provider, sent, chosen, value: sessionValue(response) };
  });

const organizationIds = ["organization-1", "organization-2"] as const;

describe("Better Auth identity provider", () => {
  it.effect("reads the Person's identity from the session cookie", () =>
    Effect.gen(function* () {
      const { provider, value } = yield* signedIn();
      const session = yield* provider.authenticate(Redacted.make(value));
      expect(session.identity.email).toBe(address);
      expect(session.identity.emailVerified).toBe(true);
      expect(session.identity.emailMatchable).toBe(true);
      expect(session.sessionId.length).toBeGreaterThan(0);
    }),
  );

  it.effect("refuses a cookie no session answers", () =>
    Effect.gen(function* () {
      const { provider } = yield* signedIn();
      const refused = yield* provider.authenticate(Redacted.make("not-a-session-token")).pipe(Effect.flip);
      expect(refused._tag).toBe("Unauthenticated");
    }),
  );

  it.effect("mails a code and turns it into a session token", () =>
    Effect.gen(function* () {
      const codes: string[] = [];

      const auth = memoryAuth({
        sendSignInCode: ({ otp }) =>
          Effect.sync(() => {
            codes.push(otp);
          }),
        sendMagicLink: () => Effect.void,
      });

      const provider = betterAuthIdentityProvider({
        auth,
        chosenOrganization: () => Effect.succeedNone,
        rememberOrganization: () => Effect.void,
        deleteSession: () => Effect.void,
      });

      yield* provider.sendSignInCode(address);
      expect(codes).toHaveLength(1);

      const token = yield* provider.verifySignInCode(address, codes[0] ?? "");
      const session = yield* provider.authenticate(Redacted.make(Option.getOrThrow(token)));
      expect(session.identity.email).toBe(address);

      const rejected = yield* provider.verifySignInCode(address, "000000");
      expect(Option.isNone(rejected)).toBe(true);
    }),
  );

  it.effect("remembers the chosen Organization beside the session", () =>
    Effect.gen(function* () {
      const { provider, chosen, value } = yield* signedIn();
      const session = yield* provider.authenticate(Redacted.make(value));
      expect(yield* provider.chosenOrganization(session.sessionId)).toEqual(Option.none());
      const [first, second] = organizationIds;
      yield* provider.chooseOrganization(session.sessionId, OrganizationId.make(first));
      yield* provider.chooseOrganization(session.sessionId, OrganizationId.make(second));
      expect(yield* provider.chosenOrganization(session.sessionId)).toEqual(
        Option.some(OrganizationId.make(second)),
      );
      expect(chosen.size).toBe(1);
    }),
  );

  it.effect("deletes the session row by its id", () =>
    Effect.gen(function* () {
      const { provider, sent, value } = yield* signedIn();
      const session = yield* provider.authenticate(Redacted.make(value));
      yield* provider.revokeSession(session.sessionId);
      expect(sent).toEqual([session.sessionId]);
    }),
  );
});
