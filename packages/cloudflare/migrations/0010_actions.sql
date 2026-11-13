-- Actions committed from a Result (slice 13).
CREATE TABLE action (
  id TEXT NOT NULL PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES round (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES person (id),
  due_date TEXT,
  dimension TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'committed', 'done', 'dropped')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  done_at INTEGER
) WITHOUT ROWID;

CREATE INDEX action_by_team ON action (team_id);
CREATE INDEX action_by_round ON action (round_id);
