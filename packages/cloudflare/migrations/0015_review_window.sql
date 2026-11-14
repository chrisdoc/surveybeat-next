-- Review window: after a Round closes, only the Lead sees its Result until it is shared (issue 106, glossary "Review window").

-- SQLite cannot alter a CHECK constraint, so rebuild schedule_job with the 'share' job type.
CREATE TABLE schedule_job_new (
  id TEXT NOT NULL PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES round (id),
  type TEXT NOT NULL CHECK (type IN ('open', 'close', 'compute', 'send', 'remind', 'themes', 'share')),
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'cancelled')),
  payload TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
) WITHOUT ROWID;

INSERT INTO schedule_job_new (id, round_id, type, due_at, status, payload, created_at, completed_at)
  SELECT id, round_id, type, due_at, status, payload, created_at, completed_at FROM schedule_job;

DROP TABLE schedule_job;
ALTER TABLE schedule_job_new RENAME TO schedule_job;

CREATE INDEX schedule_job_due ON schedule_job (status, due_at);
CREATE INDEX schedule_job_round ON schedule_job (round_id);

-- The Review window length in days (0 shares at once). Copied onto each Round at close.
ALTER TABLE pulse ADD COLUMN review_window_days INTEGER NOT NULL DEFAULT 3 CHECK (review_window_days BETWEEN 0 AND 7);

-- When the Review window ends, fixed at close. NULL for Rounds closed before this migration: treated as already over.
ALTER TABLE round ADD COLUMN review_ends_at INTEGER;
