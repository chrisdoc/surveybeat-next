-- Test sends (ADR 0021, issue 136): one row per "send me a test" email, kept for the rate limit (a
-- Person may send at most 5 an hour) and for indexing the test token once the email is sent. Rows
-- older than the test token's 7-day lifetime are deleted. Nothing here is about answers: a test never
-- writes a Submission, an Answer, or a Participation record.
CREATE TABLE test_send (
  send_id TEXT NOT NULL PRIMARY KEY,
  person_id TEXT NOT NULL,
  pulse_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  sent_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX test_send_by_person ON test_send (person_id, sent_at);
