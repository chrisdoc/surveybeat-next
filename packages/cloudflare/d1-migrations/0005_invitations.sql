-- Global index for invitation tokens to route unauthenticated requests to their Organization (SPEC §6.2).
-- Stored as SHA-256 hash only. No survey content.
CREATE TABLE invitation_index (
  token_hash TEXT NOT NULL PRIMARY KEY,
  organization_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  pulse_id TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX invitation_index_by_round ON invitation_index (organization_id, round_id);
CREATE INDEX invitation_index_by_person ON invitation_index (organization_id, person_id);

ALTER TABLE captured_email ADD COLUMN headers TEXT;
