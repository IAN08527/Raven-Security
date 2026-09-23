-- D33 follow-up (resolution): the ingest saga background worker runs with
-- no user JWT, so auth.uid() is NULL in its sessions and the baseline
-- case_scoped / via_file / via_entity policies (all keyed on
-- has_case_access(), which needs an RLS identity) deny it despite the
-- D33 GRANTs. GRANTs alone do not bypass RLS.
--
-- This migration adds permissive policies scoped TO raven_saga only,
-- mirroring exactly the operations the D33 GRANTs allow. Every other
-- role keeps the baseline policies unchanged: user traffic still goes
-- through has_case_access(). Attribution stays column-based
-- (source_files.uploaded_by), never connection-based.
--
-- This is the "or equivalent" the D33 amendment anticipated, in the
-- least-privilege form: per-operation policies, no DELETE, no
-- BYPASSRLS, no service-role key.

BEGIN;

-- source_files: saga reads context/status, inserts the row, updates
-- status, extracted_text, ledger fields.
CREATE POLICY saga_select ON source_files
  FOR SELECT TO raven_saga USING (true);
CREATE POLICY saga_insert ON source_files
  FOR INSERT TO raven_saga WITH CHECK (true);
CREATE POLICY saga_update ON source_files
  FOR UPDATE TO raven_saga USING (true) WITH CHECK (true);

-- ingest_jobs: saga appends stage rows and updates them.
CREATE POLICY saga_insert ON ingest_jobs
  FOR INSERT TO raven_saga WITH CHECK (true);
CREATE POLICY saga_update ON ingest_jobs
  FOR UPDATE TO raven_saga USING (true) WITH CHECK (true);

-- review_items: saga queues low-confidence fields (D36 structured path).
CREATE POLICY saga_insert ON review_items
  FOR INSERT TO raven_saga WITH CHECK (true);

-- Extraction outputs: saga inserts only, never updates or deletes.
CREATE POLICY saga_insert ON entities
  FOR INSERT TO raven_saga WITH CHECK (true);
CREATE POLICY saga_insert ON entity_aliases
  FOR INSERT TO raven_saga WITH CHECK (true);
CREATE POLICY saga_insert ON identifiers
  FOR INSERT TO raven_saga WITH CHECK (true);
CREATE POLICY saga_insert ON relationships
  FOR INSERT TO raven_saga WITH CHECK (true);
CREATE POLICY saga_insert ON evidence
  FOR INSERT TO raven_saga WITH CHECK (true);
CREATE POLICY saga_insert ON location_history
  FOR INSERT TO raven_saga WITH CHECK (true);
CREATE POLICY saga_insert ON cdr_records
  FOR INSERT TO raven_saga WITH CHECK (true);
CREATE POLICY saga_insert ON financial_txns
  FOR INSERT TO raven_saga WITH CHECK (true);

COMMIT;
