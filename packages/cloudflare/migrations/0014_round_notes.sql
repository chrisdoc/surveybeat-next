-- The Lead's Note on a Round (R2 04).
-- One Note per Round, written by the Team's Lead and visible to the Team. Deleted with its Round or Team.
CREATE TABLE round_note (
  round_id TEXT NOT NULL PRIMARY KEY REFERENCES round (id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
