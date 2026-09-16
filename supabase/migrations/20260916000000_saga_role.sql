-- D33: dedicated Postgres role for the ingest saga background worker.
-- The saga has no user JWT (so no RLS identity) and must not use the
-- service-role key (which bypasses RLS). Actions are attributed via
-- source_files.uploaded_by, not via the database connection.

BEGIN;

CREATE ROLE raven_saga WITH LOGIN PASSWORD 'saga_password';

GRANT INSERT, UPDATE ON
  source_files, ingest_jobs, entities, identifiers,
  relationships, evidence, entity_aliases,
  location_history, cdr_records, financial_txns
  TO raven_saga;

GRANT SELECT ON
  cases, case_assignments, profiles, source_files
  TO raven_saga;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public
  TO raven_saga;

COMMIT;
