-- The global index for sign-in (SPEC §6.2, ADR 0002): what must be looked up before the
-- Organization is known. Persons themselves live in their Organization's Durable Object; these
-- rows only route to them. Emails are stored normalised (trimmed, lower case). No survey content.

-- Organization → its WorkOS organization (one to one), and the name the picker shows.
CREATE TABLE organization_index (
  organization_id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  workos_organization_id TEXT UNIQUE
) WITHOUT ROWID;

-- One row per Person. `workos_user_id` is NULL until the Person first signs in and is linked by
-- an exact match on a verified email; after that the row is found by user, not by email.
CREATE TABLE person_index (
  organization_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  email TEXT NOT NULL CHECK (email = lower(trim(email))),
  workos_user_id TEXT,
  PRIMARY KEY (organization_id, person_id)
) WITHOUT ROWID;

-- WorkOS user → Persons.
CREATE INDEX person_index_by_user ON person_index (workos_user_id) WHERE workos_user_id IS NOT NULL;
-- email → Organizations, for Persons not yet linked.
CREATE INDEX person_index_unlinked_by_email ON person_index (email) WHERE workos_user_id IS NULL;
-- A WorkOS user is at most one Person per Organization.
CREATE UNIQUE INDEX person_index_one_per_organization
  ON person_index (organization_id, workos_user_id) WHERE workos_user_id IS NOT NULL;

-- "Create an Organization" is idempotent per WorkOS user: the first claim wins, and every retry
-- or double submit finishes that same Organization.
CREATE TABLE organization_claim (
  workos_user_id TEXT NOT NULL PRIMARY KEY,
  organization_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  admin_person_id TEXT NOT NULL
) WITHOUT ROWID;

-- The deny list: WorkOS sessions (`sid`) signed out or revoked. Checked on every request, because
-- an access token stays valid until it expires. Keyed by session, not Organization, since one
-- session moves between Organizations when it is refreshed into another one.
CREATE TABLE revoked_session (
  session_id TEXT NOT NULL PRIMARY KEY,
  revoked_at INTEGER NOT NULL
) WITHOUT ROWID;
