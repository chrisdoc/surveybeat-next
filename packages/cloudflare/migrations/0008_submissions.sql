-- Anonymous Submission and Answer storage (slice 09, ADR 0005).
-- WITHOUT ROWID with random 128-bit keys. No person, invitation, or time column, ever.

CREATE TABLE submission (
  id TEXT NOT NULL PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES round (id),
  edit_key_hash TEXT NOT NULL UNIQUE
) WITHOUT ROWID;

CREATE INDEX submission_by_round ON submission (round_id);

CREATE TABLE answer (
  submission_id TEXT NOT NULL REFERENCES submission (id) ON DELETE CASCADE,
  question_version_id TEXT NOT NULL,
  value INTEGER,
  comment TEXT,
  PRIMARY KEY (submission_id, question_version_id)
) WITHOUT ROWID;
