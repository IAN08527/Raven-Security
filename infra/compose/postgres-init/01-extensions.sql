-- This container is a bare Postgres+pgvector service for the deployment-shaped
-- all-in-one compose profile, not the Supabase-CLI-managed local dev database
-- (that flow is `supabase start` / `supabase db reset`, which also runs
-- GoTrue and therefore has an `auth` schema for supabase/migrations/*.sql to
-- reference). Applying the application schema here is a follow-up decision,
-- not made in M0-T8.
CREATE EXTENSION IF NOT EXISTS vector;
