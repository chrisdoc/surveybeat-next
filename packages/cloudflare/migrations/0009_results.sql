-- Derived Round Results (slice 11, ADR 0004).
-- Recomputable aggregates keyed by round_id, stored for fast (< 1.5s) queries.
CREATE TABLE round_result (
  round_id TEXT NOT NULL PRIMARY KEY REFERENCES round (id) ON DELETE CASCADE,
  computed_at INTEGER NOT NULL,
  payload TEXT NOT NULL
) WITHOUT ROWID;
