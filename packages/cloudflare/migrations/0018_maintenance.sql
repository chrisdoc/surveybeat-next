-- One-time repairs of stored data. `name` is the repair's stable key; a row means it has run for this Organization.
CREATE TABLE maintenance_done (
  name TEXT NOT NULL PRIMARY KEY,
  done_at INTEGER NOT NULL
) WITHOUT ROWID;
