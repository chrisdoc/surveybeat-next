-- The global index for sign-in (SPEC §6.2, ADR 0002): what must be looked up before the
-- Organization is known. Persons themselves live in their Organization's Durable Object; these
-- rows only route to them. Emails are stored normalised (trimmed, lower case). No survey content.

-- Organization → the name the picker shows. The Organization objects are found by their own id;
-- there is no provider-side organization any more (ADR 0023).
CREATE TABLE organization_index (
  organization_id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL
) WITHOUT ROWID;

-- One row per Person. `auth_user_id` is NULL until the Person first signs in and is linked by an
-- exact match on a verified email; after that the row is found by user, not by email.
CREATE TABLE person_index (
  organization_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  email TEXT NOT NULL CHECK (email = lower(trim(email))),
  auth_user_id TEXT,
  PRIMARY KEY (organization_id, person_id)
) WITHOUT ROWID;

-- Signed-in user → Persons.
CREATE INDEX person_index_by_user ON person_index (auth_user_id) WHERE auth_user_id IS NOT NULL;
-- email → Organizations, for Persons not yet linked.
CREATE INDEX person_index_unlinked_by_email ON person_index (email) WHERE auth_user_id IS NULL;
-- A signed-in user is at most one Person per Organization.
CREATE UNIQUE INDEX person_index_one_per_organization
  ON person_index (organization_id, auth_user_id) WHERE auth_user_id IS NOT NULL;

-- "Create an Organization" is idempotent per signed-in user: the first claim wins, and every
-- retry or double submit finishes that same Organization.
CREATE TABLE organization_claim (
  auth_user_id TEXT NOT NULL PRIMARY KEY,
  organization_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  admin_person_id TEXT NOT NULL
) WITHOUT ROWID;
