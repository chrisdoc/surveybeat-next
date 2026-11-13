-- D1 indexes for test invitations and their test answers (ADR 0021, issue 136). They hold hashes and
-- ids only, never a Person. A test token or a test Edit key routes here, never to invitation_index or
-- submission_index, so a test cannot reach the real answer path. test_submission_index is used by the
-- answer slice that follows.
CREATE TABLE test_invitation_index (
  token_hash TEXT NOT NULL PRIMARY KEY,
  organization_id TEXT NOT NULL,
  pulse_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE test_submission_index (
  edit_key_hash TEXT NOT NULL PRIMARY KEY,
  organization_id TEXT NOT NULL,
  pulse_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
