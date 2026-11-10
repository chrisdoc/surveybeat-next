-- Comment themes and discussion guide computed at Round close (issue 103, ADR 0016, ADR 0019).

-- SQLite cannot alter a CHECK constraint, so rebuild schedule_job with the 'themes' job type.
CREATE TABLE schedule_job_new (
  id TEXT NOT NULL PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES round (id),
  type TEXT NOT NULL CHECK (type IN ('open', 'close', 'compute', 'send', 'remind', 'themes')),
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

-- The one Comment themes + discussion guide call per Round (ADR 0016, ADR 0019). Stored once, never recomputed.
CREATE TABLE round_themes (
  round_id TEXT NOT NULL PRIMARY KEY REFERENCES round (id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  requested_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  payload TEXT,
  completed_at INTEGER
) WITHOUT ROWID;
