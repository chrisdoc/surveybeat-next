-- ADR 0029: the address change a signed-in Person confirmed. The row is written before Better Auth
-- moves auth_user.email and removed once person_index and every Organization's person row follow, so
-- a Worker that stops in between lets the same account finish the change without a second code.
CREATE TABLE email_rectification (
  auth_user_id TEXT NOT NULL PRIMARY KEY,
  old_email TEXT NOT NULL,
  new_email TEXT NOT NULL
) WITHOUT ROWID;
