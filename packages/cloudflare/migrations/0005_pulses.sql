-- The question library and Pulses (slice 06). Question content and Pulse settings are checked by
-- the domain's schemas; the checks here keep the Release 1 limits from drifting in storage.

-- A Question in the Organization's library. `template_key` names the Template Question it was
-- copied from, if any.
CREATE TABLE question (
  id TEXT NOT NULL PRIMARY KEY,
  template_key TEXT,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

-- One meaning of a Question. Answers will point here, never at the Question. `type` is the
-- Question type as JSON (rating, single choice, long text; an open union).
CREATE TABLE question_version (
  id TEXT NOT NULL PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES question (id),
  number INTEGER NOT NULL CHECK (number >= 1),
  text TEXT NOT NULL,
  dimension TEXT CHECK (dimension IN ('workload', 'psychologicalSafety', 'clarity', 'recognition')),
  type TEXT NOT NULL CHECK (json_valid(type))
) WITHOUT ROWID;
-- Release 1 keeps exactly one version per Question. Drop this index when Questions get new versions.
CREATE UNIQUE INDEX question_version_one_per_question ON question_version (question_id);

-- A recurring check-in for one Team. Release 1: weekly only, 06:00–21:00 local, anonymous only,
-- by Invitation only.
CREATE TABLE pulse (
  id TEXT NOT NULL PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES team (id),
  name TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('weekly')),
  weekday TEXT NOT NULL
    CHECK (weekday IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  send_time TEXT NOT NULL CHECK (send_time BETWEEN '06:00' AND '21:00' AND length(send_time) = 5),
  answer_window_days INTEGER NOT NULL CHECK (answer_window_days BETWEEN 1 AND 6),
  reminders INTEGER NOT NULL CHECK (reminders BETWEEN 0 AND 2),
  anonymity_mode TEXT NOT NULL CHECK (anonymity_mode IN ('anonymous')),
  distribution TEXT NOT NULL CHECK (distribution IN ('invitation')),
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX pulse_by_team ON pulse (team_id);

-- A Pulse's Question versions, in order. Each at most once per Pulse.
CREATE TABLE pulse_question (
  pulse_id TEXT NOT NULL REFERENCES pulse (id),
  position INTEGER NOT NULL CHECK (position >= 0),
  question_version_id TEXT NOT NULL REFERENCES question_version (id),
  PRIMARY KEY (pulse_id, position)
) WITHOUT ROWID;
CREATE UNIQUE INDEX pulse_question_once ON pulse_question (pulse_id, question_version_id);
