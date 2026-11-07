-- A claim closes once its Organization is finished, so a creator removed later is never made
-- admin again by finishing it (ADR 0002). NULL while the creation may still be finished.
ALTER TABLE organization_claim ADD COLUMN completed_at INTEGER;

-- Claims made before this column: finished once the creator's Person was linked in the index.
UPDATE organization_claim SET completed_at = unixepoch() * 1000
 WHERE EXISTS (
   SELECT 1 FROM person_index p
    WHERE p.organization_id = organization_claim.organization_id
      AND p.workos_user_id = organization_claim.workos_user_id
 );
