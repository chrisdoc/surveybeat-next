-- A removed Person stays in the index so an access export can still open that Organization.
-- Sign-in reads only rows with removed_at IS NULL. Adding the same Person again clears it.
ALTER TABLE person_index ADD COLUMN removed_at INTEGER;
