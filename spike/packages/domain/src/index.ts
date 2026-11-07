import * as Schema from "effect/Schema";

/** 16 random bytes, hex-encoded (32 chars). Also the Organization DO's name. */
export const OrganizationId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/));

export class Organization extends Schema.Class<Organization>("Organization")({
  id: OrganizationId,
  name: Schema.String,
}) {}

export class OrganizationNotFound extends Schema.TaggedError<OrganizationNotFound>()(
  "OrganizationNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}
