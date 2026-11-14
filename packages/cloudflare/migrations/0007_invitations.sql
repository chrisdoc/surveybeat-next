-- Invitations, reminders, and failed-send view (slice 08, ADR 0005, ADR 0006, ADR 0007).

-- Exactly-once sending enforced on the Invitation row (pending -> sending -> sent | failed(reason)).
CREATE TABLE invitation (
  round_id TEXT NOT NULL REFERENCES round (id),
  person_id TEXT NOT NULL REFERENCES person (id),
  token_hash TEXT NOT NULL UNIQUE,
  send_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'revoked')),
  failed_reason TEXT,
  resend_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, person_id)
) WITHOUT ROWID;

CREATE INDEX invitation_by_token ON invitation (token_hash);
CREATE INDEX invitation_by_status ON invitation (round_id, status);

-- Reminder opt-out per Person per Pulse (RFC 8058).
CREATE TABLE pulse_reminder_opt_out (
  pulse_id TEXT NOT NULL REFERENCES pulse (id),
  person_id TEXT NOT NULL REFERENCES person (id),
  opted_out_at INTEGER NOT NULL,
  PRIMARY KEY (pulse_id, person_id)
) WITHOUT ROWID;

-- Person's preferred time zone (defaults to Team's time zone if null).
ALTER TABLE person ADD COLUMN time_zone TEXT;

-- Participation record: created when member answers (held apart from answers, ADR 0005).
-- Used by reminder jobs to skip members who have already answered.
CREATE TABLE IF NOT EXISTS participation (
  round_id TEXT NOT NULL REFERENCES round (id),
  person_id TEXT NOT NULL REFERENCES person (id),
  PRIMARY KEY (round_id, person_id)
) WITHOUT ROWID;
