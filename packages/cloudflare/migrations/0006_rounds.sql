-- Round lifecycle engine and schedule table (slice 07, ADR 0004, ADR 0006).

-- A Pulse can be paused by its Lead; cancelling its Scheduled Round until resumed.
ALTER TABLE pulse ADD COLUMN paused_at INTEGER;

-- Skipped cadence weeks for a Pulse (up to 8 weeks out).
CREATE TABLE pulse_skip (
  pulse_id TEXT NOT NULL REFERENCES pulse (id),
  planned_open_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pulse_id, planned_open_date)
) WITHOUT ROWID;

-- One Round of a Pulse: Scheduled -> Open -> Closed -> Ready -> Shared, or Cancelled.
-- Keyed by (pulse_id, planned_open_date) so duplicate rounds are impossible.
CREATE TABLE round (
  id TEXT NOT NULL PRIMARY KEY,
  pulse_id TEXT NOT NULL REFERENCES pulse (id),
  team_id TEXT NOT NULL REFERENCES team (id),
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'open', 'closed', 'ready', 'shared', 'cancelled')),
  planned_open_date TEXT NOT NULL,
  planned_open_at INTEGER NOT NULL,
  opened_at INTEGER,
  planned_close_at INTEGER NOT NULL,
  closed_at INTEGER,
  effective_minimum_group_size INTEGER,
  pulse_name TEXT NOT NULL,
  answer_window_days INTEGER NOT NULL CHECK (answer_window_days BETWEEN 1 AND 6),
  reminders INTEGER NOT NULL CHECK (reminders BETWEEN 0 AND 2),
  anonymity_mode TEXT NOT NULL CHECK (anonymity_mode IN ('anonymous')),
  distribution TEXT NOT NULL CHECK (distribution IN ('invitation')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE UNIQUE INDEX round_pulse_planned_date ON round (pulse_id, planned_open_date);
CREATE INDEX round_by_pulse ON round (pulse_id);
CREATE INDEX round_by_team ON round (team_id);
CREATE INDEX round_by_status ON round (status);

-- Questions frozen at the moment the Round opens.
CREATE TABLE round_question (
  round_id TEXT NOT NULL REFERENCES round (id),
  position INTEGER NOT NULL CHECK (position >= 0),
  question_version_id TEXT NOT NULL REFERENCES question_version (id),
  PRIMARY KEY (round_id, position)
) WITHOUT ROWID;
CREATE UNIQUE INDEX round_question_once ON round_question (round_id, question_version_id);

-- Eligible members frozen from active Memberships at the moment the Round opens.
CREATE TABLE round_member (
  round_id TEXT NOT NULL REFERENCES round (id),
  person_id TEXT NOT NULL REFERENCES person (id),
  time_zone TEXT NOT NULL,
  send_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, person_id)
) WITHOUT ROWID;
CREATE INDEX round_member_by_person ON round_member (person_id);

-- Due jobs for the DO alarm (ADR 0006): open, close, compute, send, remind.
CREATE TABLE schedule_job (
  id TEXT NOT NULL PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES round (id),
  type TEXT NOT NULL CHECK (type IN ('open', 'close', 'compute', 'send', 'remind')),
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'cancelled')),
  payload TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
) WITHOUT ROWID;

CREATE INDEX schedule_job_due ON schedule_job (status, due_at);
CREATE INDEX schedule_job_round ON schedule_job (round_id);
