import { describe, expect, it } from "@effect/vitest";
import { SESSION_COOKIE, memoryAuth } from "@surveybeat/auth";
import * as Effect from "effect/Effect";
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
    const codes: Array<string> = [];
    const sent: Array<string> = [];
    const auth = memoryAuth({
      sendSignInCode: ({ otp }) =>
        Effect.sync(() => {
          codes.push(otp);
        }),
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
    const provider = betterAuthIdentityProvider({
      auth,
      deleteSession: (sessionId) =>
        Effect.sync(() => {
          sent.push(sessionId);
        }),
    });
    return { provider, sent, value: sessionValue(response) };
  });

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

  it.effect("deletes the session row by its id", () =>
    Effect.gen(function* () {
      const { provider, sent, value } = yield* signedIn();
      const session = yield* provider.authenticate(Redacted.make(value));
      yield* provider.revokeSession(session.sessionId);
      expect(sent).toEqual([session.sessionId]);
    }),
  );
});
