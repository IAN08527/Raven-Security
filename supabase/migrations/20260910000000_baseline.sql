-- Raven baseline schema
-- Supersedes the prototype's infra/migrations/001_init.sql.
-- This is the last squashed migration. Everything after this is additive (D24).
--
-- Decision references: D9 D13 D14 D15 D16 D19 D20 D21 D23 D27
-- Requirements: PRD FR-1 through FR-8

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- =============================================================================
-- ENUMS
-- =============================================================================

-- D19. Which corpus a row came from. The evaluation harness filters on this and
-- refuses 'synthetic'. Propagated from source file through to entities and edges.
CREATE TYPE provenance AS ENUM ('benchmark', 'collected', 'synthetic');

-- Which real-world system or corpus a file represents. Decoupled from provenance:
-- a CCTNS-shaped file can be collected or synthetic.
CREATE TYPE source_node AS ENUM (
  'CCTNS', 'CFCFRMS', 'ICJS', 'VAHAN', 'NAFIS', 'TELECOM',
  'PUBLIC_DATASET', 'MANUAL'
);

CREATE TYPE ingest_status AS ENUM (
  'received', 'hashing', 'stored', 'recognising', 'awaiting_review',
  'extracting', 'committed', 'needs_review', 'failed'
);

CREATE TYPE entity_type AS ENUM
  ('PERSON', 'ORGANIZATION', 'LOCATION', 'VEHICLE', 'ACCOUNT');

CREATE TYPE identifier_type AS ENUM
  ('PHONE', 'VEHICLE', 'ACCOUNT', 'IMEI', 'NAFIS');

CREATE TYPE rel_type AS ENUM
  ('CALLED', 'TRANSFERRED_TO', 'CO_ACCUSED', 'CO_LOCATED', 'RESIDES_WITH', 'SEEN_WITH');

CREATE TYPE app_role AS ENUM ('io', 'analyst', 'auditor', 'admin');

-- D16. A source is either a live stream or a recording; both need a declared
-- start so the case clock is well defined.
CREATE TYPE source_mode AS ENUM ('live', 'recorded');

-- D9, FR-5.7. A candidate is a proposal until a human decides.
CREATE TYPE decision_status AS ENUM ('proposed', 'confirmed', 'rejected');

CREATE TYPE review_status AS ENUM ('pending', 'corrected', 'accepted', 'rejected');

-- =============================================================================
-- IDENTITY AND ACCESS  (D21)
-- Replaces the prototype's standalone `officers` table, which had no credentials.
-- =============================================================================

CREATE TABLE profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_no      text UNIQUE NOT NULL,
  full_name     text NOT NULL,
  role          app_role NOT NULL,
  ledger_id     text UNIQUE,          -- Fabric MSP identity, D22
  org_unit      text,                 -- which agency org this user belongs to
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_code     text UNIQUE NOT NULL,
  title         text NOT NULL,
  jurisdiction  text,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  lead_officer  uuid REFERENCES profiles(id)
);

-- The join RLS policies are built on. Without a row here you cannot see a case.
CREATE TABLE case_assignments (
  case_id       uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_role app_role NOT NULL,
  assigned_by   uuid REFERENCES profiles(id),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, user_id)
);
CREATE INDEX ON case_assignments (user_id);

-- SECURITY DEFINER so policies can consult assignments without the caller needing
-- read access to the assignment table itself.
CREATE OR REPLACE FUNCTION has_case_access(target_case uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM case_assignments ca
    WHERE ca.case_id = target_case AND ca.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION current_role_is(check_role app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = check_role
  );
$$;

-- =============================================================================
-- SOURCES AND INGESTION
-- =============================================================================

CREATE TABLE source_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  filename       text NOT NULL,
  mime_type      text NOT NULL,       -- from magic bytes, never the extension
  byte_size      bigint NOT NULL,
  sha256         char(64) NOT NULL,
  storage_path   text NOT NULL,       -- content-addressed, keyed by sha256
  source         source_node NOT NULL,
  provenance     provenance NOT NULL,
  status         ingest_status NOT NULL DEFAULT 'received',
  ledger_tx_id   text,                -- D5: anchor of the FILE hash
  ledger_status  text NOT NULL DEFAULT 'pending',
  extracted_text text,                -- retained so spans stay resolvable
  page_map       jsonb,               -- [{page, char_start, char_end}]
  template_id    uuid,                -- D18, FK added after form_templates
  uploaded_by    uuid REFERENCES profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON source_files (case_id, status);
CREATE INDEX ON source_files (sha256);
CREATE INDEX ON source_files (provenance);

CREATE TABLE ingest_jobs (
  id            bigserial PRIMARY KEY,
  file_id       uuid NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  stage         text NOT NULL,
  status        text NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  error_detail  text,
  model_attempts smallint NOT NULL DEFAULT 0,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX ON ingest_jobs (file_id, started_at DESC);

-- D18. Field maps for known form layouts. Constrained recognition per field.
CREATE TABLE form_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text UNIQUE NOT NULL,
  description   text,
  -- [{field, bbox, charset, validator, required}]
  field_map     jsonb NOT NULL,
  created_by    uuid REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE source_files
  ADD CONSTRAINT source_files_template_fk
  FOREIGN KEY (template_id) REFERENCES form_templates(id);

-- FR-2.7. Everything below the confidence threshold, and everything from a script
-- that has not cleared its CER gate, lands here with its source crop.
CREATE TABLE review_items (
  id             bigserial PRIMARY KEY,
  source_file_id uuid NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  page_no        int,
  line_no        int,
  field_name     text,                -- null for free-text lines
  script         text NOT NULL,       -- ISO 15924, e.g. Latn, Deva, Taml
  crop_path      text NOT NULL,       -- the pixels the reviewer sees
  recognised_text text,
  confidence     numeric(4,3),
  corrected_text text,
  status         review_status NOT NULL DEFAULT 'pending',
  reviewed_by    uuid REFERENCES profiles(id),
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON review_items (source_file_id, status);
CREATE INDEX ON review_items (status) WHERE status = 'pending';

-- =============================================================================
-- ENTITIES
-- =============================================================================

CREATE TABLE entities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  type           entity_type NOT NULL,
  canonical_name text NOT NULL,
  nafis_id       text,
  gender         text,
  dob            date,
  provenance     provenance NOT NULL,
  sync_state     text NOT NULL DEFAULT 'pending',   -- D4: pending|synced
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON entities (nafis_id) WHERE nafis_id IS NOT NULL;
CREATE INDEX ON entities (case_id, type);
CREATE INDEX ON entities (provenance);

CREATE TABLE entity_aliases (
  id             bigserial PRIMARY KEY,
  entity_id      uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias          text NOT NULL,
  normalized     text NOT NULL,
  source_file_id uuid REFERENCES source_files(id),
  confidence     numeric(4,3),
  UNIQUE (entity_id, normalized)
);
CREATE INDEX ON entity_aliases (normalized);

CREATE TABLE identifiers (
  id             bigserial PRIMARY KEY,
  entity_id      uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type           identifier_type NOT NULL,
  value          text NOT NULL,
  source_file_id uuid REFERENCES source_files(id),
  provenance     provenance NOT NULL,
  UNIQUE (type, value, entity_id)
);
CREATE INDEX ON identifiers (type, value);   -- the resolution workhorse

-- FR-3.3. Merges are reversible because a wrong merge fuses two people's records.
CREATE TABLE entity_merges (
  id            bigserial PRIMARY KEY,
  surviving_id  uuid NOT NULL REFERENCES entities(id),
  merged_id     uuid NOT NULL,
  reason        text NOT NULL,        -- nafis|shared_identifier|name_and_case|manual
  status        decision_status NOT NULL DEFAULT 'proposed',
  merged_by     uuid REFERENCES profiles(id),
  reversible_snapshot jsonb NOT NULL,
  ledger_tx_id  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  reverted_at   timestamptz
);
CREATE INDEX ON entity_merges (surviving_id);

-- =============================================================================
-- RELATIONSHIPS AND EVIDENCE
-- =============================================================================

CREATE TABLE relationships (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  src_entity_id  uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  dst_entity_id  uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type           rel_type NOT NULL,
  weight         numeric(12,4) NOT NULL DEFAULT 0,
  raw_score      numeric(12,4) NOT NULL DEFAULT 0,   -- pre-decay
  weight_params_version int NOT NULL DEFAULT 1,      -- D27
  first_seen     timestamptz,
  last_seen      timestamptz,
  evidence_count int NOT NULL DEFAULT 0,
  provenance     provenance NOT NULL,
  sync_state     text NOT NULL DEFAULT 'pending',
  UNIQUE (src_entity_id, dst_entity_id, type)
);
CREATE INDEX ON relationships (case_id, weight DESC);
CREATE INDEX ON relationships (dst_entity_id);

-- FR-4.4. Every edge points at the evidence that produced it, down to the span.
CREATE TABLE evidence (
  id              bigserial PRIMARY KEY,
  relationship_id uuid REFERENCES relationships(id) ON DELETE CASCADE,
  entity_id       uuid REFERENCES entities(id) ON DELETE CASCADE,
  source_file_id  uuid NOT NULL REFERENCES source_files(id),
  kind            text NOT NULL,   -- fir_text|cdr_row|txn_row|cctv_sighting
  snippet         text,
  char_start      int,
  char_end        int,
  page_no         int,
  occurred_at     timestamptz,     -- case clock, drives decay (D16)
  confidence      numeric(4,3),
  provenance      provenance NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (relationship_id IS NOT NULL OR entity_id IS NOT NULL)
);
CREATE INDEX ON evidence (relationship_id);
CREATE INDEX ON evidence (source_file_id);

-- D27. Weighting is a versioned, measurable parameter set, not constants in code.
-- Version 1 carries the prototype's values as a starting point; S5 replaces them.
CREATE TABLE weight_params (
  version       int PRIMARY KEY,
  params        jsonb NOT NULL,
  half_life_days numeric(8,2) NOT NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO weight_params (version, params, half_life_days, note) VALUES (
  1,
  '{"CALLED": 1, "TRANSFERRED_TO": 10, "CO_LOCATED": 10, "CO_ACCUSED": 25, "RESIDES_WITH": 15, "SEEN_WITH": 5}',
  180,
  'Prototype values, unvalidated. Replace with S5 results before any claim is made about connection strength.'
);

-- w = SUM over evidence of ( base_type * exp(-lambda * age_days) )
CREATE OR REPLACE FUNCTION recompute_weight(rel_id uuid, params_version int DEFAULT 1)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  p           jsonb;
  half_life   numeric;
  lambda      numeric;
  rel_kind    rel_type;
  base        numeric;
  total       numeric := 0;
  ref_ts      timestamptz;
BEGIN
  SELECT params, half_life_days INTO p, half_life
    FROM weight_params WHERE version = params_version;
  IF p IS NULL THEN
    RAISE EXCEPTION 'weight_params version % not found', params_version;
  END IF;

  SELECT type INTO rel_kind FROM relationships WHERE id = rel_id;
  base   := COALESCE((p ->> rel_kind::text)::numeric, 0);
  lambda := ln(2) / half_life;

  -- Decay is measured against the newest evidence on the edge, not wall-clock,
  -- so replaying historic data gives identical weights (D16).
  SELECT MAX(occurred_at) INTO ref_ts FROM evidence WHERE relationship_id = rel_id;
  IF ref_ts IS NULL THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(
           base * exp(-lambda * GREATEST(EXTRACT(EPOCH FROM (ref_ts - e.occurred_at)) / 86400.0, 0))
         ), 0)
    INTO total
    FROM evidence e
   WHERE e.relationship_id = rel_id AND e.occurred_at IS NOT NULL;

  UPDATE relationships
     SET weight = total,
         raw_score = base * (SELECT COUNT(*) FROM evidence WHERE relationship_id = rel_id),
         weight_params_version = params_version,
         evidence_count = (SELECT COUNT(*) FROM evidence WHERE relationship_id = rel_id),
         sync_state = 'pending'
   WHERE id = rel_id;

  RETURN total;
END;
$$;

-- =============================================================================
-- RECORD TABLES
-- =============================================================================

CREATE TABLE cdr_records (
  id             bigserial PRIMARY KEY,
  case_id        uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  caller_msisdn  text NOT NULL,
  callee_msisdn  text NOT NULL,
  start_ts       timestamptz NOT NULL,
  duration_s     int NOT NULL,
  call_type      text,
  imei           text,
  cell_id        text,
  lat            double precision,
  lon            double precision,
  provenance     provenance NOT NULL,
  source_file_id uuid REFERENCES source_files(id)
);
CREATE INDEX ON cdr_records (caller_msisdn, start_ts DESC);
CREATE INDEX ON cdr_records (callee_msisdn, start_ts DESC);
CREATE INDEX ON cdr_records (case_id);

CREATE TABLE financial_txns (
  id             bigserial PRIMARY KEY,
  case_id        uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  from_account   text NOT NULL,
  to_account     text NOT NULL,
  amount         numeric(18,2) NOT NULL,
  currency       char(3) NOT NULL DEFAULT 'INR',
  ts             timestamptz NOT NULL,
  channel        text,
  provenance     provenance NOT NULL,
  source_file_id uuid REFERENCES source_files(id)
);
CREATE INDEX ON financial_txns (from_account, ts DESC);
CREATE INDEX ON financial_txns (to_account, ts DESC);
CREATE INDEX ON financial_txns (case_id);

CREATE TABLE location_history (
  id             bigserial PRIMARY KEY,
  entity_id      uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  ts             timestamptz NOT NULL,     -- case clock
  lat            double precision NOT NULL,
  lon            double precision NOT NULL,
  origin         text NOT NULL,            -- cdr|fir|address|cctv
  accuracy_m     int,
  provenance     provenance NOT NULL,
  source_file_id uuid REFERENCES source_files(id)
);
CREATE INDEX ON location_history (entity_id, ts);

-- =============================================================================
-- CAMERAS, ENGINE NODES, RE-ID
-- =============================================================================

-- D20. Nodes register and report their measured compute budget (D14).
CREATE TABLE engine_nodes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text UNIQUE NOT NULL,
  address       text NOT NULL,             -- https://host:8756
  budget_dps    numeric(10,2),             -- measured detections per second
  vram_ceiling  bigint,                    -- bytes
  max_batch     int,
  gpu_name      text,
  status        text NOT NULL DEFAULT 'unknown',  -- unknown|ready|degraded|down
  calibrated_at timestamptz,
  last_seen     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cameras (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text UNIQUE NOT NULL,
  label             text NOT NULL,
  lat               double precision NOT NULL,
  lon               double precision NOT NULL,
  feed_uri          text NOT NULL,         -- rtsp://... or file path
  mode              source_mode NOT NULL,  -- D16
  -- Required with no default: a wrong value silently corrupts every
  -- cross-camera inference, so it must be supplied explicitly (D16).
  declared_start_ts timestamptz NOT NULL,
  fps               numeric(6,2) NOT NULL,
  engine_node_id    uuid REFERENCES engine_nodes(id),
  status            text NOT NULL DEFAULT 'offline',
  effective_fps     numeric(6,2),          -- last reported by the scheduler
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON cameras (engine_node_id);

CREATE TABLE camera_edges (
  id            bigserial PRIMARY KEY,
  from_camera   uuid NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  to_camera     uuid NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  mean_travel_s int NOT NULL,
  stddev_s      int NOT NULL,
  path_label    text,
  UNIQUE (from_camera, to_camera)
);

-- D9. Lock-on is a human act with evidentiary weight, so it is anchored.
CREATE TABLE reid_targets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  label          text NOT NULL,
  entity_id      uuid REFERENCES entities(id),   -- null until identified
  embedding      vector(512) NOT NULL,           -- mean of top-k tracklet crops
  source_camera  uuid NOT NULL REFERENCES cameras(id),
  source_ts      timestamptz NOT NULL,           -- case clock
  thumbnail_path text,
  locked_by      uuid NOT NULL REFERENCES profiles(id),
  ledger_tx_id   text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON reid_targets (case_id, active);

-- FR-5.6, FR-5.7. Replaces the prototype's reid_sightings, where a proposal and a
-- confirmed fact were the same row. Every proposal carries its own explanation.
CREATE TABLE reid_candidates (
  id                bigserial PRIMARY KEY,
  target_id         uuid NOT NULL REFERENCES reid_targets(id) ON DELETE CASCADE,
  camera_id         uuid NOT NULL REFERENCES cameras(id),
  ts                timestamptz NOT NULL,       -- case clock
  similarity        numeric(6,5) NOT NULL,
  threshold_used    numeric(6,5) NOT NULL,      -- what it had to clear
  prior_adjustment  numeric(6,5) NOT NULL DEFAULT 0,  -- D15, topology's influence
  expected_from     uuid REFERENCES cameras(id),      -- last confirmed sighting
  expected_window   tstzrange,                        -- predicted arrival window
  embedding         vector(512),
  bbox              int[] NOT NULL,             -- [x, y, w, h]
  crop_path         text,
  frame_path        text,
  status            decision_status NOT NULL DEFAULT 'proposed',
  decided_by        uuid REFERENCES profiles(id),
  decided_at        timestamptz,
  ledger_tx_id      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'proposed' OR decided_by IS NOT NULL)
);
CREATE INDEX ON reid_candidates (target_id, ts);
CREATE INDEX ON reid_candidates (status) WHERE status = 'proposed';
-- Requires pgvector >= 0.5. Verify the shipped extension version before relying
-- on this; older versions offer IVFFlat only and behave differently.
CREATE INDEX ON reid_candidates USING hnsw (embedding vector_cosine_ops);

-- A sighting is a confirmed candidate. Nothing else counts (FR-5.7).
CREATE VIEW reid_sightings AS
  SELECT * FROM reid_candidates WHERE status = 'confirmed';

-- =============================================================================
-- HUMAN LOOP AND AUDIT
-- =============================================================================

CREATE TABLE insight_reviews (
  id            bigserial PRIMARY KEY,
  object_type   text NOT NULL,   -- relationship|entity|candidate|merge
  object_id     uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('confirm', 'reject', 'annotate')),
  note          text,
  user_id       uuid NOT NULL REFERENCES profiles(id),
  ledger_tx_id  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON insight_reviews (object_id, created_at DESC);

CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  user_id       uuid REFERENCES profiles(id),
  case_id       uuid REFERENCES cases(id),
  action        text NOT NULL,   -- file.read|graph.query|reid.lock|candidate.confirm
  object_type   text,
  object_id     uuid,
  payload_hash  char(64) NOT NULL,
  ledger_tx_id  text,
  ledger_status text NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now()   -- system time is correct here
);
CREATE INDEX ON audit_log (object_id, created_at DESC);
CREATE INDEX ON audit_log (user_id, created_at DESC);

-- =============================================================================
-- ROW LEVEL SECURITY  (D21, NFR-8)
-- Admins manage the system without reading case content. That exclusion is
-- deliberate: someone has to administer without seeing the intelligence.
-- =============================================================================

ALTER TABLE cases             ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_files      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_aliases    ENABLE ROW LEVEL SECURITY;
ALTER TABLE identifiers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_merges     ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdr_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_txns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE reid_targets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reid_candidates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE insight_reviews   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;

CREATE POLICY own_profile ON profiles
  FOR SELECT USING (id = auth.uid() OR current_role_is('admin'));

CREATE POLICY case_visible ON cases
  FOR SELECT USING (has_case_access(id));

CREATE POLICY assignment_visible ON case_assignments
  FOR SELECT USING (user_id = auth.uid() OR current_role_is('admin'));

-- Tables that carry case_id directly.
CREATE POLICY case_scoped ON source_files     FOR ALL USING (has_case_access(case_id));
CREATE POLICY case_scoped ON entities         FOR ALL USING (has_case_access(case_id));
CREATE POLICY case_scoped ON relationships    FOR ALL USING (has_case_access(case_id));
CREATE POLICY case_scoped ON cdr_records      FOR ALL USING (has_case_access(case_id));
CREATE POLICY case_scoped ON financial_txns   FOR ALL USING (has_case_access(case_id));
CREATE POLICY case_scoped ON reid_targets     FOR ALL USING (has_case_access(case_id));

-- Tables reached through a parent.
CREATE POLICY via_file ON ingest_jobs FOR ALL USING (EXISTS (
  SELECT 1 FROM source_files f WHERE f.id = file_id AND has_case_access(f.case_id)));

CREATE POLICY via_file ON review_items FOR ALL USING (EXISTS (
  SELECT 1 FROM source_files f WHERE f.id = source_file_id AND has_case_access(f.case_id)));

CREATE POLICY via_file ON evidence FOR ALL USING (EXISTS (
  SELECT 1 FROM source_files f WHERE f.id = source_file_id AND has_case_access(f.case_id)));

CREATE POLICY via_entity ON entity_aliases FOR ALL USING (EXISTS (
  SELECT 1 FROM entities e WHERE e.id = entity_id AND has_case_access(e.case_id)));

CREATE POLICY via_entity ON identifiers FOR ALL USING (EXISTS (
  SELECT 1 FROM entities e WHERE e.id = entity_id AND has_case_access(e.case_id)));

CREATE POLICY via_entity ON location_history FOR ALL USING (EXISTS (
  SELECT 1 FROM entities e WHERE e.id = entity_id AND has_case_access(e.case_id)));

CREATE POLICY via_entity ON entity_merges FOR ALL USING (EXISTS (
  SELECT 1 FROM entities e WHERE e.id = surviving_id AND has_case_access(e.case_id)));

CREATE POLICY via_target ON reid_candidates FOR ALL USING (EXISTS (
  SELECT 1 FROM reid_targets t WHERE t.id = target_id AND has_case_access(t.case_id)));

CREATE POLICY via_case ON insight_reviews FOR SELECT USING (true);

-- Auditors read the log for their assigned cases; nobody writes it from the client.
CREATE POLICY audit_readable ON audit_log
  FOR SELECT USING (case_id IS NOT NULL AND has_case_access(case_id));

-- Reference tables are readable by any authenticated user. They hold no case data.
ALTER TABLE cameras        ENABLE ROW LEVEL SECURITY;
ALTER TABLE camera_edges   ENABLE ROW LEVEL SECURITY;
ALTER TABLE engine_nodes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE weight_params  ENABLE ROW LEVEL SECURITY;

CREATE POLICY readable ON cameras        FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY readable ON camera_edges   FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY readable ON engine_nodes   FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY readable ON form_templates FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY readable ON weight_params  FOR SELECT USING (auth.uid() IS NOT NULL);

COMMIT;
