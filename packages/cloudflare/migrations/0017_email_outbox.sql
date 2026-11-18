-- Sends this Organization created or requeued that are not yet on the Email queue (transactional outbox).
-- A row is written in the same transaction as its email_send; the alarm puts the rows on the queue and
-- deletes exactly the rows it sent. A repeated message is harmless: delivery claims each send once.
CREATE TABLE email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  send_id TEXT NOT NULL
);
