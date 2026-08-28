# Project Raven - System Architecture

**Problem Statement:** SIH26189 (MHA / NCRB, Women Safety Division)
**Theme:** Blockchain & Cybersecurity | Software
**Artifact Type:** Native Windows desktop application (.exe) + Dockerized local backend
**Document Scope:** **36-hour hackathon demo build only.** Production hardening is explicitly out of scope and is listed in section 18.

---

## 0. How to read this document

| Section | Answers the question |
| :--- | :--- |
| 1 - 3 | What are we building, on what hardware, with what running where |
| 4 | Which conventional choices we deliberately broke, and what we traded away |
| 5 - 6 | How the pieces talk to each other, step by step |
| 7 - 9 | Exact schemas and API contracts (build directly from these) |
| 10 | Every package, pinned, with its job |
| 11 - 13 | VRAM budget, synthetic data plan, user flows |
| 14 - 17 | Performance targets, failure modes, repo layout, honest security posture |
| 18 - 19 | What we are not building, and what is still undecided |

---

## 1. Scope Contract (read this before writing code)

### 1.1 In scope for the demo

- Ingest synthetic FIR PDFs (scanned and digital), CDR CSVs, financial CSVs, ICJS JSON.
- Local LLM entity extraction with schema-enforced JSON output.
- Dual-graph criminal network (micro ego-view and macro view) with weighted edges backed by clickable evidence.
- Key influencer ranking and three anomaly detectors.
- CCTV pedestrian detection, human-in-the-loop Re-ID lock-on, topology-driven camera handoff across a 4-camera synthetic network.
- Geospatial routine loop rendering from CDR pings.
- Hyperledger Fabric anchoring of file hashes and investigator actions, plus a live tamper-detection demo.

### 1.2 Explicitly NOT in scope

- Real government data or real API integration with CCTNS / CFCFRMS / ICJS. All six sources are simulated (section 12).
- Multi-user concurrency, real RLS policy sets, or role-based auth beyond a hardcoded officer switcher.
- Model training or fine-tuning. Everything runs on off-the-shelf weights.
- Cross-machine deployment. One machine, one operator.
- Fabric multi-org production topology, MSP hardening, or private data collections.

### 1.3 Assumptions carried into this design (unverified, confirm before build)

| # | Assumption | Impact if wrong |
| :--- | :--- | :--- |
| A1 | Single demo machine: RTX 5070 Laptop GPU (8GB VRAM), 16GB+ system RAM, Windows 11 + WSL2 | If RAM is 16GB, section 11.3 RAM budget becomes the binding constraint, not VRAM |
| A2 | CCTV input is 4 pre-recorded MP4 clips looped as fake live feeds | Live webcam input changes the ingest layer only, not the architecture |
| A3 | Docker Desktop with WSL2 backend is installable on the demo machine | No Docker means Fabric and Neo4j both die. This is the single largest risk (section 15) |
| A4 | Six team members, at least four writing code | Track split in section 16.3 assumes four coding tracks |
| A5 | Demo is presented offline with no reliable internet | Forces the MapLibre + PMTiles decision (D6) and full model pre-caching |

---

## 2. High-Level Topology

```text
+=========================================================================================+
|                        SINGLE MACHINE, FULLY LOCAL, NO EGRESS                           |
+=========================================================================================+
|                                                                                         |
|  [ LAYER 1 - NATIVE CLIENT ]  (raven.exe)                                               |
|  +-----------------------------------------------------------------------------------+ |
|  |  Tauri v2 Rust Core          |  Orchestrator, file I/O, saga coordinator,          | |
|  |                              |  Neo4j single-writer, ledger caller, audit emitter  | |
|  |  ----------------------------+--------------------------------------------------- | |
|  |  WebView2 (React 18 + Vite)  |  Cytoscape graph, MapLibre map, MJPEG video pane,   | |
|  |                              |  evidence side panel, anomaly inbox                 | |
|  +-----------------------------------------------------------------------------------+ |
|      |  invoke()          |  http :8756          |  ws :8756         |  img :8756       |
|      v                    v                      v                   v                  |
|  [ LAYER 2 - INTELLIGENCE ENGINE ]  (PyInstaller sidecar, FastAPI, port 8756)           |
|  +-----------------------------------------------------------------------------------+ |
|  |  >> VRAM Residency Manager (asyncio.Lock + explicit model eviction)                | |
|  |  >> NLP lane : EasyOCR -> Ollama (phi3:mini / gemma2:2b) -> JSON schema validator  | |
|  |  >> CV  lane : YOLOv8n tracker -> OSNet Re-ID (512-d) -> pgvector match            | |
|  |  >> Analytics lane : anomaly scans, routine clustering (CPU only, always resident) | |
|  +-----------------------------------------------------------------------------------+ |
|      |  pg :54322        |  bolt :7687        |  http :11434       |  http :8801        |
|      v                   v                    v                    v                     |
|  [ LAYER 3 - DATA + LEDGER NODE ]  (Docker Desktop / WSL2)                              |
|  +----------------+  +-------------------+  +--------------+  +----------------------+ |
|  | Supabase Local |  | Neo4j 5 Community |  | Ollama       |  | Fabric test-network  | |
|  | Postgres 15    |  | + GDS plugin      |  | (native Win, |  | 2 peers, 1 orderer,  | |
|  | + pgvector     |  | Bolt 7687         |  |  not Docker) |  | + Node REST gateway  | |
|  | + Storage/S3   |  | HTTP 7474         |  | port 11434   |  | port 8801            | |
|  | API 54321      |  |                   |  |              |  |                      | |
|  +----------------+  +-------------------+  +--------------+  +----------------------+ |
+=========================================================================================+
```

### 2.1 Port and process map

| Process | Port(s) | Runtime | Started by |
| :--- | :--- | :--- | :--- |
| raven.exe (Tauri shell) | n/a | Native Windows | User double-click |
| Vite dev server (dev only) | 1420 | Node | `npm run tauri dev` |
| Raven Intelligence Engine | 8756 (HTTP + WS + MJPEG) | PyInstaller onedir | Tauri sidecar spawn at startup |
| Ollama | 11434 | Native Windows service | Windows service, autostart |
| Supabase Local API (Kong) | 54321 | Docker | `supabase start` |
| Supabase Postgres | 54322 | Docker | `supabase start` |
| Supabase Studio | 54323 | Docker | `supabase start` |
| Neo4j Bolt / HTTP | 7687 / 7474 | Docker | `docker compose up neo4j` |
| Fabric peers / orderer | 7051, 9051, 7050 | Docker (WSL2) | `./network.sh up createChannel` |
| Fabric REST gateway | 8801 | Node 20 (WSL2 or Windows) | `node gateway/server.js` |

### 2.2 Cold start order (this order is mandatory)

1. Docker Desktop up, WSL2 integration enabled.
2. `supabase start` (slowest, ~60s first run).
3. `docker compose up -d neo4j`, wait for Bolt healthcheck.
4. Fabric `./network.sh up createChannel -c ravenchannel -ca` then `deployCC`.
5. `node gateway/server.js` (verifies chaincode reachable, exits loudly if not).
6. Confirm `ollama list` shows both models pulled.
7. Launch `raven.exe`. Tauri spawns the Python sidecar and blocks the UI on a startup health gate that pings all five dependencies and shows a red/green board.

> **Build note:** the startup health gate is not optional polish. It is the single highest-value hour you will spend, because it converts "the demo is broken and we do not know why" into "Neo4j is red".

---

## 3. Component Responsibilities

### 3.1 Rust Core (Tauri v2)

The Rust core is not a thin shell. It owns four things nothing else is allowed to touch:

1. **Filesystem access.** Only Rust reads user files off disk. Python never receives a path outside the app data dir.
2. **Write orchestration.** All Postgres + Neo4j + Fabric writes flow through Rust as a single-writer saga coordinator (section 6.1). Python is read-mostly and write-only-to-cache.
3. **Hashing.** SHA-256 computed in Rust over the raw file bytes, streamed in 64KB chunks so a 200MB CDR dump does not balloon memory.
4. **Audit emission.** Every state-changing command emits an audit record before returning to the UI.

### 3.2 React Frontend

Four panes, one window, no routing between full pages (state is preserved so the graph never re-lays-out mid-demo):

- **Graph pane** - Cytoscape.js, micro (ego) and macro toggle.
- **Evidence pane** - right side panel, opens on node or edge click, shows provenance chain down to the source PDF page and the ledger tx id.
- **Map pane** - MapLibre GL JS over a local PMTiles basemap.
- **Vision pane** - MJPEG `<img>` element plus an absolutely positioned SVG overlay for bounding boxes.

### 3.3 Python Intelligence Engine

A FastAPI app bundled by PyInstaller and shipped as a Tauri sidecar binary. Three lanes with different residency rules:

| Lane | Device | Residency | Can be evicted |
| :--- | :--- | :--- | :--- |
| NLP (Ollama) | GPU | On demand | Yes, evicted by CV lane |
| CV (YOLOv8 + OSNet) | GPU | On demand | Yes, evicted by NLP lane |
| OCR (EasyOCR) | CPU forced | Always | No |
| Analytics (pandas, sklearn, scipy) | CPU | Always | No |

### 3.4 Data + Ledger Node

- **Supabase Local** - Postgres 15 with pgvector, plus Storage for raw file blobs. Source of truth for everything.
- **Neo4j 5 Community + GDS** - derived projection of the relationship data, plus the camera topology graph. Rebuildable from Postgres at any time (this is a deliberate property, see D4).
- **Hyperledger Fabric test-network** - append-only anchor of file hashes and officer actions. Never stores case content.

---

## 4. Non-Conventional Decisions (the part judges and reviewers should read)

Each row states what the textbook approach would be, what we did instead, why, and what it cost us.

| ID | Area | Conventional approach | Raven's decision | Why | Cost we accepted |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **D1** | Rust to Python transport | Tauri IPC / `invoke` with JSON serialization | Python runs as a **sidecar HTTP + WebSocket server on localhost:8756**; Rust and React both call it over the loopback | Tauri IPC serializes every payload to a string and hops the Rust bridge. Video frames and 5MB extraction payloads through that pipe stall the WebView render thread | Two transports to debug instead of one. Port collision risk (mitigated by an uncommon port) |
| **D2** | GPU model serving | Load all models at startup and keep them resident | **VRAM Residency Manager**: a single `asyncio.Lock` gates the GPU. Acquiring it for CV explicitly unloads Ollama (`keep_alive: 0`), acquiring for NLP calls `del model; torch.cuda.empty_cache()` on the CV stack | 8GB cannot hold a 3.8B LLM plus YOLOv8 plus OSNet plus CUDA context. Concurrent use is a guaranteed OOM crash mid-demo | No true parallelism. A tracking session blocks document ingestion for its duration. UI must surface this as a queue, not hang |
| **D3** | Video to UI | WebRTC, or base64 frames over WebSocket | **MJPEG over `multipart/x-mixed-replace`** consumed by a plain `<img src>`; bounding boxes sent separately as JSON over WebSocket and drawn as an **SVG overlay** | The browser decodes MJPEG natively with zero JS involvement. Separating boxes from pixels lets overlays re-render at UI framerate and makes box coordinates inspectable and testable | MJPEG is bandwidth-hungry (irrelevant on loopback) and has no audio (irrelevant here) |
| **D4** | Postgres / Neo4j consistency | Two-phase commit | **Saga with compensating transactions and an idempotent rebuild path.** Postgres commits first and is the source of truth. Neo4j writes use `MERGE` (idempotent). On Neo4j failure the row is marked `sync_state='pending'` and a background reconciler retries. A `rebuild_graph()` command can regenerate all of Neo4j from Postgres in under 30 seconds | **Correcting the PRD here:** true 2PC requires an XA transaction manager and prepared-transaction support on both resources. Neo4j Community and the Bolt driver do not offer that. Calling it 2PC in a document a judge might probe is a risk. A saga is the honest and correct pattern | Brief windows of graph staleness. Accepted because Neo4j is a derived index, not a system of record |
| **D5** | Blockchain write timing | Anchor everything in one transaction | **Two independent anchors.** The file hash is anchored at ingest (it is a fact about bytes, independent of whether extraction succeeded). The extraction result hash is anchored only after the Postgres commit succeeds | Ledger writes are irreversible. Anchoring a derived result before its database commit creates an on-chain record of something that may not exist | Two tx ids per document to track |
| **D6** | Basemap | Mapbox GL JS | **MapLibre GL JS + a local PMTiles file** served by the Python engine | **This is a real loophole in the current PRD.** Mapbox and Leaflet's default tiles both fetch from the internet. An air-gapped claim collapses the moment a judge unplugs the network and the map goes grey | One extra asset to prepare (a ~150MB Maharashtra extract). Slightly plainer cartography |
| **D7** | Re-ID vector storage | Dedicated vector DB (Milvus, Qdrant, FAISS) | **pgvector column in Postgres**, `vector(512)`, cosine distance | The corpus is tens of vectors, not millions. A whole extra service for that is unjustifiable RAM. It also keeps the sighting, the vector, and its evidence row in one transaction | Would not scale past ~1M vectors. Irrelevant at demo scale |
| **D8** | CCTV tracking | Run Re-ID continuously across all cameras | **Topology-gated activation.** Neo4j stores `(:Camera)-[:LEADS_TO {mean_travel_s, stddev_s}]->(:Camera)`. After lock-on, inference is suspended on the source camera and booted only on adjacent cameras, only inside the predicted arrival window | This is the actual intellectual contribution of the CV module. It turns an O(cameras) compute problem into O(adjacent cameras), and it uses the graph database for something other than the obvious | If the target takes an unmapped route, tracking is lost. This is by design and is surfaced in the UI as "target lost, expand search" rather than hidden |
| **D9** | Person Re-ID | Fully automatic cross-camera matching | **Human-in-the-loop lock-on.** YOLO assigns 2-digit IDs, the officer clicks the target, only then is a feature vector generated | Automatic Re-ID accuracy on 8GB commodity hardware with low-res CCTV is poor, and a false auto-match in a policing tool is a serious harm. The officer's click is also a legally meaningful act, so it gets anchored on-chain | Requires an operator. Positioned as a feature (evidentiary accountability), not a limitation |
| **D10** | Neo4j writers | Any service may write | **Rust is the only writer.** Python has read-only Bolt credentials | Removes an entire class of concurrent-write races between the sidecar and the core, and means every graph mutation passes the audit emitter | Python must round-trip through Rust for graph writes (only the anomaly engine needs this, so the cost is small) |
| **D11** | LLM output handling | Prompt for JSON and parse | **Grammar-constrained decode**: Ollama `format: json` plus a Pydantic model plus one bounded repair retry that feeds the validation error back into the prompt. Third failure quarantines the document into `ingest_jobs.status='needs_review'` | An unparseable LLM response during a live demo is the most likely soft failure mode. Fail into a visible queue, never into a crash or a silent drop | One extra inference round-trip on malformed output |
| **D12** | Supabase Local footprint | `supabase start` defaults | **Trimmed `config.toml`**: analytics, imgproxy, edge-runtime, inbucket and realtime disabled | The default stack is ~10 containers and the analytics (Logflare) container alone is a well-known RAM hog. On a machine also running Neo4j, Fabric and CUDA, RAM is the binding constraint | Lose Studio's log viewer. Acceptable |
| **D13** | Fabric client | Call Fabric from Rust | **Node.js `@hyperledger/fabric-gateway` wrapped in a thin Express REST service on :8801**, called by Rust over HTTP | There is no maintained production-grade Rust SDK for Fabric. Writing gRPC and MSP handling by hand in Rust is a 20-hour detour on a 36-hour budget | One more process. Mitigated because it is ~150 lines and has a health endpoint |

---

## 5. Ingestion Pipeline Architecture

### 5.1 Router logic (Rust, FR-1.1)

```
file dropped
  |
  +-- sniff magic bytes (infer crate), NOT the file extension
  |
  +-- text/csv, application/json  -> STRUCTURED LANE
  |     direct typed parse -> staging tables -> deterministic edge builder
  |     (no LLM, no GPU, no VRAM lock)
  |
  +-- application/pdf             -> is there an embedded text layer?
  |     yes -> extract text directly (pdf-extract), skip OCR
  |     no  -> UNSTRUCTURED LANE, OCR first
  |
  +-- image/png, image/jpeg       -> UNSTRUCTURED LANE, OCR first
  |
  +-- anything else               -> reject with a UI-visible reason
```

> **Decision:** digital PDFs bypass OCR entirely. Roughly half your synthetic FIRs should be digital-text PDFs, because that path is ~40x faster and is what you demo live. Scanned FIRs demo the OCR capability but should be pre-ingested before the presentation.

### 5.2 Extraction contract (FR-1.2)

The LLM is given one job per call and a hard schema. Do not ask one prompt to do NER, relation extraction and summarization.

**Call 1 - Entity extraction:**
```json
{
  "entities": [
    {"type": "PERSON", "name": "...", "aliases": ["..."], "role": "ACCUSED|VICTIM|WITNESS|COMPLAINANT",
     "span": [start, end], "confidence": 0.0}
  ],
  "identifiers": [
    {"type": "PHONE|VEHICLE|ACCOUNT|IMEI", "value": "...", "belongs_to": "<entity name>", "span": [start, end]}
  ],
  "locations": [{"name": "...", "span": [start, end]}],
  "incident": {"fir_number": "...", "date": "YYYY-MM-DD", "sections": ["..."], "police_station": "..."}
}
```

**Call 2 - Relation extraction** (given the entity list from call 1):
```json
{
  "relations": [
    {"src": "...", "dst": "...", "type": "CO_ACCUSED|CALLED|TRANSFERRED_TO|RESIDES_WITH|SEEN_WITH",
     "evidence_span": [start, end], "confidence": 0.0}
  ]
}
```

Every `span` is a character offset into the extracted text. This is what makes the evidence panel real: clicking an edge highlights the exact sentence in the source document. **Do not skip spans.** They are the difference between "the AI says so" and "here is the line it came from", which is the entire explainability requirement of the problem statement.

### 5.3 Entity resolution (FR-1.3)

Deterministic, no ML, executed in Rust in this priority order:

1. **NAFIS biometric hash match** - exact match collapses two entities unconditionally (ground truth).
2. **Unique identifier match** - shared phone, vehicle plate, or account number.
3. **Alias table match** - normalized name (lowercase, strip honorifics, collapse whitespace, Levenshtein <= 2) plus at least one shared identifier or shared FIR.
4. **No match** - create a new entity.

Merges are recorded in `entity_merges` and are reversible, because a wrong merge in a policing tool is a serious error and an auditor must be able to unwind it.

---

## 6. Data Flow Architectures

### 6.1 Document ingest saga (corrected from the PRD's 2PC)

```
Step  Actor    Action                                                  On failure
----  -----    ------------------------------------------------------ ---------------------------
 1    Rust     stream file, SHA-256                                    abort, nothing written
 2    Rust     INSERT source_files (ingest_status='hashing')           abort
 3    Rust     upload blob -> Supabase Storage                         DELETE row, abort
 4    Rust     POST /ledger/anchor {docHash}                           mark ledger_status='pending',
                                                                       CONTINUE (do not block ingest)
 5    Rust     UPDATE source_files SET ledger_tx_id
 6    Rust     -> Python POST /ocr/extract  (if needed)                mark job 'ocr_failed', stop
 7    Rust     -> Python POST /nlp/extract                             D11 repair, then 'needs_review'
 8    Rust     BEGIN pg txn: upsert entities, identifiers,
               relationships, evidence  COMMIT                          ROLLBACK, job 'failed'
 9    Rust     Cypher MERGE nodes + edges (idempotent)                 set sync_state='pending',
                                                                       reconciler retries, UI shows
                                                                       an amber "graph syncing" chip
10    Rust     POST /ledger/action {extraction_hash}                   retry queue
11    Rust     emit ws event ingest.complete -> UI refresh
```

Key property: **steps 8 and 9 are not atomic and do not need to be.** Step 9 is a `MERGE`, so replaying it is safe, and `rebuild_graph()` regenerates the entire graph from step 8's data. The graph is an index, not a record.

### 6.2 Graph query flow (FR-3.1, FR-3.2)

```
UI click on node "Rakesh S."
  -> invoke('get_ego_graph', {entity_id, hops: 2, min_weight: 5})
  -> Rust: Bolt query with a LIMIT and a weight floor
  -> Rust: hydrate edge evidence counts from Postgres in ONE batched query
     (never N+1 per edge)
  -> return {nodes[], edges[]} to Cytoscape
  -> UI: cose-bilkent layout, edge width = f(weight), color = dominant evidence type
```

Edge click does **not** re-query the graph. It calls `get_edge_evidence(edge_id)` which reads Postgres only, so the layout never reflows. Layout reflow mid-demo looks like a bug even when it is not.

### 6.3 Spatio-temporal CCTV flow (FR-5.x, the D8 showcase)

```
 1. PASSIVE   Python decodes cam_01 at 15 FPS, YOLOv8n person class only,
              ByteTrack assigns stable track ids -> "01".."NN"
              MJPEG out on /cv/stream/cam_01.mjpg, boxes out on ws /ws/cv/{session}
              GPU: ~1.2GB. Ollama still resident.

 2. LOCK-ON   Officer clicks thumbnail "07".
              -> POST /cv/session/{id}/lock_on {track_id: 7}
              -> VRAM manager acquires GPU for CV lane -> evicts Ollama
              -> crop bbox, OSNet forward pass -> 512-d L2-normalized vector
              -> INSERT reid_targets (vector, thumbnail, source_camera, ts)
              -> Rust anchors the lock-on as an officer action on-chain (D9)

 3. PREDICT   Cypher: MATCH (c:Camera {code:'cam_01'})-[r:LEADS_TO]->(n:Camera)
                      RETURN n.code, r.mean_travel_s, r.stddev_s
              window = [now + mean - 2*stddev, now + mean + 2*stddev]

 4. HANDOFF   suspend inference on cam_01
              boot YOLO+OSNet on each adjacent camera, ONLY inside its window
              every detected person -> OSNet vector -> pgvector cosine search
              match if similarity > 0.72 (tune on synthetic data, do not guess live)

 5. RESULT    on match: INSERT reid_sighting, ws push, map pin drops,
              new window computed from the NEW camera's outbound edges
              on window expiry with no match: emit "target lost at cam_01",
              offer "widen to 2-hop cameras"
```

### 6.4 Tamper verification flow (the demo's money shot)

```
Officer opens FIR-102 evidence panel
  -> Rust re-reads the blob from Supabase Storage, recomputes SHA-256
  -> GET /ledger/verify/{doc_id} -> on-chain hash
  -> match    : green shield, "Verified against ledger tx a3f9...", timestamp
  -> mismatch : TAMPER_WARNING_RED, the source node and all edges derived
                from this document are greyed out and non-interactive in
                Cytoscape, an audit entry is written, and the panel shows
                both hashes side by side
```

To demo this: keep a "corrupt evidence" dev button that flips one byte in the stored blob. Judges remember the red state far more than the green one.

### 6.5 Anomaly scan (FR-4.2)

Runs on CPU, on a 30-second timer, never touches the GPU, so it cannot interfere with D2:

| Detector | Method | Threshold |
| :--- | :--- | :--- |
| Communication spike | Per-pair call counts, 24h window vs 30-day rolling mean | z-score > 3.0 |
| Geographic convergence | DBSCAN over CDR pings of known associates, eps=250m, 60-min window | >= 3 associates in one cluster |
| Irregular financial flow | Amount vs per-account 90-day median, plus structuring detection (repeated sub-threshold transfers) | 5x median, or 3+ txns in 24h at 90-100% of a round threshold |
| Key influencer | Neo4j GDS betweenness centrality + degree, weighted | top 5% of nodes |

---

## 7. Relational Schema (Postgres 15, source of truth)

```sql
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
  centrality    numeric(8,5) DEFAULT 0,     -- written back by GDS
  is_influencer boolean NOT NULL DEFAULT false,
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

-- ============ ANOMALIES + HUMAN LOOP + AUDIT ============
CREATE TABLE anomalies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       uuid NOT NULL REFERENCES cases(id),
  kind          text NOT NULL,              -- comm_spike|geo_convergence|financial|influencer
  severity      smallint NOT NULL,          -- 1..5
  entity_ids    uuid[] NOT NULL,
  window_start  timestamptz,
  window_end    timestamptz,
  score         numeric(8,3),
  detail        jsonb NOT NULL,             -- detector-specific, drives the UI card
  status        text NOT NULL DEFAULT 'new',-- new|confirmed|rejected
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON anomalies (case_id, status, severity DESC);

CREATE TABLE insight_reviews (            -- FR-2.3 human in the loop
  id            bigserial PRIMARY KEY,
  object_type   text NOT NULL,              -- 'relationship'|'anomaly'|'entity'|'sighting'
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
```

### 7.1 Edge weight, defined precisely

The PRD says `Weight = Sum(...) * Time_Decay_Factor`. That is underspecified. Use this:

```
base points:  CALLED = 1        (per call)
              CO_LOCATED = 10   (per CCTV co-appearance)
              TRANSFERRED_TO = 10 (per transaction)
              CO_ACCUSED = 25   (per shared FIR)

decay:        lambda = ln(2) / 180        # 180-day half life
              w = SUM over evidence_i of ( base_i * exp(-lambda * age_days_i) )

display:      edge_width_px = clamp(1 + 1.6 * ln(1 + w), 1, 12)
```

Recomputed by a Postgres function `recompute_weight(rel_id)` called after every evidence insert, then pushed to Neo4j in the same saga step.

---

## 8. Graph Schema (Neo4j 5 + GDS)

Two disjoint subgraphs in one database. This is deliberate: the camera topology gets the same traversal engine for free.

```cypher
// ---------- constraints and indexes (run once at bootstrap) ----------
CREATE CONSTRAINT person_id IF NOT EXISTS
  FOR (p:Person) REQUIRE p.entity_id IS UNIQUE;
CREATE CONSTRAINT camera_code IF NOT EXISTS
  FOR (c:Camera) REQUIRE c.code IS UNIQUE;
CREATE INDEX person_case IF NOT EXISTS FOR (p:Person) ON (p.case_id);
CREATE INDEX link_weight IF NOT EXISTS
  FOR ()-[r:LINKED_TO]-() ON (r.weight);
```

**Node labels**

| Label | Properties | Notes |
| :--- | :--- | :--- |
| `:Person` | `entity_id, case_id, name, risk_score, centrality, is_influencer, nafis_id` | Only PERSON entities are projected. Per FR-3, the graph is strictly P2P to avoid hairballs |
| `:Camera` | `code, label, lat, lon` | Separate component, never rendered in the criminal graph |

**Relationship types**

| Type | Direction | Properties |
| :--- | :--- | :--- |
| `:LINKED_TO` | undirected in practice, stored src->dst | `weight, call_count, money_total, co_accused_count, colocation_count, first_seen, last_seen, evidence_count, rel_id` |
| `:LEADS_TO` | directed | `mean_travel_s, stddev_s, path_label` |

**Why entities other than PERSON are not nodes:** phones, vehicles and accounts are stored as Postgres `identifiers` and used only during resolution and weighting. Putting them in the graph triples the node count and produces the star-shaped clutter that makes link-analysis demos unreadable. This is decision D14, and it is worth saying out loud to judges because "we removed nodes on purpose" is a stronger claim than "we drew everything".

**Core queries**

```cypher
// Ego graph, 2 hop, weight-floored (FR-3.1)
MATCH path = (p:Person {entity_id: $id})-[r:LINKED_TO*1..2]-(n:Person)
WHERE ALL(rel IN relationships(path) WHERE rel.weight >= $minWeight)
RETURN path LIMIT 300;

// Macro view, top-N by weight (FR-3.2)
MATCH (a:Person)-[r:LINKED_TO]->(b:Person)
WHERE a.case_id = $caseId AND r.weight >= $minWeight
RETURN a, r, b ORDER BY r.weight DESC LIMIT 1000;

// Key influencers via GDS (FR-4.1)
CALL gds.graph.project('raven', 'Person',
  {LINKED_TO: {orientation: 'UNDIRECTED', properties: 'weight'}});
CALL gds.betweenness.stream('raven')
YIELD nodeId, score
RETURN gds.util.asNode(nodeId).entity_id AS entity_id, score
ORDER BY score DESC LIMIT 10;

// Camera handoff prediction (D8)
MATCH (:Camera {code: $from})-[r:LEADS_TO]->(next:Camera)
RETURN next.code, r.mean_travel_s, r.stddev_s;

// Idempotent upsert used by the saga (D4)
MERGE (a:Person {entity_id: $src})
  ON CREATE SET a.name = $srcName, a.case_id = $caseId
MERGE (b:Person {entity_id: $dst})
  ON CREATE SET b.name = $dstName, b.case_id = $caseId
MERGE (a)-[r:LINKED_TO {rel_id: $relId}]->(b)
  SET r.weight = $weight, r.evidence_count = $ec, r.last_seen = $lastSeen;
```

> **Gotcha:** GDS is not in the stock `neo4j:5` image. Set `NEO4J_PLUGINS='["graph-data-science"]'` in the container env or influencer analysis silently has no procedures to call.

---

## 9. Ledger Schema (Hyperledger Fabric)

**Network:** `fabric-samples` test-network, 2 orgs, 1 peer each, 1 orderer, Raft, channel `ravenchannel`, chaincode `ravenledger` (Node.js contract API).

**World state assets**

```jsonc
// key: EVIDENCE_<docId>
{
  "docType": "evidence",
  "docId": "uuid",
  "sha256": "64 hex",
  "caseCode": "OP-RAVEN-01",
  "sourceNode": "CCTNS",
  "officerBadge": "MH-1188",
  "anchoredAt": "ISO-8601"
}

// key: ACTION_<uuid>
{
  "docType": "action",
  "actionId": "uuid",
  "action": "reid.lock|insight.confirm|file.read|insight.reject",
  "objectType": "reid_target",
  "objectId": "uuid",
  "payloadHash": "64 hex",
  "officerBadge": "MH-1188",
  "at": "ISO-8601"
}
```

**Chaincode functions**

| Function | Type | Purpose |
| :--- | :--- | :--- |
| `AnchorEvidence(docId, sha256, caseCode, sourceNode, badge)` | submit | Write once. Rejects if key exists (evidence hashes are immutable) |
| `LogAction(actionId, action, objectType, objectId, payloadHash, badge)` | submit | Append officer action |
| `VerifyHash(docId, candidateSha)` | evaluate | Returns `{match: bool, onChain, txId, anchoredAt}` |
| `GetEvidence(docId)` | evaluate | Full asset |
| `GetHistoryForKey(key)` | evaluate | Fabric's built-in tx history, used for the audit trail view |

**Never on chain:** names, FIR text, phone numbers, images, vectors. Only hashes, ids and timestamps. Say this explicitly in the pitch, because a judge on a cybersecurity theme will ask whether you put PII on an immutable ledger, and "no, and here is the schema" is the answer that wins.

---

## 10. API Contracts

### 10.1 Tauri commands (React calls these via `invoke`)

| Command | Args | Returns | Side effects |
| :--- | :--- | :--- | :--- |
| `health_check` | - | `{supabase, neo4j, ollama, fabric, python: "up"\|"down", vram_free_mb}` | none |
| `ingest_file` | `{path, case_id, source}` | `{job_id, file_id}` | starts saga 6.1, streams progress over WS |
| `get_ingest_status` | `{job_id}` | `{stage, status, error_detail}` | none |
| `get_ego_graph` | `{entity_id, hops, min_weight}` | `{nodes[], edges[]}` | audit `graph.query` |
| `get_macro_graph` | `{case_id, min_weight, limit}` | `{nodes[], edges[]}` | audit |
| `get_edge_evidence` | `{rel_id}` | `{evidence[], source_files[]}` | audit `file.read` |
| `verify_evidence` | `{file_id}` | `{match, local_sha, chain_sha, tx_id, anchored_at}` | audit |
| `review_insight` | `{object_type, object_id, action, note}` | `{review_id, tx_id}` | writes pg + ledger |
| `list_anomalies` | `{case_id, status}` | `Anomaly[]` | none |
| `get_routine` | `{entity_id, from, to}` | `{points[], hotspots[], loop[]}` | audit |
| `start_tracking` | `{camera_code}` | `{session_id, stream_url, ws_url}` | starts CV session |
| `lock_on_target` | `{session_id, track_id, label}` | `{target_id, tx_id}` | VRAM switch + ledger write |
| `stop_tracking` | `{session_id}` | `{ok}` | releases GPU |
| `rebuild_graph` | `{case_id}` | `{nodes, edges, ms}` | D4 recovery path |
| `get_audit_trail` | `{object_id}` | `AuditEntry[]` | none |

### 10.2 Python Intelligence Engine (`http://127.0.0.1:8756`)

| Method | Path | Body / Params | Returns |
| :--- | :--- | :--- | :--- |
| GET | `/health` | - | `{status, models_loaded[], vram_free_mb, lane_holder}` |
| GET | `/vram/status` | - | `{holder: "nlp"\|"cv"\|null, free_mb, queue_depth}` |
| POST | `/ocr/extract` | `{file_path, dpi?}` | `{text, page_map[], ms}` |
| POST | `/nlp/extract_entities` | `{text, doc_id}` | schema in 5.2, plus `{attempts, ms}` |
| POST | `/nlp/extract_relations` | `{text, doc_id, entities[]}` | `{relations[], ms}` |
| POST | `/nlp/summarize_edge` | `{evidence[]}` | `{summary}` (used in the edge panel) |
| POST | `/cv/session/start` | `{camera_code, feed_uri}` | `{session_id, stream_url, ws_url}` |
| POST | `/cv/session/{id}/lock_on` | `{track_id}` | `{target_vector_b64, thumbnail_path, crop_bbox}` |
| POST | `/cv/session/{id}/watch` | `{cameras[], window_start, window_end, target_id}` | `{watch_id}` |
| POST | `/cv/session/{id}/stop` | - | `{ok, gpu_released: true}` |
| GET | `/cv/stream/{camera_code}.mjpg` | - | `multipart/x-mixed-replace` |
| POST | `/analytics/anomaly_scan` | `{case_id}` | `{anomalies[]}` |
| POST | `/analytics/routine` | `{entity_id, from, to}` | `{hotspots[], loop[], dwell_minutes}` |
| GET | `/tiles/{z}/{x}/{y}.pbf` | - | local PMTiles vector tiles (D6) |
| WS | `/ws/events` | - | see 10.4 |

### 10.3 Fabric REST gateway (`http://127.0.0.1:8801`)

| Method | Path | Body | Returns |
| :--- | :--- | :--- | :--- |
| GET | `/health` | - | `{peer: "up", channel, chaincode}` |
| POST | `/ledger/anchor` | `{docId, sha256, caseCode, sourceNode, badge}` | `{txId, anchoredAt}` |
| POST | `/ledger/action` | `{actionId, action, objectType, objectId, payloadHash, badge}` | `{txId}` |
| GET | `/ledger/verify/:docId?sha=...` | - | `{match, onChain, txId, anchoredAt}` |
| GET | `/ledger/history/:key` | - | `{entries[]}` |

### 10.4 WebSocket event envelope

One channel, discriminated union, versioned from day one:

```jsonc
{ "v": 1, "type": "<event>", "ts": "ISO-8601", "payload": { } }
```

| `type` | Payload | Consumer |
| :--- | :--- | :--- |
| `ingest.progress` | `{job_id, stage, pct}` | ingest toast |
| `ingest.complete` | `{file_id, entities_added, relations_added}` | graph refresh |
| `ingest.needs_review` | `{file_id, reason}` | review queue badge |
| `cv.detections` | `{session_id, frame_ts, boxes:[{track_id,x,y,w,h,conf}]}` | SVG overlay |
| `cv.handoff_predicted` | `{target_id, from_camera, to_cameras:[{code, window_start, window_end}]}` | map animation |
| `cv.sighting` | `{target_id, camera_code, similarity, ts, thumb}` | map pin + timeline |
| `cv.target_lost` | `{target_id, last_camera, searched_until}` | amber banner |
| `vram.state` | `{holder, free_mb, evicted}` | GPU chip in the status bar |
| `anomaly.new` | `{anomaly_id, kind, severity, entity_ids}` | anomaly inbox |
| `ledger.tamper` | `{file_id, local_sha, chain_sha}` | red tamper modal |

### 10.5 Error envelope (every HTTP layer, no exceptions)

```jsonc
{ "ok": false, "code": "VRAM_BUSY", "message": "CV lane holds the GPU",
  "retryable": true, "retry_after_ms": 2000, "trace_id": "..." }
```

Codes: `VRAM_BUSY`, `MODEL_LOAD_FAILED`, `LLM_SCHEMA_INVALID`, `OCR_FAILED`, `LEDGER_UNREACHABLE`, `GRAPH_SYNC_PENDING`, `FILE_REJECTED`, `TAMPER_DETECTED`.

---

## 11. Technology and Package Register

### 11.1 Native shell (Rust)

| Crate | Version | Role | Why this one |
| :--- | :--- | :--- | :--- |
| `tauri` | 2.x | App shell, WebView2 host, command bridge | v2 required for the current sidecar and permissions model |
| `tauri-plugin-shell` | 2.x | Spawns the Python sidecar | v2 moved sidecar out of core into this plugin |
| `tauri-plugin-dialog` | 2.x | Native file picker | Keeps file selection in the OS layer |
| `tauri-plugin-fs` | 2.x | Scoped filesystem access | Scope config prevents arbitrary path reads |
| `tokio` | 1.x | Async runtime | Everything downstream is async |
| `reqwest` | 0.12 | HTTP client to Python + Fabric gateway | rustls, no OpenSSL build pain on Windows |
| `neo4rs` | 0.8 | Neo4j Bolt driver | Only maintained pure-Rust Bolt driver |
| `sqlx` | 0.8 | Postgres, compile-time checked SQL | Catches schema drift at build time, not demo time |
| `sha2` | 0.10 | SHA-256 over streamed file chunks | Constant memory on large files |
| `serde` / `serde_json` | 1.x | Serialization | - |
| `infer` | 0.16 | MIME sniffing from magic bytes | Extensions lie, this is a security posture point |
| `pdf-extract` | 0.7 | Text layer extraction from digital PDFs | Lets ~50% of files skip OCR entirely |
| `uuid` | 1.x | Ids | v4 |
| `thiserror` / `anyhow` | 1.x | Error types | Maps cleanly into the 10.5 envelope |
| `tracing` / `tracing-subscriber` | 0.1 / 0.3 | Structured logs to a rotating file | Post-mortem after a failed run |

### 11.2 Frontend (Node / React)

| Package | Version | Role | Why this one |
| :--- | :--- | :--- | :--- |
| `react` / `react-dom` | 18.3 | UI | - |
| `vite` | 5.x | Dev server and bundler | Tauri's default, fast HMR |
| `typescript` | 5.x | Types | Shared types generated from the Rust command signatures |
| `tailwindcss` | 3.4 | Styling | - |
| `cytoscape` | 3.30 | Graph rendering | Handles 10k+ elements in canvas; D3 force layout stalls at that size |
| `cytoscape-cose-bilkent` | 4.1 | Force layout | Best compound/cluster layout for social graphs |
| `cytoscape-fcose` | 2.2 | Fast layout for the macro view | fCoSE is ~5x faster than cose-bilkent on 1000+ nodes |
| `react-cytoscapejs` | 2.0 | React wrapper | Keeps the cy instance out of React's render cycle |
| `maplibre-gl` | 4.x | Map rendering | **D6**: open fork of Mapbox GL, no token, no forced network calls |
| `pmtiles` | 3.x | Single-file offline tile source | One `.pmtiles` file replaces a tile server |
| `@tauri-apps/api` | 2.x | `invoke`, event listeners | - |
| `zustand` | 4.x | Client state | Less ceremony than Redux for a 36-hour build |
| `@tanstack/react-query` | 5.x | Server state, caching, retry | Free retry/backoff for the `VRAM_BUSY` code |
| `recharts` | 2.x | Timeline and anomaly charts | - |
| `lucide-react` | 0.4x | Icons | - |
| `date-fns` | 3.x | Time windows and decay display | - |

### 11.3 Intelligence engine (Python 3.11)

| Package | Version | Role | Why / gotcha |
| :--- | :--- | :--- | :--- |
| `fastapi` | 0.115 | HTTP + WS server | - |
| `uvicorn[standard]` | 0.30 | ASGI server | `--workers 1` mandatory: multiple workers means multiple CUDA contexts and instant OOM |
| `pydantic` | 2.x | LLM output schema enforcement (D11) | The validation error text is fed back into the repair prompt |
| `torch` | 2.x **+cu128** | Tensor runtime | **Critical:** the RTX 5070 is Blackwell, compute capability sm_120. Default PyPI wheels top out at sm_90 and will refuse the GPU. Install from the cu128 index and verify `torch.cuda.get_device_capability() == (12, 0)` before anything else |
| `torchvision` | matching cu128 | Transforms for Re-ID crops | Must match the torch build exactly |
| `ultralytics` | 8.3 | YOLOv8n detection + ByteTrack | Built-in tracker gives stable ids without a second dependency |
| `boxmot` | 11.x | OSNet Re-ID weights and embedding API | Ships `osnet_x0_25_msmt17` with auto-download. Chosen over `torchreid`, which is painful to install on Windows and unmaintained |
| `opencv-python-headless` | 4.10 | Decode, crop, JPEG encode for MJPEG | headless avoids the Qt/GTK dependency chain |
| `easyocr` | 1.7 | OCR for scanned FIRs | **Force `gpu=False`.** It quietly grabs ~1.5GB VRAM otherwise and breaks the D2 budget |
| `httpx` | 0.27 | Async client to Ollama | - |
| `asyncpg` | 0.29 | Postgres access (read + cache writes) | - |
| `pgvector` | 0.3 | Vector type adapter | D7 |
| `neo4j` | 5.x | Bolt driver, **read-only credentials** | D10 |
| `numpy` | 1.26 | Vector math, cosine similarity | Pin below 2.0 for opencv/torch compatibility |
| `pandas` | 2.x | CDR and transaction analytics | - |
| `scikit-learn` | 1.5 | DBSCAN for geo convergence and routine clustering | - |
| `scipy` | 1.14 | z-scores, distributions | - |
| `pyinstaller` | 6.x | Bundles the engine as a Tauri sidecar | Use `--onedir`, not `--onefile`: onefile unpacks a multi-GB torch tree to temp on every launch and adds ~20s of startup |

### 11.4 Models

| Model | Size on disk | VRAM | Role |
| :--- | :--- | :--- | :--- |
| `phi3:mini` (3.8B, Q4_K_M) | ~2.3GB | ~3.2GB | Primary NER + relation extraction. Strong instruction following at this size |
| `gemma2:2b` (Q4) | ~1.6GB | ~2.1GB | Fallback if phi3 is too slow or unstable on the demo box |
| `yolov8n.pt` | 6MB | ~0.9GB | Person detection at 15 FPS |
| `osnet_x0_25_msmt17` | 3MB | ~0.4GB | 512-d Re-ID embeddings |
| EasyOCR `en` detector + recognizer | ~90MB | 0 (CPU) | Scanned FIR text |

**Pull every model before demo day.** Ollama pulls need internet, which A5 says you will not have.

### 11.5 Infrastructure

| Image / tool | Version | Role | Note |
| :--- | :--- | :--- | :--- |
| Docker Desktop | latest | Container runtime | WSL2 backend mandatory on Windows |
| `supabase/cli` | latest | Local Postgres + Storage + Auth | Trim `config.toml` per D12 |
| `pgvector/pgvector:pg15` or Supabase's bundled pg15 | 15 | Relational store | Supabase's image already includes pgvector, just `CREATE EXTENSION` |
| `neo4j:5-community` | 5.x | Graph | `NEO4J_PLUGINS='["graph-data-science"]'`, `NEO4J_server_memory_heap_max__size=1G` to stop it eating RAM you need |
| `hyperledger/fabric-*` | 2.5.x | Ledger | via `fabric-samples/test-network`, requires bash so run it from WSL2 |
| `@hyperledger/fabric-gateway` | 1.7 | Node client SDK | D13 |
| `express` | 4.x | REST wrapper around the gateway | ~150 lines total |
| Ollama for Windows | latest | LLM serving | Run **native, not in Docker**. Docker Desktop GPU passthrough on Windows adds a failure mode you do not need |

---

## 12. VRAM and RAM Budget

### 12.1 VRAM residency states (8GB envelope)

| State | Resident | VRAM used | Headroom | Trigger |
| :--- | :--- | :--- | :--- | :--- |
| `IDLE` | CUDA context only | ~0.6GB | 7.4GB | startup |
| `NLP_ACTIVE` | phi3:mini | ~3.8GB | 4.2GB | document ingest |
| `CV_PASSIVE` | YOLOv8n | ~1.5GB | 6.5GB | camera feed open, no lock-on |
| `CV_ACTIVE` | YOLOv8n + OSNet | ~2.3GB | 5.7GB | after lock-on |
| `FORBIDDEN` | phi3 + YOLO + OSNet + peak | ~6.5GB + fragmentation | crash risk | prevented by the lock |

The margin looks comfortable on paper. It is not, because a Windows desktop compositor plus the WebView2 GPU process plus CUDA fragmentation eats 1 to 1.5GB you cannot see in `nvidia-smi` totals. Hence the mutex.

### 12.2 The eviction primitives (write these first, test them first)

```python
# Evict the LLM: Ollama unloads immediately on keep_alive 0
await httpx.post("http://127.0.0.1:11434/api/generate",
                 json={"model": "phi3:mini", "prompt": "", "keep_alive": 0})
# verify with:  ollama ps   -> should list nothing

# Evict the CV stack
del yolo_model, reid_model
gc.collect()
torch.cuda.empty_cache()
torch.cuda.synchronize()
```

Wrap both in a single `VramManager` with an `asyncio.Lock`, a `holder` field, and a `vram.state` WebSocket broadcast on every transition so the UI can grey out the ingest button while CV holds the GPU. **An OOM crash during the judging slot is the worst outcome available to this project. Build this in hour one, not hour thirty.**

### 12.3 System RAM (the constraint everyone forgets)

| Consumer | Approx RAM |
| :--- | :--- |
| Supabase trimmed (5 containers) | 1.2 - 1.8GB |
| Neo4j (heap capped at 1G) | 1.5GB |
| Fabric test-network (7 containers) | 2.0 - 2.5GB |
| Python engine (torch loaded) | 1.5 - 2.5GB |
| WebView2 + Cytoscape + MapLibre | 0.4 - 0.7GB |
| Ollama host process | 0.5GB |
| Windows + Docker Desktop overhead | 3.0GB |
| **Total** | **~11 - 13GB** |

On a 16GB machine this fits with little to spare. On 8GB it does not fit at all. Verify A1 early. Also cap WSL2 memory in `.wslconfig` (`memory=8GB`) or the VM will balloon and starve the host.

> **PRD correction:** the NFR claiming under 150MB RAM for the UI is not achievable once Cytoscape holds a few thousand elements and MapLibre holds tile buffers. Budget 400 to 700MB and state that honestly. Tauri's real advantage over Electron here is roughly 100 to 200MB plus a much smaller binary, which is still a strong claim without overreaching.

---

## 13. Synthetic Data Plan

All data is generated. This is a design asset, not a shortcut, because it lets you seed exactly the patterns your detectors are built to find.

### 13.1 Generator (`tools/gen_data.py`, Faker + numpy, seeded)

| Output | Volume | Notes |
| :--- | :--- | :--- |
| Persons | 120 | 3 syndicates of ~30, plus 30 peripheral, 1 designated kingpin who is only reachable via 2 hops (so betweenness finds what degree misses) |
| FIR PDFs (digital text) | 25 | Templated Maharashtra Police FIR format, real-looking IPC/BNS sections, narrative paragraphs that embed the relations you want extracted |
| FIR PDFs (scanned) | 8 | Same docs printed to image with slight rotation and JPEG noise, for the OCR path |
| CDR CSV | ~40,000 rows | 90 days, realistic diurnal call pattern, plus one planted 24h spike between two syndicates before an "incident" |
| Financial CSV (CFCFRMS) | 1,200 rows | Includes a planted structuring pattern: 6 transfers of Rs 49,500 in one day |
| ICJS JSON | 40 records | Court linkage, adds CO_ACCUSED edges |
| VAHAN CSV | 60 rows | Vehicle to owner, feeds identifier resolution |
| NAFIS hashes | 15 rows | Deliberately assigns one shared NAFIS id to two differently-spelled names, to demo FR-1.3 dedup live |
| CCTV clips | 4 x 90s | One person walks through cam_01 -> cam_02 -> cam_04 in a mapped sequence. Cam_03 is a decoy branch |
| Camera topology | 4 nodes, 5 edges | Travel times 90s to 240s |

### 13.2 Planted "golden path" for the demo

Seed one coherent story so the eight-minute demo has a narrative spine:

1. Two FIRs name "Rakesh Sawant" and "R. Sawant" separately. NAFIS collapses them. (FR-1.3)
2. CDR shows a call spike between that entity and a second syndicate 36 hours before an incident. (FR-4.2)
3. Money flows in the structuring pattern from syndicate B to a mule account owned by the kingpin's cousin.
4. Macro graph looks like two disconnected clusters until the mule edge appears, then betweenness surfaces the kingpin, who has only 3 direct links. **This is the demo's "wow" moment: the most important person is not the most connected one.**
5. CCTV clip shows the kingpin's associate walking the mapped camera route, tracked by topology handoff.
6. Judge corrupts an FIR blob with the dev button, the graph greys out and the red tamper state fires.

Write this sequence down and rehearse it. Judges score the narrative, not the codebase.

---

## 14. User Flows

### 14.1 Investigating Officer - "who is this suspect connected to?"

```
1. Open app -> health board all green -> select case OP-RAVEN-01
2. Drag 3 FIR PDFs onto the drop zone
3. Toast: "Hashing -> Anchored (tx a3f9..) -> OCR skipped -> Extracting.."
   Status bar GPU chip flips to NLP_ACTIVE amber
4. ws ingest.complete -> "12 entities, 19 relations added"
5. Search "Sawant" -> click result
6. Micro view renders 2-hop ego graph, 14 nodes
7. Click the thickest edge -> evidence panel opens:
     "Co-accused in FIR-2024-0102"  + the exact sentence highlighted
     + source PDF page 2 thumbnail
     + green shield "Verified, ledger tx a3f9.., 14:22:07"
8. Click Confirm -> insight_reviews row + on-chain action, edge turns solid green
9. Switch to Map tab -> 90 days of CDR pings -> routine loop + 3 hotspots
```

### 14.2 Intelligence Analyst - "who actually matters?"

```
1. Macro view, weight floor slider set to 5
2. Two visible clusters
3. Click "Run influencer analysis" -> GDS betweenness, ~2s
4. Top 5 nodes pulse and grow, sidebar ranks them with scores
5. #1 has degree 3 but betweenness 0.41 -> the bridge
6. Anomaly inbox shows 4 cards, sorted by severity:
     "Communication spike, 3 entities, z=4.2, 14 Mar"
7. Click card -> graph auto-focuses the involved subgraph, timeline chart appears
8. Reject one anomaly with a note -> written to ledger, disappears from inbox
```

### 14.3 Investigating Officer - CCTV track

```
1. Vision tab -> select cam_01 -> MJPEG starts, boxes overlay, thumbnails 01..06 in the side rail
2. Click thumbnail 04
3. GPU chip: NLP_ACTIVE -> CV_ACTIVE (Ollama evicted, ingest button greys out with a tooltip)
4. Toast: "Target-Alpha locked. Anchored tx 7c21.."
5. Map shows cam_02 and cam_03 pulse amber with countdown windows
6. 110s later: cv.sighting on cam_02, similarity 0.81 -> pin drops, timeline entry added
7. cam_03's window expires with no match, it goes grey (compute saved, shown as a counter:
   "GPU-seconds saved vs brute force: 214")
8. Officer clicks Confirm on the sighting -> anchored, sighting becomes evidence on a CO_LOCATED edge
```

> That GPU-seconds-saved counter is cheap to build and directly demonstrates D8 to a judge who would otherwise not notice the optimization.

### 14.4 Forensic Auditor - "prove this was not altered"

```
1. Audit tab -> file list with hash status column
2. Click "Verify all" -> re-hashes every blob, batch-checks the ledger
3. 33 green, 1 red
4. Click red -> side-by-side hashes, the ledger tx, the anchoring timestamp,
   and the list of 6 graph edges now quarantined because of it
5. Click any object -> full on-chain action history from GetHistoryForKey
```

---

## 15. Non-Functional Targets and How They Are Measured

| NFR | Target | Measurement method | Risk |
| :--- | :--- | :--- | :--- |
| Ego graph query (2 hop, 10k nodes) | < 250ms | `PROFILE` in Cypher, plus a Rust-side timer logged per call | Low, given the weight-floor and LIMIT |
| Full ingest, digital FIR | < 8s end to end | job timestamps in `ingest_jobs` | Medium, phi3 latency |
| Full ingest, scanned FIR | < 25s | same | OCR on CPU is the bottleneck |
| Video pane | 15 FPS sustained | frame counter in the MJPEG generator | Drop to 10 FPS before dropping resolution |
| VRAM peak | < 6.5GB | `torch.cuda.max_memory_allocated` + `nvidia-smi` sampled every 2s into a log | The whole point of D2 |
| Lock-on to first handoff prediction | < 1.5s | ws event timestamps | Includes an Ollama eviction, so measure it with the LLM resident |
| UI RAM | < 700MB | Task Manager, WebView2 process | See 12.3 correction |
| Ledger anchor round trip | < 900ms | gateway timer | Fabric endorsement + ordering, roughly 2 block intervals |
| Hash verification match rate | 100% on untampered files | the Verify All batch run | - |

---

## 16. Failure Modes, Fallbacks, and Build Plan

### 16.1 Risk register

| # | Failure | Likelihood | Blast radius | Pre-built fallback |
| :--- | :--- | :--- | :--- | :--- |
| R1 | PyTorch refuses the sm_120 GPU | **High** | CV module dead | Install and verify cu128 wheels in hour 1. Fallback: run YOLO on CPU at 5 FPS with a pre-recorded overlay |
| R2 | Fabric will not boot on the demo machine | Medium | Whole blockchain claim | Keep a recorded 40s screen capture of the anchoring and tamper flow. Also keep a `LEDGER_MODE=mock` env flag that swaps the gateway for an in-process Merkle log with identical API shape (D13's REST boundary is what makes this swap trivial) |
| R3 | GPU OOM mid demo | Medium | Hard crash | D2 mutex, plus a `VRAM_BUSY` UI state, plus never demo ingest and tracking simultaneously |
| R4 | LLM emits invalid JSON on a judge's ad-hoc file | Medium | Visible error | D11 repair loop, then a visible `needs_review` queue. Never crash |
| R5 | Docker Desktop update or WSL breakage on the day | Low | Total | Snapshot working containers, `docker save` the images to a USB drive |
| R6 | Cytoscape layout thrash on macro view | Medium | Looks broken | fCoSE with `randomize: false` and a cached layout, plus a weight floor default of 5 |
| R7 | Map is blank | Medium if Mapbox is used | Embarrassing | D6 solves it. Verify the map with the network adapter physically disabled |
| R8 | Neo4j out of sync with Postgres | Low | Wrong graph | `rebuild_graph()` command, bound to a visible dev button |
| R9 | Ollama models not pulled on the demo machine | Medium | NLP dead | Pull during setup, verify with `ollama list` in the health gate |

### 16.2 The mock-ledger flag deserves emphasis

Because Rust talks to Fabric only through a REST boundary (D13), a single env var can swap the real Fabric gateway for a 60-line in-process Merkle-tree log with the same five endpoints. Build both. Demo the real one. Keep the mock as a hot spare that costs you an hour and buys you the entire blockchain narrative if Docker fails at 9am on presentation day.

### 16.3 Proposed 36-hour track split (six people, four coding tracks)

| Track | Owner(s) | Hours 0-8 | Hours 8-20 | Hours 20-30 | Hours 30-36 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **A - Infra + Ledger** | 1 | Docker stack up, schemas applied, health gate | Fabric network + chaincode + gateway | Mock ledger fallback, tamper demo | Support |
| **B - Rust core** | 1 | Tauri scaffold, sidecar spawn, hashing, file router | Ingest saga, Neo4j writer, audit emitter | Verify + review commands | Integration |
| **C - Python engine** | 2 | **VRAM manager first**, cu128 verify, FastAPI skeleton | NLP extract + schema repair; CV session + MJPEG | Re-ID + topology handoff; anomaly detectors | Tuning thresholds |
| **D - Frontend** | 1 | Layout, health board, drop zone | Cytoscape micro/macro, evidence panel | Map, vision pane, anomaly inbox | Polish, dark theme |
| **E - Data + pitch** | 1 | Synthetic generator, CCTV clips, camera topology | Seed the golden path, PMTiles basemap | Demo script, slides, rehearsal | Rehearse x3 |

Hard gate at hour 20: if a module is not integrated end to end by then, cut it and rehearse what works. A rehearsed 4-feature demo beats a broken 6-feature one every time.

---

## 17. Repository Layout

```
raven/
├── src/                          # React frontend
│   ├── components/{graph,map,vision,evidence,anomaly,audit}/
│   ├── hooks/{useInvoke,useRavenSocket,useVramState}.ts
│   ├── types/generated.ts        # mirrors Rust command signatures
│   └── store/case.ts
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/{ingest,graph,ledger,cctv,audit}.rs
│   │   ├── saga.rs               # section 6.1
│   │   ├── db/{postgres.rs,neo4j.rs}
│   │   ├── ledger.rs             # HTTP client to :8801
│   │   └── audit.rs
│   ├── binaries/raven-engine-x86_64-pc-windows-msvc.exe   # PyInstaller output
│   └── tauri.conf.json           # externalBin + shell permissions
├── engine/                       # Python
│   ├── main.py
│   ├── vram.py                   # BUILD THIS FIRST
│   ├── nlp/{ocr.py,extract.py,schemas.py,prompts/}
│   ├── cv/{session.py,detect.py,reid.py,topology.py,stream.py}
│   ├── analytics/{anomaly.py,routine.py}
│   └── build_sidecar.ps1         # pyinstaller --onedir + target-triple rename
├── ledger/
│   ├── chaincode/ravenledger/    # Node contract
│   ├── gateway/server.js         # Express REST, :8801
│   └── mock/merkle_gateway.js    # R2 fallback, same API
├── infra/
│   ├── supabase/config.toml      # trimmed per D12
│   ├── docker-compose.neo4j.yml
│   ├── migrations/001_init.sql   # section 7
│   └── cypher/bootstrap.cypher   # section 8
├── tools/
│   ├── gen_data.py               # section 13
│   └── seed_golden_path.py
├── assets/
│   ├── basemap/maharashtra.pmtiles
│   ├── cctv/{cam_01..cam_04}.mp4
│   └── synthetic/
└── docs/
    ├── architecture.md           # this file
    └── demo_script.md
```

**Sidecar naming gotcha:** Tauri requires the binary to be named `<name>-<target-triple>.exe`. On Windows that is `raven-engine-x86_64-pc-windows-msvc.exe`, obtained from `rustc -Vv`. `tauri.conf.json` references `binaries/raven-engine` with no suffix and no extension. Getting this wrong produces a build that succeeds and then silently fails to launch the engine at runtime, which is a miserable thing to debug at 3am.

---

## 18. Security Posture (state this honestly)

| Property | Real in the demo | Simulated | Note |
| :--- | :--- | :--- | :--- |
| No cloud egress | **Real** | - | Verifiable live by disabling the network adapter. Make the judges do it |
| Evidence hash anchoring | **Real** | - | Actual Fabric transactions, actual SHA-256 |
| Tamper detection | **Real** | - | Recompute and compare on every read |
| Memory safety of the shell | **Real** | - | Rust binary, no Node runtime, no `nodeIntegration` class of vulnerability |
| Scoped filesystem access | **Real** | - | Tauri fs scope, plus magic-byte MIME sniffing rather than trusting extensions |
| Officer identity / auth | - | Simulated | Hardcoded officer switcher. Production would be MSP-backed identity with the same badge flowing into the chaincode |
| RLS policies | - | Simulated | One permissive policy. Schema is designed for per-case RLS |
| Fabric MSP hardening | - | Simulated | test-network crypto material, not a real CA hierarchy |
| PII on chain | **Never** | - | Section 9. Hashes and ids only |

Being upfront about the simulated column is a strength. A team that says "auth is stubbed, here is exactly how it would be done" reads as more credible than one that implies everything is production-grade.

---

## 19. Out of Scope (roadmap slide material)

- Real CCTNS / ICJS / CFCFRMS API integration and the accompanying MHA data-sharing approvals.
- Multi-node Fabric across agency organizations, with each state CID running a peer.
- Horizontal scale: Neo4j causal cluster, Postgres read replicas, a real vector database once Re-ID corpora exceed ~1M vectors.
- Model fine-tuning on Indian FIR text and Devanagari OCR for regional-language documents.
- Federated queries across jurisdictions without centralizing raw data.
- Formal DPDP Act compliance, retention windows, and a purge workflow that keeps ledger integrity while removing off-chain PII.

---

## 20. Open Questions

| # | Question | Blocks | Needed by |
| :--- | :--- | :--- | :--- |
| Q1 | Demo machine RAM and confirmation the GPU is the 8GB laptop 5070 | Section 12.3 feasibility | Before hour 0 |
| Q2 | CCTV source: recorded clips or live webcams | CV session ingest layer only | Hour 8 |
| Q3 | Internal round date and hard deadline | The whole schedule in 16.3 | Immediately |
| Q4 | Which team members write code vs present | Track assignment | Immediately |
| Q5 | Is Docker Desktop installable on the demo machine (admin rights, virtualization enabled in BIOS) | R2, R5, effectively everything in layer 3 | Before hour 0 |
| Q6 | Does the SIH evaluation rubric weight working prototype vs presentation | Whether to cut features at the hour-20 gate | Before hour 20 |
