-- ADR 0028: the sign-in account that confirmed deleting an Organization. The row survives a crash
-- after the Durable Object wipe so the same admin can finish the D1 deletes without the name.
CREATE TABLE organization_offboarding (
  organization_id TEXT NOT NULL PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  confirmed_at INTEGER NOT NULL
);
