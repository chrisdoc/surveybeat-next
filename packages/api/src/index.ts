import {
  AuthUnavailable,
  CreateOrganization,
  Forbidden,
  Organization,
  OrganizationId,
  OrganizationNotFound,
  SessionState,
  Unauthenticated,
} from "@surveybeat/domain";
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

export class OrganizationsApiGroup extends HttpApiGroup.make("organizations")
  .add(
    HttpApiEndpoint.post("create", "/", {
      payload: CreateOrganization,
      success: Organization,
    }),
    HttpApiEndpoint.get("getById", "/:id", {
      params: { id: OrganizationId },
      success: Organization,
      error: OrganizationNotFound.pipe(
        HttpApiSchema.asNoContent({ decode: () => new OrganizationNotFound() }),
      ),
    }),
  )
  .prefix("/orgs") {}

/** The name a creator gives a new Organization: trimmed, 1 to 100 characters. */
export const OrganizationName = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(100)),
);

/**
 * Sign-in (WorkOS AuthKit, SPEC §6.1). `login`, `callback`, and `logout` answer with redirects
 * and cookies, so browsers navigate to them; the app calls the other three.
 */
export class AuthApiGroup extends HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.get("login", "/login", { success: HttpApiSchema.Empty(302) }),
    HttpApiEndpoint.get("callback", "/callback", {
      query: { code: Schema.optional(Schema.String), state: Schema.optional(Schema.String) },
      success: HttpApiSchema.Empty(302),
    }),
    HttpApiEndpoint.post("logout", "/logout", {
      success: HttpApiSchema.Empty(303),
      error: [Forbidden, AuthUnavailable],
    }),
    HttpApiEndpoint.get("session", "/session", {
      success: SessionState,
      error: [Unauthenticated, AuthUnavailable],
    }),
    HttpApiEndpoint.post("createOrganization", "/organization", {
      payload: Schema.Struct({ name: OrganizationName }),
      success: SessionState,
      error: [Unauthenticated, Forbidden, AuthUnavailable],
    }),
    HttpApiEndpoint.post("chooseOrganization", "/organization/choose", {
      payload: Schema.Struct({ organizationId: OrganizationId }),
      success: SessionState,
      error: [Unauthenticated, Forbidden, AuthUnavailable],
    }),
  )
  .prefix("/auth") {}

/** The HttpApi declaration shared by the server and the clients. */
export class SurveyBeatApi extends HttpApi.make("surveybeat").add(OrganizationsApiGroup).add(AuthApiGroup) {}
