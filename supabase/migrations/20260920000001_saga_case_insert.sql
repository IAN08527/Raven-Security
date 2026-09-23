-- D33 follow-up, part 2: POST /cases dual-writes the row to Postgres
-- through the saga role, because source_files.case_id references
-- cases(id) and the upload's durable write would otherwise violate
-- the foreign key. Same least-privilege form as part 1: one GRANT,
-- one policy scoped TO raven_saga, INSERT only. Reading cases stays
-- on the baseline case_visible policy (user JWTs only).

BEGIN;

GRANT INSERT ON cases TO raven_saga;

CREATE POLICY saga_insert ON cases
  FOR INSERT TO raven_saga WITH CHECK (true);

COMMIT;
