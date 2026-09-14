-- M2-T4. Enforce the candidate explanation contract at the database level
-- (API_CONTRACTS.md §4: "Never return a candidate without threshold_used
-- and prior_adjustment"; D9/D15: every proposal carries its score, the
-- threshold it had to clear, and the topology influence on that threshold).
--
-- The baseline already declares both columns NOT NULL, so these ALTERs are
-- idempotent restatements, not behaviour changes to existing rows -- they
-- exist so the constraint is provable from this migration alone and so any
-- future relaxation must arrive as its own reviewed migration rather than a
-- silent application-code omission. The CHECK bounds prior_adjustment to
-- D15's [-0.15, 0.0] range. Additive only: no column is dropped, no row is
-- touched.

BEGIN;

ALTER TABLE reid_candidates ALTER COLUMN threshold_used SET NOT NULL;
ALTER TABLE reid_candidates ALTER COLUMN prior_adjustment SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reid_candidates_prior_range'
  ) THEN
    ALTER TABLE reid_candidates
      ADD CONSTRAINT reid_candidates_prior_range
      CHECK (prior_adjustment >= -0.15 AND prior_adjustment <= 0);
  END IF;
END
$$;

COMMIT;
