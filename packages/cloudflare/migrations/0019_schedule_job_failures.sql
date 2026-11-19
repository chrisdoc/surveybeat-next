-- Failed attempts of a due job. A job that throws is backed off by nextJobAttemptAt and never cancelled.
ALTER TABLE schedule_job ADD COLUMN failures INTEGER NOT NULL DEFAULT 0;
