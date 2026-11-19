import { passkey } from "@better-auth/passkey";
import { days, minutes, Policy, toSeconds } from "@surveybeat/domain";
import { betterAuth } from "better-auth";
import type { Auth, BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { admin, emailOTP, magicLink, organization } from "better-auth/plugins";
import * as Effect from "effect/Effect";

export const SESSION_COOKIE = "__Host-surveybeat-session";
export const SESSION_TTL_SECONDS = toSeconds(days(Policy.signIn.sessionDays));
export const CODE_TTL_SECONDS = toSeconds(minutes(Policy.signIn.codeMinutes));
export const MAGIC_LINK_TTL_SECONDS = toSeconds(minutes(Policy.signIn.magicLinkMinutes));

export const AUTH_TABLES = {
  user: "auth_user",
  session: "auth_session",
  account: "auth_account",
  verification: "auth_verification",
  organization: "auth_organization",
  member: "auth_member",
  invitation: "auth_invitation",
  passkey: "auth_passkey",
} as const;

export interface AuthSettings {
  readonly baseURL: string;
  readonly secret: string;
  readonly trustedOrigins: readonly string[];
}

export interface CodeDelivery {
  readonly sendSignInCode: (code: { readonly email: string; readonly otp: string }) => Effect.Effect<void>;
  readonly sendMagicLink: (link: { readonly email: string; readonly url: string }) => Effect.Effect<void>;
}

export type SurveyBeatAuthOptions = Omit<BetterAuthOptions, "baseURL" | "database" | "secret" | "plugins">;

export const authPlugins = (delivery: CodeDelivery): BetterAuthPlugin[] => [
  emailOTP({
    otpLength: Policy.signIn.codeDigits,
    expiresIn: CODE_TTL_SECONDS,
    allowedAttempts: Policy.signIn.codeAttempts,
    sendVerificationOTP: ({ email, otp, type }) =>
      type === "sign-in" ? Effect.runPromise(delivery.sendSignInCode({ email, otp })) : Promise.resolve(),
  }),
  magicLink({
    expiresIn: MAGIC_LINK_TTL_SECONDS,
    sendMagicLink: ({ email, url }) => Effect.runPromise(delivery.sendMagicLink({ email, url })),
  }),
  admin({ defaultRole: "user", adminRoles: ["admin"] }),
  organization({
    allowUserToCreateOrganization: false,
    schema: {
      organization: { modelName: AUTH_TABLES.organization },
      member: { modelName: AUTH_TABLES.member },
      invitation: { modelName: AUTH_TABLES.invitation },
    },
  }),
  passkey({
    rpName: "SurveyBeat",
    schema: { passkey: { modelName: AUTH_TABLES.passkey } },
  }),
];

export const authOptions = (
  delivery: CodeDelivery,
): SurveyBeatAuthOptions & { plugins: BetterAuthPlugin[] } => ({
  appName: "SurveyBeat",
  basePath: "/auth",
  trustedOrigins: [
    "https://surveybeat.app",
    "https://*.surveybeat.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ],
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
  plugins: authPlugins(delivery),
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
      [AUTH_TABLES.organization]: [],
      [AUTH_TABLES.member]: [],
      [AUTH_TABLES.invitation]: [],
      [AUTH_TABLES.passkey]: [],
    }),
  });
