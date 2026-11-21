import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { CODE_TTL_SECONDS, SESSION_COOKIE, createAuth, memoryAuth } from "./index.ts";

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

  it.effect("derives rpID from baseURL when configured", () =>
    Effect.gen(function* () {
      const codes: string[] = [];

      const auth = createAuth({
        settings: {
          baseURL: "https://dashboard.surveybeat.app",
          secret: "surveybeat-memory-test-secret-000000000000",
          trustedOrigins: ["https://dashboard.surveybeat.app", "http://localhost:5173"],
        },
        delivery: {
          sendSignInCode: ({ otp }) =>
            Effect.sync(() => {
              codes.push(otp);
            }),
          sendEmailChangeCode: () => Effect.void,
          sendMagicLink: () => Effect.void,
        },
      });

      const response = yield* Effect.promise(() =>
        auth.handler(
          new Request("https://dashboard.surveybeat.app/auth/passkey/generate-authenticate-options", {
            headers: { origin: "https://dashboard.surveybeat.app" },
          }),
        ),
      );

      expect(response.status).toBe(200);
      const body = (yield* Effect.promise(() => response.json())) as { rpId: string };
      expect(body.rpId).toBe("dashboard.surveybeat.app");
    }),
  );

  it.effect("registers, authenticates, renames, and deletes a passkey", () =>
    Effect.gen(function* () {
      const { auth, codes } = harness();
      yield* post(auth, "/auth/email-otp/send-verification-otp", { email: address, type: "sign-in" });
      const otpRes = yield* post(auth, "/auth/sign-in/email-otp", { email: address, otp: codes[0] ?? "" });
      const sessionCookie = cookiePair(otpRes);

      const cborBytes = (buf: Buffer): Buffer => {
        if (buf.length < 24) {
          return Buffer.concat([Buffer.from([0x40 + buf.length]), buf]);
        }

        return Buffer.concat([Buffer.from([0x58, buf.length]), buf]);
      };

      const cborText = (text: string): Buffer => {
        const buf = Buffer.from(text, "utf8");

        return Buffer.concat([Buffer.from([0x60 + buf.length]), buf]);
      };

      const cborInt = (n: number): Buffer => {
        if (n >= 0 && n < 24) {
          return Buffer.from([n]);
        }

        if (n < 0 && n >= -24) {
          return Buffer.from([0x20 + (-1 - n)]);
        }

        throw new Error(`Unsupported CBOR int ${n}`);
      };

      const sha256 = (data: Uint8Array): Effect.Effect<Buffer> =>
        Effect.promise(() => crypto.subtle.digest("SHA-256", Uint8Array.from(data))).pipe(
          Effect.map((buf) => Buffer.from(buf)),
        );

      const p1363ToDer = (sig: Uint8Array): Buffer => {
        const derInt = (part: Uint8Array): Uint8Array => {
          let start = 0;

          while (start < part.length - 1 && part[start] === 0) {
            start += 1;
          }

          const trimmed = part.subarray(start);
          const needsPad = (trimmed[0] ?? 0) >= 0x80;
          const out = new Uint8Array(trimmed.length + (needsPad ? 1 : 0));

          out.set(trimmed, needsPad ? 1 : 0);

          return out;
        };

        const r = derInt(sig.subarray(0, 32));
        const s = derInt(sig.subarray(32, 64));
        const total = 2 + r.length + 2 + s.length;
        const der = Buffer.alloc(2 + total);

        der[0] = 0x30;
        der[1] = total;
        der[2] = 0x02;
        der[3] = r.length;
        der.set(r, 4);
        der[4 + r.length] = 0x02;
        der[5 + r.length] = s.length;
        der.set(s, 6 + r.length);

        return der;
      };

      const credId = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
      const credIdB64 = credId.toString("base64url");

      const keyPair = yield* Effect.promise(() =>
        crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]),
      );

      const jwk = (yield* Effect.promise(() => crypto.subtle.exportKey("jwk", keyPair.publicKey))) as {
        x: string;
        y: string;
      };

      const x = Buffer.from(jwk.x, "base64url");
      const y = Buffer.from(jwk.y, "base64url");

      const coseKey = Buffer.concat([
        Buffer.from([0xa5]),
        cborInt(1),
        cborInt(2),
        cborInt(3),
        cborInt(-7),
        cborInt(-1),
        cborInt(1),
        cborInt(-2),
        cborBytes(x),
        cborInt(-3),
        cborBytes(y),
      ]);

      const regOptRes = yield* get(auth, "/auth/passkey/generate-register-options", sessionCookie);
      expect(regOptRes.status).toBe(200);
      const regCookie = (regOptRes.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

      const regOpts = (yield* Effect.promise(() => regOptRes.json())) as {
        challenge: string;
        rp: { id: string };
        authenticatorSelection: { residentKey: string; requireResidentKey: boolean };
      };

      expect(regOpts.authenticatorSelection.residentKey).toBe("required");
      expect(regOpts.authenticatorSelection.requireResidentKey).toBe(true);

      const rpIdHash = yield* sha256(new TextEncoder().encode(regOpts.rp.id));
      const aaguid = Buffer.from("ea9b8d664d011d213ce4b6b48cb575d4", "hex");
      const credLen = Buffer.alloc(2);
      credLen.writeUInt16BE(credId.length);

      const regAuthData = Buffer.concat([
        rpIdHash,
        Buffer.from([0x45]),
        Buffer.alloc(4),
        aaguid,
        credLen,
        credId,
        coseKey,
      ]);

      const attObj = Buffer.concat([
        Buffer.from([0xa3]),
        cborText("fmt"),
        cborText("none"),
        cborText("attStmt"),
        Buffer.from([0xa0]),
        cborText("authData"),
        cborBytes(regAuthData),
      ]);

      const regClientData = Buffer.from(
        JSON.stringify({ type: "webauthn.create", challenge: regOpts.challenge, origin }),
      ).toString("base64url");

      const verifyReg = yield* post(
        auth,
        "/auth/passkey/verify-registration",
        {
          response: {
            id: credIdB64,
            rawId: credIdB64,
            type: "public-key",
            authenticatorAttachment: "platform",
            response: {
              clientDataJSON: regClientData,
              attestationObject: attObj.toString("base64url"),
              transports: ["internal"],
            },
          },
          name: "Work laptop",
        },
        `${sessionCookie}; ${regCookie}`,
      );

      expect(verifyReg.status).toBe(200);
      const created = (yield* Effect.promise(() => verifyReg.json())) as { id: string; name: string };
      expect(created.name).toBe("Work laptop");

      const listed = yield* get(auth, "/auth/passkey/list-user-passkeys", sessionCookie);
      expect(listed.status).toBe(200);
      const passkeys = (yield* Effect.promise(() => listed.json())) as { id: string; name: string }[];
      expect(passkeys).toHaveLength(1);
      expect(passkeys[0]?.name).toBe("Work laptop");

      const renamed = yield* post(
        auth,
        "/auth/passkey/update-passkey",
        { id: created.id, name: "Personal Mac" },
        sessionCookie,
      );

      expect(renamed.status).toBe(200);

      const authOptRes = yield* get(auth, "/auth/passkey/generate-authenticate-options", "");
      expect(authOptRes.status).toBe(200);
      const authChallengeCookie = (authOptRes.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

      const authOpts = (yield* Effect.promise(() => authOptRes.json())) as {
        challenge: string;
        rpId: string;
      };

      const authClientDataBuf = Buffer.from(
        JSON.stringify({ type: "webauthn.get", challenge: authOpts.challenge, origin }),
      );

      const authData = Buffer.concat([
        yield* sha256(new TextEncoder().encode(authOpts.rpId)),
        Buffer.from([0x05]),
        Buffer.from([0, 0, 0, 1]),
      ]);

      const sigBase = Buffer.concat([authData, yield* sha256(authClientDataBuf)]);

      const rawSignature = yield* Effect.promise(() =>
        crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, Uint8Array.from(sigBase)),
      );

      const signature = p1363ToDer(new Uint8Array(rawSignature));

      const verifyAuth = yield* post(
        auth,
        "/auth/passkey/verify-authentication",
        {
          response: {
            id: credIdB64,
            rawId: credIdB64,
            type: "public-key",
            response: {
              clientDataJSON: authClientDataBuf.toString("base64url"),
              authenticatorData: authData.toString("base64url"),
              signature: signature.toString("base64url"),
            },
          },
        },
        authChallengeCookie,
      );

      expect(verifyAuth.status).toBe(200);
      const passkeySessionCookie = cookiePair(verifyAuth);
      expect(passkeySessionCookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);

      const sessionAfter = yield* get(auth, "/auth/get-session", passkeySessionCookie);
      expect(yield* Effect.promise(() => sessionAfter.json())).toMatchObject({
        user: { email: address },
      });

      const deleted = yield* post(
        auth,
        "/auth/passkey/delete-passkey",
        { id: created.id },
        passkeySessionCookie,
      );

      expect(deleted.status).toBe(200);

      const listedAfterDelete = yield* get(auth, "/auth/passkey/list-user-passkeys", passkeySessionCookie);
      expect(yield* Effect.promise(() => listedAfterDelete.json())).toEqual([]);
    }),
  );
});
