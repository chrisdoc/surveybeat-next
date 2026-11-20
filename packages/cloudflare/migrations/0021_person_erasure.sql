CREATE TABLE person_erasure (
  person_id TEXT NOT NULL PRIMARY KEY REFERENCES person (id),
  email TEXT NOT NULL,
  auth_user_id TEXT,
  send_ids TEXT NOT NULL,
  test_token_hashes TEXT NOT NULL
);
