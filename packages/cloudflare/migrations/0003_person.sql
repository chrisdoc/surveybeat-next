-- The Organization's People (ADR 0002, 0006). A Person exists before signing in (email only) and
-- is linked to a WorkOS user at first sign-in by an exact match on a verified email. The per-request
-- session check asks this table whether the signed-in user's Person is still active.
-- Org-level roles (admin, member) are WorkOS's (SPEC §5.6, ADR 0003), so none is stored here.
CREATE TABLE person (
  id TEXT NOT NULL PRIMARY KEY,
  email TEXT NOT NULL CHECK (email = lower(trim(email))),
  workos_user_id TEXT UNIQUE,
  removed_at INTEGER
) WITHOUT ROWID;
