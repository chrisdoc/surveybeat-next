import { betterAuth, type Auth, type BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { emailOTP } from "better-auth/plugins";

export const SESSION_COOKIE = "__Host-surveybeat-session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const CODE_TTL_SECONDS = 600;

export interface AuthSettings {
  readonly baseURL: string;
  readonly secret: string;
  readonly trustedOrigins: ReadonlyArray<string>;
}

export interface CodeDelivery {
  readonly sendSignInCode: (code: { readonly email: string; readonly otp: string }) => Promise<void>;
}

export const createAuth = (params: {
  readonly settings: AuthSettings;
  readonly delivery: CodeDelivery;
  readonly database?: BetterAuthOptions["database"];
}): Auth => {
  const options: BetterAuthOptions = {
    appName: "SurveyBeat",
    basePath: "/auth",
    baseURL: params.settings.baseURL,
    secret: params.settings.secret,
    trustedOrigins: [...params.settings.trustedOrigins],
    database: params.database,
    session: { expiresIn: SESSION_TTL_SECONDS, updateAge: 24 * 60 * 60 },
    advanced: {
      useSecureCookies: true,
      cookies: { session_token: { name: SESSION_COOKIE } },
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: CODE_TTL_SECONDS,
        allowedAttempts: 5,
        sendVerificationOTP: ({ email, otp, type }) =>
          type === "sign-in" ? params.delivery.sendSignInCode({ email, otp }) : Promise.resolve(),
      }),
    ],
  };
  return betterAuth(options);
};

export const memoryAuth = (delivery: CodeDelivery): Auth =>
  createAuth({
    settings: {
      baseURL: "http://localhost:5173",
      secret: "surveybeat-memory-test-secret-000000000000",
      trustedOrigins: ["http://localhost:5173"],
    },
    delivery,
    database: memoryAdapter({ account: [], session: [], user: [], verification: [] }),
  });
