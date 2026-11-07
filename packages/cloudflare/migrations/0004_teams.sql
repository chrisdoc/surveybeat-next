-- Teams, Memberships, Organization admins, and the minimum group size (slice 04, ADR 0002–0004).

-- The Durable Object, not a token claim, decides who is an Organization admin (ADR 0010); the
-- WorkOS `admin` role is kept in step. Until now the only Person was each Organization's creator,
-- made its admin, so every existing Person is one.
ALTER TABLE person ADD COLUMN organization_admin INTEGER NOT NULL DEFAULT 0 CHECK (organization_admin IN (0, 1));
UPDATE person SET organization_admin = 1;
-- One Person per email: adding an email that has a Person reuses (or restores) it.
CREATE UNIQUE INDEX person_email ON person (email);

-- N, at least 3 (ADR 0004). Each Round will store the N it closed under.
ALTER TABLE organization ADD COLUMN minimum_group_size INTEGER NOT NULL DEFAULT 4 CHECK (minimum_group_size >= 3);

-- Teams do not nest in Release 1: no parent. `time_zone` is an IANA name, checked by the domain.
CREATE TABLE team (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX team_name ON team (lower(name));

-- A Person's role in one Team over a date range. Ending a Membership sets `ended_at`; rows are
-- never deleted, so history stays. A role change ends one Membership and starts another.
CREATE TABLE membership (
  id TEXT NOT NULL PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES team (id),
  person_id TEXT NOT NULL REFERENCES person (id),
  role TEXT NOT NULL CHECK (role IN ('lead', 'member', 'viewer')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER CHECK (ended_at IS NULL OR ended_at >= started_at)
) WITHOUT ROWID;
-- At most one active Membership per Person and Team.
CREATE UNIQUE INDEX membership_active ON membership (team_id, person_id) WHERE ended_at IS NULL;
CREATE INDEX membership_by_person ON membership (person_id);
