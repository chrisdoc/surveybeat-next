import { Schema } from "effect";

/** Identifies an Organization, the tenant that owns every other record. */
export const OrganizationId = Schema.String.pipe(Schema.brand("OrganizationId"));
export type OrganizationId = typeof OrganizationId.Type;

export class Organization extends Schema.Class<Organization, { readonly brand: unique symbol }>(
  "Organization",
)({
  id: OrganizationId,
  name: Schema.NonEmptyString,
}) {}

/** What a client may supply when creating an Organization. */
export const CreateOrganization = Schema.Struct({
  name: Schema.NonEmptyString,
});
export type CreateOrganization = typeof CreateOrganization.Type;

export class OrganizationNotFound extends Schema.TaggedError<
  OrganizationNotFound,
  { readonly brand: unique symbol }
>()("OrganizationNotFound", {}, { httpApiStatus: 404 }) {}
