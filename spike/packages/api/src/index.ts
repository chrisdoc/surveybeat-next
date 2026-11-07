import { Organization, OrganizationNotFound } from "@spike/domain";
import * as Schema from "effect/Schema";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";

const createOrganization = HttpApiEndpoint.post("create", "/orgs", {
  payload: Schema.Struct({ name: Schema.String }),
  success: Organization,
});

const getOrganization = HttpApiEndpoint.get("get", "/orgs/:id", {
  params: Schema.Struct({ id: Schema.String }),
  success: Organization,
  error: OrganizationNotFound,
});

export class OrganizationsGroup extends HttpApiGroup.make("organizations")
  .add(createOrganization)
  .add(getOrganization) {}

export class SpikeApi extends HttpApi.make("SpikeApi").add(OrganizationsGroup) {}
