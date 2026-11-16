ALTER TABLE person_index RENAME COLUMN workos_user_id TO auth_user_id;

ALTER TABLE organization_claim RENAME COLUMN workos_user_id TO auth_user_id;

CREATE TABLE organization_index_next (
  organization_id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL
) WITHOUT ROWID;

INSERT INTO organization_index_next (organization_id, name)
SELECT organization_id, name FROM organization_index;

DROP TABLE organization_index;

ALTER TABLE organization_index_next RENAME TO organization_index;

DROP TABLE IF EXISTS revoked_session;

CREATE TABLE IF NOT EXISTS auth_session_organization (
  session_id TEXT NOT NULL PRIMARY KEY REFERENCES auth_session (id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL
) WITHOUT ROWID;
