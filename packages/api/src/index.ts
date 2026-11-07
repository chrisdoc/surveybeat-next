import { CreateOrganization, Organization, OrganizationId, OrganizationNotFound } from "@surveybeat/domain";
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

/** The HttpApi declaration shared by the server and the clients. */
export class SurveyBeatApi extends HttpApi.make("surveybeat").add(OrganizationsApiGroup) {}
