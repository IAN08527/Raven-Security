-- M4-T2. Enforce extraction spans and provenance at the database level
-- (rules 7/8, FR-3.1/FR-4.4): every value extracted from text must point
-- at its source span, and every row must carry the source file's
-- provenance. Additive only: no column is dropped, no row is touched.
--
-- Deliberately NOT a blanket NOT NULL on evidence.char_start/char_end:
-- cdr_row, txn_row and cctv_sighting evidence legitimately have no
-- character spans (their positions are timestamps and coordinates). A
-- blanket constraint would corrupt those kinds. The CHECK below enforces
-- spans exactly where extraction produces them (fir_text rows).

BEGIN;

-- Provenance restatements: already NOT NULL in the baseline; repeated
-- here idempotently so the M4 contract is provable from this migration
-- alone and any future relaxation arrives as its own reviewed change.
ALTER TABLE entities ALTER COLUMN provenance SET NOT NULL;
ALTER TABLE identifiers ALTER COLUMN provenance SET NOT NULL;
ALTER TABLE relationships ALTER COLUMN provenance SET NOT NULL;
ALTER TABLE evidence ALTER COLUMN provenance SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evidence_fir_text_has_span'
  ) THEN
    ALTER TABLE evidence
      ADD CONSTRAINT evidence_fir_text_has_span
      CHECK (kind <> 'fir_text' OR (char_start IS NOT NULL AND char_end IS NOT NULL));
  END IF;
END
$$;

COMMIT;
