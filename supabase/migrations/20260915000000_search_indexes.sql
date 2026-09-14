-- Search indexes for GET /search (API_CONTRACTS §2.12)
-- pg_trgm GIN indexes support ILIKE '%q%' with leading wildcards.
-- btree indexes on the same columns are not dropped — they serve
-- equality lookups and sort operations independently.
--
-- D30 note: these indexes are additive, baseline untouched (rule 5).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- entities
CREATE INDEX ON entities USING gin (canonical_name gin_trgm_ops);

-- entity_aliases — normalized column already has a btree;
-- add trgm for substring search
CREATE INDEX ON entity_aliases USING gin (normalized gin_trgm_ops);

-- cases
CREATE INDEX ON cases USING gin (case_code gin_trgm_ops);
CREATE INDEX ON cases USING gin (title gin_trgm_ops);

-- source_files
CREATE INDEX ON source_files USING gin (filename gin_trgm_ops);

-- identifiers — value column already has (type, value) btree;
-- add trgm for substring search
CREATE INDEX ON identifiers USING gin (value gin_trgm_ops);

COMMIT;
