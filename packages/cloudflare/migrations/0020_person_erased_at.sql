-- Erasure is irreversible and separate from removal (GDPR Art. 17, issue 307): a removed Person keeps
-- their address so an access export can still find them, an erased Person keeps only a tombstone.
-- NULL until the Person's personal data was scrubbed.
ALTER TABLE person ADD COLUMN erased_at INTEGER;
