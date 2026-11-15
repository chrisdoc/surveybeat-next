import { betterAuth, type Auth, type BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { emailOTP } from "better-auth/plugins";
import * as Effect from "effect/Effect";

export const SESSION_COOKIE = "__Host-surveybeat-session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const CODE_TTL_SECONDS = 600;

export const AUTH_TABLES = {
  user: "auth_user",
  session: "auth_session",
  account: "auth_account",
  verification: "auth_verification",
} as const;

export interface AuthSettings {
  readonly baseURL: string;
  readonly secret: string;
  readonly trustedOrigins: ReadonlyArray<string>;
}

export interface CodeDelivery {
  readonly sendSignInCode: (code: { readonly email: string; readonly otp: string }) => Effect.Effect<void>;
}

export type SurveyBeatAuthOptions = Omit<BetterAuthOptions, "baseURL" | "database" | "secret">;

export const authOptions = (delivery: CodeDelivery): SurveyBeatAuthOptions => ({
  appName: "SurveyBeat",
  basePath: "/auth",
  session: {
    expiresIn: SESSION_TTL_SECONDS,
    updateAge: 24 * 60 * 60,
    modelName: AUTH_TABLES.session,
  },
  user: { modelName: AUTH_TABLES.user },
  account: { modelName: AUTH_TABLES.account },
  verification: { modelName: AUTH_TABLES.verification },
  advanced: {
    useSecureCookies: false,
    cookies: { session_token: { name: SESSION_COOKIE } },
    defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: CODE_TTL_SECONDS,
      allowedAttempts: 5,
      sendVerificationOTP: ({ email, otp, type }) =>
        type === "sign-in" ? Effect.runPromise(delivery.sendSignInCode({ email, otp })) : Promise.resolve(),
    }),
  ],
});

export const createAuth = (params: {
  readonly settings: AuthSettings;
  readonly delivery: CodeDelivery;
  readonly database?: BetterAuthOptions["database"];
}): Auth => {
  const options: BetterAuthOptions = {
    ...authOptions(params.delivery),
    baseURL: params.settings.baseURL,
    secret: params.settings.secret,
    trustedOrigins: [...params.settings.trustedOrigins],
    ...(params.database === undefined ? {} : { database: params.database }),
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
    database: memoryAdapter({
      [AUTH_TABLES.account]: [],
      [AUTH_TABLES.session]: [],
      [AUTH_TABLES.user]: [],
      [AUTH_TABLES.verification]: [],
    }),
  });
