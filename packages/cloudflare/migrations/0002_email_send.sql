-- One row per transactional send (ADR 0006). `state` is the domain's SendState as JSON;
-- `status` repeats its tag so a Lead's view can list failed sends without decoding every row.
CREATE TABLE email_send (
  id TEXT NOT NULL PRIMARY KEY,
  recipient TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Sending', 'Sent', 'Failed')),
  state TEXT NOT NULL
) WITHOUT ROWID;
