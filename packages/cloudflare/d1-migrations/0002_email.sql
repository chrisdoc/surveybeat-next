-- Routes Cloudflare Email Sending events, which carry only the provider's message id,
-- back to the send in its Organization's Durable Object.
CREATE TABLE email_message (
  message_id TEXT NOT NULL PRIMARY KEY,
  organization_id TEXT NOT NULL,
  send_id TEXT NOT NULL
) WITHOUT ROWID;

-- Every stage except production records its email here instead of sending it (docs/infra.md).
CREATE TABLE captured_email (
  message_id TEXT NOT NULL PRIMARY KEY,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  captured_at INTEGER NOT NULL
) WITHOUT ROWID;
