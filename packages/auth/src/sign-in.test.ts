import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { CODE_TTL_SECONDS, SESSION_COOKIE, memoryAuth } from "./index.ts";

const origin = "http://localhost:5173";

const address = "person@example.com";

const harness = () => {
  const codes: string[] = [];
  const links: string[] = [];

  const auth = memoryAuth({
    sendSignInCode: ({ otp }) =>
      Effect.sync(() => {
        codes.push(otp);
      }),
    sendEmailChangeCode: () => Effect.void,
    sendMagicLink: ({ url }) =>
      Effect.sync(() => {
        links.push(url);
      }),
  });

  return { auth, codes, links };
};

const post = (auth: ReturnType<typeof memoryAuth>, path: string, body: unknown, cookie?: string) =>
  Effect.promise(() =>
    auth.handler(
      new Request(`${origin}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          ...(cookie === undefined ? {} : { cookie }),
        },
        body: JSON.stringify(body),
      }),
    ),
  );

const get = (auth: ReturnType<typeof memoryAuth>, path: string, cookie: string) =>
  Effect.promise(() => auth.handler(new Request(`${origin}${path}`, { headers: { cookie, origin } })));

const cookiePair = (response: Response): string => {
  const [pair = ""] = (response.headers.get("set-cookie") ?? "").split(";");

  return pair;
};

describe("email code sign-in through Better Auth", () => {
  it.effect("issues the __Host session cookie with the product's attributes", () =>
    Effect.gen(function* () {
      const { auth, codes } = harness();

      const sent = yield* post(auth, "/auth/email-otp/send-verification-otp", {
        email: address,
        type: "sign-in",
      });

      expect(sent.status).toBe(200);
      expect(codes).toHaveLength(1);
      const otp = codes[0] ?? "";
      expect(otp).toMatch(/^\d{6}$/);

      const response = yield* post(auth, "/auth/sign-in/email-otp", { email: address, otp });
      expect(response.status).toBe(200);
      const setCookie = response.headers.get("set-cookie") ?? "";
      expect(setCookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Secure");
      expect(setCookie.toLowerCase()).toContain("samesite=lax");
      expect(setCookie).toContain("Path=/");
      expect(setCookie).not.toContain("Domain=");
      expect(CODE_TTL_SECONDS).toBe(600);
    }),
  );

  it.effect("reads the person from the session and drops it on sign-out", () =>
    Effect.gen(function* () {
      const { auth, codes } = harness();
      yield* post(auth, "/auth/email-otp/send-verification-otp", { email: address, type: "sign-in" });
      const response = yield* post(auth, "/auth/sign-in/email-otp", { email: address, otp: codes[0] ?? "" });
      const cookie = cookiePair(response);

      const session = yield* get(auth, "/auth/get-session", cookie);
      const body: unknown = yield* Effect.promise(() => session.json());
      expect(body).toMatchObject({ user: { email: address }, session: { userId: expect.any(String) } });

      const signedOut = yield* post(auth, "/auth/sign-out", {}, cookie);
      expect(signedOut.headers.get("set-cookie") ?? "").toContain(SESSION_COOKIE);

      const after = yield* get(auth, "/auth/get-session", cookie);
      expect(yield* Effect.promise(() => after.json())).toBeNull();
    }),
  );

  it.effect("refuses a wrong code", () =>
    Effect.gen(function* () {
      const { auth, codes } = harness();
      yield* post(auth, "/auth/email-otp/send-verification-otp", { email: address, type: "sign-in" });
      const wrong = codes[0] === "000000" ? "111111" : "000000";
      const response = yield* post(auth, "/auth/sign-in/email-otp", { email: address, otp: wrong });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.get("set-cookie")).toBeNull();
    }),
  );
});

describe("Better Auth plugins", () => {
  it.effect("signs in through the emailed link and gives the user the admin plugin's default role", () =>
    Effect.gen(function* () {
      const { auth, links } = harness();
      const sent = yield* post(auth, "/auth/sign-in/magic-link", { email: address });
      expect(sent.status).toBe(200);
      expect(links).toHaveLength(1);

      const link = new URL(links[0] ?? "");
      expect(link.pathname).toBe("/auth/magic-link/verify");
      expect((link.searchParams.get("token") ?? "").length).toBeGreaterThan(20);

      const verified = yield* Effect.promise(() =>
        auth.handler(new Request(link.toString(), { headers: { origin } })),
      );

      expect(verified.status).toBeLessThan(400);
      const cookie = cookiePair(verified);
      expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);

      const session = yield* get(auth, "/auth/get-session", cookie);
      const body: unknown = yield* Effect.promise(() => session.json());
      expect(body).toMatchObject({ user: { email: address, role: "user" } });
    }),
  );

  it.effect("keeps the passkey endpoints registered and closed to a visitor without a session", () =>
    Effect.gen(function* () {
      const { auth } = harness();
      const response = yield* get(auth, "/auth/passkey/generate-register-options", "");
      expect(response.status).toBe(401);
    }),
  );
});
