-- D1 index for Edit key lookups (slice 09, ADR 0005).
-- Maps edit_key_hash to organization and round so changes can route to the Organization DO
-- with no knowledge of person or invitation.
CREATE TABLE submission_index (
  edit_key_hash TEXT NOT NULL PRIMARY KEY,
  organization_id TEXT NOT NULL,
  round_id TEXT NOT NULL
) WITHOUT ROWID;
