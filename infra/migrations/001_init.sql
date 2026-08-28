-- ============ IDENTITY / ACCESS (demo-simplified) ============
CREATE TYPE officer_role AS ENUM ('IO','ANALYST','AUDITOR');
CREATE TABLE officers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_no      text UNIQUE NOT NULL,
  full_name     text NOT NULL,
  role          officer_role NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_code     text UNIQUE NOT NULL,        -- 'OP-RAVEN-01'
  title         text NOT NULL,
  jurisdiction  text,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  lead_officer  uuid REFERENCES officers(id)
);

-- ============ SOURCE + PROVENANCE ============
CREATE TYPE source_node AS ENUM ('CCTNS','CFCFRMS','ICJS','VAHAN','NAFIS','TELECOM','MANUAL');
CREATE TYPE ingest_status AS ENUM
  ('received','hashing','stored','ocr','extracting','committed','needs_review','failed');

CREATE TABLE source_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES cases(id),
  filename       text NOT NULL,
  mime_type      text NOT NULL,
  byte_size      bigint NOT NULL,
  sha256         char(64) NOT NULL,
  storage_path   text NOT NULL,             -- supabase storage key
  source         source_node NOT NULL,
  status         ingest_status NOT NULL DEFAULT 'received',
  ledger_tx_id   text,                      -- fabric tx for the FILE hash
  ledger_status  text NOT NULL DEFAULT 'pending',
  extracted_text text,                      -- kept so spans stay resolvable
  page_map       jsonb,                     -- [{page:1, char_start:0, char_end:1840}]
  uploaded_by    uuid REFERENCES officers(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON source_files (case_id, status);
CREATE INDEX ON source_files (sha256);      -- duplicate-file detection

CREATE TABLE ingest_jobs (
  id            bigserial PRIMARY KEY,
  file_id       uuid NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  stage         text NOT NULL,
  status        text NOT NULL,              -- running|ok|failed
  error_detail  text,
  llm_attempts  smallint NOT NULL DEFAULT 0,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

-- ============ ENTITIES ============
CREATE TYPE entity_type AS ENUM ('PERSON','ORGANIZATION','LOCATION','VEHICLE','ACCOUNT');

CREATE TABLE entities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       uuid NOT NULL REFERENCES cases(id),
  type          entity_type NOT NULL,
  canonical_name text NOT NULL,
  nafis_id      text,                       -- ground-truth dedup key
  gender        text,
  dob           date,
  risk_score    numeric(5,2) DEFAULT 0,
  sync_state    text NOT NULL DEFAULT 'pending',  -- pending|synced (D4)
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON entities (nafis_id) WHERE nafis_id IS NOT NULL;
CREATE INDEX ON entities (case_id, type);

CREATE TABLE entity_aliases (
  id            bigserial PRIMARY KEY,
  entity_id     uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias         text NOT NULL,
  normalized    text NOT NULL,
  source_file_id uuid REFERENCES source_files(id),
  confidence    numeric(4,3),
  UNIQUE (entity_id, normalized)
);
CREATE INDEX ON entity_aliases (normalized);

CREATE TYPE identifier_type AS ENUM ('PHONE','VEHICLE','ACCOUNT','IMEI','NAFIS');
CREATE TABLE identifiers (
  id            bigserial PRIMARY KEY,
  entity_id     uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type          identifier_type NOT NULL,
  value         text NOT NULL,
  source_file_id uuid REFERENCES source_files(id),
  UNIQUE (type, value, entity_id)
);
CREATE INDEX ON identifiers (type, value);   -- the resolution workhorse

CREATE TABLE entity_merges (
  id            bigserial PRIMARY KEY,
  surviving_id  uuid NOT NULL REFERENCES entities(id),
  merged_id     uuid NOT NULL,
  reason        text NOT NULL,               -- 'nafis'|'shared_phone'|'manual'
  merged_by     uuid REFERENCES officers(id),
  reversible_snapshot jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============ RELATIONSHIPS + EVIDENCE ============
CREATE TYPE rel_type AS ENUM
  ('CALLED','TRANSFERRED_TO','CO_ACCUSED','CO_LOCATED','RESIDES_WITH','SEEN_WITH');

CREATE TABLE relationships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       uuid NOT NULL REFERENCES cases(id),
  src_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  dst_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type          rel_type NOT NULL,
  weight        numeric(10,3) NOT NULL DEFAULT 0,
  raw_score     numeric(10,3) NOT NULL DEFAULT 0,   -- pre-decay
  first_seen    timestamptz,
  last_seen     timestamptz,
  evidence_count int NOT NULL DEFAULT 0,
  sync_state    text NOT NULL DEFAULT 'pending',
  UNIQUE (src_entity_id, dst_entity_id, type)
);
CREATE INDEX ON relationships (case_id, weight DESC);

CREATE TABLE evidence (
  id             bigserial PRIMARY KEY,
  relationship_id uuid REFERENCES relationships(id) ON DELETE CASCADE,
  entity_id      uuid REFERENCES entities(id) ON DELETE CASCADE,
  source_file_id uuid NOT NULL REFERENCES source_files(id),
  kind           text NOT NULL,             -- 'fir_text'|'cdr_row'|'txn_row'|'cctv_sighting'
  snippet        text,                      -- the exact sentence
  char_start     int,
  char_end       int,
  page_no        int,
  confidence     numeric(4,3),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (relationship_id IS NOT NULL OR entity_id IS NOT NULL)
);
CREATE INDEX ON evidence (relationship_id);

-- ============ SIMULATED SOURCE TABLES ============
CREATE TABLE cdr_records (
  id            bigserial PRIMARY KEY,
  case_id       uuid NOT NULL REFERENCES cases(id),
  caller_msisdn text NOT NULL,
  callee_msisdn text NOT NULL,
  start_ts      timestamptz NOT NULL,
  duration_s    int NOT NULL,
  call_type     text,                       -- VOICE|SMS
  imei          text,
  cell_id       text,
  lat           double precision,
  lon           double precision,
  source_file_id uuid REFERENCES source_files(id)
);
CREATE INDEX ON cdr_records (caller_msisdn, start_ts DESC);
CREATE INDEX ON cdr_records (callee_msisdn, start_ts DESC);

CREATE TABLE financial_txns (
  id            bigserial PRIMARY KEY,
  case_id       uuid NOT NULL REFERENCES cases(id),
  from_account  text NOT NULL,
  to_account    text NOT NULL,
  amount        numeric(14,2) NOT NULL,
  currency      char(3) NOT NULL DEFAULT 'INR',
  ts            timestamptz NOT NULL,
  channel       text,                       -- UPI|NEFT|CASH
  source_file_id uuid REFERENCES source_files(id)
);
CREATE INDEX ON financial_txns (from_account, ts DESC);

CREATE TABLE location_history (
  id            bigserial PRIMARY KEY,
  entity_id     uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  ts            timestamptz NOT NULL,
  lat           double precision NOT NULL,
  lon           double precision NOT NULL,
  origin        text NOT NULL,              -- 'cdr'|'fir'|'address'|'cctv'
  accuracy_m    int,
  source_file_id uuid REFERENCES source_files(id)
);
CREATE INDEX ON location_history (entity_id, ts);

-- ============ CCTV ============
CREATE TABLE cameras (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text UNIQUE NOT NULL,       -- 'cam_01'
  label         text NOT NULL,
  lat           double precision NOT NULL,
  lon           double precision NOT NULL,
  feed_uri      text NOT NULL,              -- local mp4 path for the demo
  status        text NOT NULL DEFAULT 'online'
);

CREATE TABLE camera_edges (
  id            bigserial PRIMARY KEY,
  from_camera   uuid NOT NULL REFERENCES cameras(id),
  to_camera     uuid NOT NULL REFERENCES cameras(id),
  mean_travel_s int NOT NULL,
  stddev_s      int NOT NULL,
  path_label    text,
  UNIQUE (from_camera, to_camera)
);

CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE reid_targets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       uuid NOT NULL REFERENCES cases(id),
  label         text NOT NULL,              -- 'Target-Alpha'
  entity_id     uuid REFERENCES entities(id),   -- null until identified
  feature       vector(512) NOT NULL,
  source_camera uuid NOT NULL REFERENCES cameras(id),
  source_ts     timestamptz NOT NULL,
  thumbnail_path text,
  locked_by     uuid REFERENCES officers(id),
  ledger_tx_id  text,                       -- D9: lock-on is an anchored act
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reid_sightings (
  id            bigserial PRIMARY KEY,
  target_id     uuid NOT NULL REFERENCES reid_targets(id) ON DELETE CASCADE,
  camera_id     uuid NOT NULL REFERENCES cameras(id),
  ts            timestamptz NOT NULL,
  similarity    numeric(5,4) NOT NULL,
  bbox          int[] NOT NULL,             -- [x,y,w,h]
  frame_path    text,
  confirmed_by  uuid REFERENCES officers(id)
);
CREATE INDEX ON reid_sightings (target_id, ts);

-- ============ HUMAN LOOP + AUDIT ============
CREATE TABLE insight_reviews (            -- FR-2.3 human in the loop
  id            bigserial PRIMARY KEY,
  object_type   text NOT NULL,              -- 'relationship'|'entity'|'sighting'
  object_id     uuid NOT NULL,
  action        text NOT NULL,              -- 'confirm'|'reject'|'annotate'
  note          text,
  officer_id    uuid NOT NULL REFERENCES officers(id),
  ledger_tx_id  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  officer_id    uuid REFERENCES officers(id),
  action        text NOT NULL,              -- 'file.read'|'graph.query'|'reid.lock'|...
  object_type   text,
  object_id     uuid,
  payload_hash  char(64) NOT NULL,          -- what was anchored
  ledger_tx_id  text,
  ledger_status text NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (object_id, created_at DESC);

-- ============ EDGE WEIGHT FUNCTION (section 7.1) ============
CREATE OR REPLACE FUNCTION recompute_weight(rel_id uuid)
RETURNS numeric AS $$
DECLARE
  w numeric := 0;
  base numeric;
  age_days numeric;
  lambda numeric := ln(2) / 180;
  ev record;
BEGIN
  FOR ev IN
    SELECT e.kind, e.created_at
    FROM evidence e
    WHERE e.relationship_id = rel_id
  LOOP
    base := CASE ev.kind
      WHEN 'cdr_row' THEN 1
      WHEN 'cctv_sighting' THEN 10
      WHEN 'txn_row' THEN 10
      WHEN 'fir_text' THEN 25
      ELSE 1 END;
    age_days := EXTRACT(EPOCH FROM (now() - ev.created_at)) / 86400.0;
    w := w + base * exp(-lambda * age_days);
  END LOOP;
  UPDATE relationships SET weight = w, evidence_count = (
    SELECT count(*) FROM evidence WHERE relationship_id = rel_id
  ) WHERE id = rel_id;
  RETURN w;
END;
$$ LANGUAGE plpgsql;
