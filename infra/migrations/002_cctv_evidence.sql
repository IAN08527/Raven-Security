-- 002_cctv_evidence.sql — Phase 5 (Backlog #5): human-in-the-loop sighting confirm.
--
-- A confirmed CCTV sighting mints a `cctv_sighting` evidence row so
-- `recompute_weight` bumps the linked graph edge (+10, §5.3). Unlike every other
-- evidence kind, a sighting has NO source document — its provenance is the
-- ledger-anchored confirm act (`insight_reviews.ledger_tx_id`) plus the saved
-- crop (`reid_sightings.frame_path`), not a `source_files` row. So relax the
-- NOT NULL on `evidence.source_file_id`, but ONLY for `cctv_sighting`: every
-- document-derived kind still MUST cite its file.

ALTER TABLE evidence ALTER COLUMN source_file_id DROP NOT NULL;

ALTER TABLE evidence
  ADD CONSTRAINT evidence_source_file_required
  CHECK (source_file_id IS NOT NULL OR kind = 'cctv_sighting');

-- `insight_reviews.object_id` is polymorphic (object_type = relationship|entity|
-- sighting). Relationships/entities use uuid PKs, but `reid_sightings` uses a
-- bigserial PK, so a uuid column cannot hold a sighting review. Widen to text —
-- there is no FK on it (it is polymorphic by design), and the table is unused so
-- far. Existing uuid values re-cast losslessly.
ALTER TABLE insight_reviews ALTER COLUMN object_id TYPE text USING object_id::text;
