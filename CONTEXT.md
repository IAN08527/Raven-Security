# Raven — Cross-Session Context

> This file is the single source of truth that carries state between sessions.
> Rule: **build ONE feature per session.** At the end of each session, append a
> Session entry below (what was done, what is half-done, what the next owner needs).

## How to use
- Read this file first in every session.
- When starting a feature, move it from `Backlog` to `In Progress`, then to `Done` on completion.
- Keep `Environment & Blockers` accurate — it is the fastest way to waste a session.
- Do NOT delete old session entries; they are the audit trail.

## Current Session (active)
- **Session: Backlog #1 — Ingest/Storage baseline — DONE (see Session 1b).**
- **Session: Backlog #2 — Ingest saga (Rust) — DONE (see Session 2).**
- **Session: Backlog #3 — NLP extraction (Python) — DONE (see Session 3).**
- **Session: Backlog #4 — Graph engine (Rust + Cytoscape + evidence panel) — DONE (see Session 4).**
- **Session: Backlog #5 — CCTV Re-ID — CODE DONE (all phases 0–6) + mock-proven (see Session 5).**
- **Rule (one feature per session):** each session builds exactly ONE backlog item end-to-end.
- **Next up:** **Backlog #6 — Geospatial routine** (MapLibre + local PMTiles, CDR ping loop + hotspots, D6, §6.6).
- Note on the health gate: `HealthBoard.tsx` already reads `health_check` and shows
  `supabase`/`neo4j`/`ollama`/`fabric`/`python` rows; the `supabase` row is now driven by a real
  `pg_health` probe (Backlog #1). Neo4j/ollama/fabric rows will only go green when those services
  are actually running (Backlog #2+). The Python engine now ALSO serves `/nlp/extract`; the
  `ollama`/`python` rows should read green whenever the engine sidecar is up.

## Changed decisions (vs architecture.md)
- **Supabase is CLOUD, not local.** The architecture assumes `supabase start` (Docker). We instead
  use the hosted Supabase service, configured/administered through the remote `mcp.supabase` server
  (requires OAuth login on first use). The trimmed local `config.toml` (D12) and `supabase/` local
  project were removed. The schema in `infra/migrations/001_init.sql` is still the source of truth
  and gets applied to the cloud project (via MCP or SQL editor).
- Neo4j stays local Docker (`infra/docker-compose.neo4j.yml`). Fabric stays local/Docker or mock.
- The "no cloud egress" NFR (architecture §18) is now scoped to: no egress for sensitive
  intelligence text/PII. Supabase cloud auth/admin traffic is acceptable per this decision.

## Project snapshot
- **Raven**: native Windows desktop (Tauri v2 + React/WebView2) AI criminal-network
  analysis tool for SIH26189 (MHA/NCRB). Fully local, no egress.
- Authoritative docs: `docs/PRD.md`, `docs/design.md` (Pro Dark UI), `docs/architecture.md`.
- Five modules: (1) ingestion+NER, (2) dual storage+blockchain audit, (3) micro/macro
  graph, (4) CCTV Re-ID, (5) geospatial routine.
- Key decisions to respect: D2 VRAM mutex (build first), D4 saga not 2PC, D6 offline
  PMTiles, D9 human-in-loop Re-ID, D13 Fabric via REST + mock fallback.

## Environment & Blockers
- Repo scaffolded (see Session 0). Code is unverified: Rust needs `cargo check`,
  Python needs `pip install -r engine/requirements.txt`.
- **Login required**: Supabase MCP (`mcp.supabase`) is a remote server and will prompt
  for OAuth the first time it is used. Fabric, Ollama, Docker Desktop also need the
  demo machine credentials/install. Flag any login prompt to the user immediately.
- Confirm demo machine: RTX 5070 8GB VRAM, 16GB RAM, Windows 11 + WSL2, Docker Desktop
  installable (this is the single largest risk — architecture §15 R5).

## Session ledger
### Session 0 — Scaffold (DONE)
- Created full monorepo: `src/`, `src-tauri/`, `engine/`, `ledger/`, `infra/`, `tools/`, `assets/`.
- `infra/`: `001_init.sql` (full schema §7 + weight fn), `bootstrap.cypher`, neo4j compose, trimmed supabase config.
- `ledger/`: chaincode, Express gateway :8801, mock Merkle fallback (`LEDGER_MODE=mock`).
- `engine/`: requirements (cu128), `vram.py` mutex, FastAPI `main.py` with all §10.2 endpoints, nlp/cv/analytics stubs.
- `src-tauri/`: Cargo.toml, tauri.conf.json, all 15 Tauri commands (§10.1), saga/db/ledger/audit modules (stubs).
- `src/`: React shell, PD design tokens, layout, health gate, graph/map/vision/evidence/audit panes.
- `tools/`: `gen_data.py`, `seed_golden_path.py`. Root `README.md`, `.gitignore`.
- **Handoff**: every module is a working skeleton with real signatures; implementation is the backlog.

### Session 1a — Supabase cloud setup (DONE)
- **Decision changed:** Supabase is CLOUD, not local. Removed local `supabase/` project and trimmed
  `config.toml`; removed any assumption of `supabase start`/Docker for Supabase. Recorded in
  "Changed decisions" above.
- MCP configured as **stdio npx `@supabase/mcp-server-supabase`** with a **personal access token**
  (PAT) + `--project-ref nszgciwmpdejpvoywgav` (set by another session; no browser OAuth needed).
- **Schema applied:** `infra/migrations/001_init.sql` pushed to the cloud project **"Raven"**
  (ref `nszgciwmpdejpvoywgav`) via the Management API — all 20 tables verified present.
- **Connection details** (URL, anon key, service_role key, project ref, DB host/password) saved in
  `.env` (gitignored) for the Rust/Python layers.
- **SECURITY:** `opencode.json` and `.env` contain credentials and are gitignored.
- Neo4j stays local Docker; its compose file is retained.

### Session 1b — Ingest/Storage baseline (DONE)
- **Goal (this session):** wire Rust (`sqlx`) + Python (`asyncpg`) to the cloud Supabase via `.env`,
  drive the startup health gate `supabase` row from a real `pg_health` probe, and PROVE it works.
- **`.env`:** configured with `RAVEN_PG_DSN` pointing to Supabase transaction pooler.
- **Python:** `engine/db.py` real asyncpg layer (`build_dsn`, `get_pool`, `db_health`,
  `count_source_files`, `list_cases`, `schema_present`). `engine/main.py` uses `RAVEN_PG_DSN`
  + new `/db/health`, `/db/cases` endpoints. `engine/probe_db.py` PASSES live (health up,
  schema present, read, write+read round-trip) — uses a `socket.getaddrinfo` DoH/fallback patch
  because the sandbox DNS can't resolve the pooler host.
- **Rust:** `src-tauri/src/db/postgres.rs` rewritten with real `build_pg_dsn`/`create_pool`/
  `pg_health`/`schema_present`/`count_source_files`/`list_cases`/`insert_source_file`.
  `src-tauri/src/commands/ledger.rs` `health_check` now probes real `pg_health` + neo4j/ollama/
  fabric/python. `src-tauri/src/lib.rs`: loads `.env`, builds pool, fixed `neo4rs::Graph::new`
  (async) + `generate_handler!` paths, modules made `pub`. `src-tauri/src/commands/ingest.rs`
  saga path fixed. `src-tauri/Cargo.toml`: added `dotenvy`, `url`, reqwest `blocking`.
  `src-tauri/tests/cloud_db.rs`: integration test (retry loop). App crate `cargo check` clean.
- **Rust proof:** `tools/rust_cloud_probe` standalone crate (sqlx only, no Tauri) PASSES live once
  the `hosts` override (`65.0.195.55 aws-0-ap-south-1.pooler.supabase.co`) is added (needs admin).
  The in-crate `tests/cloud_db.rs` cannot link in this MinGW sandbox (WebView2/ordinal limit) but
  is correct for the demo machine.
- **Environment learnings recorded** in "Environment & Blockers" (sandbox DNS + MinGW toolchain).
- **Handoff for next owner:** Backlog #1 is fully proven (Python + Rust). Next is Backlog #2
  (Ingest saga). The `hosts` override + MinGW PATH are sandbox-only; demo machine needs neither.
- **Sandbox DNS gotcha (new):** this sandbox's resolver CANNOT resolve
  `aws-0-ap-south-1.pooler.supabase.co` (even 8.8.8.8/1.1.1.1 return "non-existent"); the
  network can still REACH the DB at IP `65.0.195.55`. `engine/probe_db.py` works around this by
  monkeypatching `socket.getaddrinfo` (DoH + fallback IP) while keeping the hostname for TLS.
  For any NATIVE Rust/Go/etc. client here, add a `hosts` override
  (`65.0.195.55 aws-0-ap-south-1.pooler.supabase.co`) — requires admin. On the demo machine
  normal DNS works, so no override is needed there.
- **Rust toolchain gotcha (new):** the sandbox has NO MSVC linker. Rust must build with the
  GNU toolchain: `rustup toolchain install stable-x86_64-pc-windows-gnu` and a full MinGW-w64
  extracted to `C:\Users\lopes\AppData\Local\Temp\opencode\mingw\mingw64\bin` (on PATH for build/run).
  The `cdylib` (Tauri GUI) build hits MinGW's PE export-ordinal limit and the headless
  `tests/cloud_db.rs` can't link (pulls `WebView2Loader.dll`). Proof of the storage layer in
  this sandbox is done via the standalone `tools/rust_cloud_probe` crate (sqlx only, no Tauri).
- **Headless saga test path (new, Session 2):** the saga now lives in `src-tauri/core`
  (`raven-core`), which does NOT depend on Tauri. Build & run it headless with the GNU
  toolchain via `tools/raven_saga_cli` — this links fine in the sandbox (no WebView2).
  `cargo check -p raven` still validates the Tauri GUI crate. So: use `raven_saga_cli` for
  live proof here; use `npm run tauri dev` on the demo machine for the GUI.

### Session 2 — Ingest saga (Rust) (DONE)
- **Goal:** implement the §6.1 ingest saga (Module 1 + 2): magic-byte MIME router, SHA-256
  streaming, Supabase blob upload + ledger anchor, Neo4j `MERGE`, audit emit — with graceful
  degradation for unavailable services.
- **Refactor:** extracted all non-Tauri logic into a new `src-tauri/core` crate (`raven-core`:
  `db/{postgres,neo4j,storage}`, `saga`, `ledger`, `audit`, `model`). The Tauri crate
  (`src-tauri/src`) now depends on `raven-core` and only contains the thin command/UI layer.
  This lets the saga be built & tested headless (no WebView2/linker).
- **New code:** `raven-core/src/db/storage.rs` (Supabase Storage REST client: `from_env`,
  `ensure_bucket`, `upload`, `download`), `raven-core/src/db/neo4j.rs` (real idempotent `MERGE`
  for Document/Entity/relationship + `rebuild_graph`), `raven-core/src/saga.rs` (the §6.1
  coordinator + `Progress`/`IngestOutcome`), `raven-core/src/model.rs`, and headless harness
  `tools/raven_saga_cli` (build+run the saga against cloud; `--verify <file_id>` re-checks the
  DB row + Storage blob SHA).
- **Behaviour:** Storage upload must succeed (else a compensating `DELETE` rolls back the
  `source_files` row); ledger-down / neo4j-down / NLP-down do NOT fail the saga — they set
  `ledger_status='pending'` / `sync_state='pending'` and continue (D4). Extraction (Backlog #3)
  is a wired hook (`saga::try_extract`) that returns `None` when the Python engine
  (`RAVEN_ENGINE_URL`) is unset/unreachable, so ingest is document-only for now.
- **Proof (sandbox):** `cargo build` of `raven_saga_cli` (GNU) succeeds; running it against
  cloud Supabase ingested `tools/sample_fir.txt` and `tools/sample_fir.pdf` — both got SHA-256,
  `source_files` rows (status `committed`), and blobs uploaded to the `evidence` Storage bucket;
  `tools/raven_saga_cli --verify <file_id>` downloaded the blob and confirmed its SHA-256 equals
  the anchored hash (round-trip OK). `cargo check -p raven` (Tauri GUI crate) compiles clean.
  Neo4j/ledger showed `pending` because those services are not running in the sandbox (expected;
  full green requires them up).
- **MIME note:** `infer` only detects magic bytes; plain text (no magic) falls back to
  `application/octet-stream` by design (security posture: don't trust extensions). PDF/images
  are detected correctly (`%PDF-` → `application/pdf`).
- **Handoff for next owner:** Backlog #2 is proven. Next is **Backlog #3 (NLP extraction)** —
  implement the `RAVEN_ENGINE_URL`/OCR/NLP calls in `saga::try_extract` (shape already mapped)
  and persist+graph the returned entities/relations via the already-written `persist_extraction`
  + `merge_entity`/`merge_relationship`. The demo machine must run Neo4j (Docker) + the ledger
   gateway for a fully green run.

### Session 3 — NLP extraction (Python) (DONE)
- **Goal:** implement §5.2 extraction contract end-to-end: OCR/text path, Ollama
  entity+relation extraction with a Pydantic schema + the D11 repair-retry loop,
  a deterministic mock fallback for GPU-less demos/tests, and wire it into the
  Rust ingest saga so entities/identifiers/relationships/evidence persist to
  cloud Postgres (and Neo4j when up).
- **New Python code:**
  - `engine/nlp/text.py` — text extraction: digital-PDF text layer first
    (pypdf), else EasyOCR for scanned PDFs/images; plain read for text. All ML
    imports are lazy so the engine still boots without the CV stack.
  - `engine/nlp/ollama_client.py` — Ollama `/api/generate` with `format:json`,
    Pydantic `ExtractionResult`/`RelationsResult` validation, and the D11 repair
    loop (one bounded retry feeding the validation error back; 2nd failure →
    `NeedsReview`). Transport error → `OllamaError`.
  - `engine/nlp/mock.py` — deterministic FIR regex parser (complainant/accused/
    witness/phone/vehicle/account/FIR-no/date/PS/sections + CO_ACCUSED edges).
  - `engine/nlp/ids.py` — stable UUID5 ids for entities/identifiers/relations so
    re-ingest is idempotent and the same name collapses across documents.
  - `engine/nlp/schemas.py` — extended Pydantic schemas + `ExtractionPayload`.
  - `engine/nlp/extract.py` — `run_extraction(file_path, mime, doc_id)` orchestrator
    (OCR → engine → id-bind → span-resolved evidence). Engine mode:
    `auto` (Ollama, mock fallback on transport error) | `ollama` | `mock`
    (env `RAVEN_NLP_MODE`, default `auto`).
  - `engine/main.py` — new `POST /nlp/extract` endpoint; CV/analytics imports made
    lazy so the NLP endpoints work without ultralytics/torch installed.
- **Rust wiring (raven-core):** `model.rs` `Extraction` now carries
  `needs_review`, `engine`, `text`, `page_map`, `identifiers`, `evidence`.
  `saga.rs::try_extract` posts to `/nlp/extract` (file+mime+doc_id) and maps the
  engine-agnostic result; on `status:"needs_review"` it quarantines the document
  (`source_files.status='needs_review'`, `ingest_jobs='needs_review'`) per D11
  without crashing. `db/postgres.rs::persist_extraction` now runs in one
  transaction and writes entities (+aliases), identifiers, relationships,
  evidence, and stashes `extracted_text`+`page_map` on `source_files` (§5.2).
- **Proof (sandbox):** `tools/test_nlp_extraction.py` (pure-Python, no GPU) PASSES
  — mock extracts 4 entities / 3 CO_ACCUSED relations / 8 evidence from
  `tools/sample_fir.txt`, ids+spans+enum normalization all correct; `ollama` mode
  with no server correctly returns `needs_review` (D11). Live end-to-end: started
  the engine (`RAVEN_NLP_MODE=mock`) and ran `tools/raven_saga_cli` with
  `RAVEN_ENGINE_URL=http://127.0.0.1:8756` against cloud Supabase — saga reported
  "extracted via mock → persisted 4 entities, 3 relations, 8 evidence", and a
  direct DB query confirmed `entities=4, relationships=3, evidence=8,
  identifiers=2` for case OP-RAVEN-01 and the `source_files` row
  `status='committed'` with `extracted_text` populated. `cargo check -p raven-core`
  and `cargo check -p raven` (GUI) both compile clean.
- **Caveat:** the real Ollama LLM path (phi3:mini) was NOT exercised live in the
  sandbox (no GPU/model). It is implemented and the mock fallback + `needs_review`
  paths are proven; on the demo machine `ollama pull phi3:mini` makes the `auto`
  path use the real model. Neo4j/ledger still show `pending` (not running here).
- **Handoff for next owner:** Backlog #3 is proven. Next is **Backlog #4 (Graph
  engine)** — implement `get_ego_graph`/`get_macro_graph` (Bolt) + batched evidence
  hydrate (reuse the `evidence` rows just persisted here) and the Cytoscape
  micro/macro UI with the evidence side panel (§6.2, §9.2). The `recompute_weight`
  SQL function can re-derive relationship weights from the `evidence` table.

### Environment learning (new, Session 3)
- The sandbox DNS that "could not resolve" the Supabase pooler in Session 1b/2 now
  resolves `aws-0-ap-south-1.pooler.supabase.co` → `65.0.195.55` directly, so live
  cloud DB/Storage calls work WITHOUT the `hosts` override. (Keep the old note; it
  may regress on a fresh sandbox.)
- A stale uvicorn from a previous session was holding port 8756 and serving OLD
  `main.py` (no `/nlp/extract`), which made the saga look "engine offline". When
  debugging the engine, kill anything on 8756 first (`Get-NetTCPConnection
  -LocalPort 8756`).
- The engine MUST be launched from the `engine/` directory (`python -m uvicorn
  main:app`) because `main.py` does `from vram import ...` / `import db` (modules
  live under `engine/`, not repo root).

### Session 4 — Graph engine (Rust + Cytoscape + evidence panel) (DONE)
- **Goal:** implement the §6.2 graph query flow + §9.2 criminal-net visualization:
  `get_ego_graph`/`get_macro_graph` (Bolt + batched evidence hydrate), the Cytoscape
  micro/macro UI, and the evidence side panel.
- **Rust (`raven-core`):** new `src-tauri/core/src/db/graph.rs` — canonical Postgres
  graph path: `ego_graph_pg` (recursive-CTE walk, N hops, weight floor),
  `macro_graph_pg` (top-N by weight), `edge_evidence_pg`, `entity_details_pg`,
  `list_entities_pg`, and `hydrate_evidence` (ONE batched `WHERE relationship_id =
  ANY($1)` query, never N+1). `db/neo4j.rs` gained Bolt paths `ego_subgraph` /
  `macro_edges` (variable-length `LINKED_TO` traversal) used when Neo4j is up; the
  dispatch in `graph.rs` falls back to Postgres on any Bolt error (D4). Every result
  carries `source: "neo4j" | "postgres"`. `lib.rs` `EgoGraph`/`EdgeEvidence` made
  strongly typed; added `EntityDetails`.
- **Tauri commands:** `src-tauri/src/commands/graph.rs` now implements
  `get_ego_graph`/`get_macro_graph`/`list_entities`/`get_entity_details` (audit
  `graph.query` / `file.read` best-effort); `audit.rs::get_edge_evidence` implemented
  (was a stub). All registered in `src-tauri/src/lib.rs`.
- **Headless proof:** new `tools/raven_graph_cli` (GNU toolchain) — `--macro`,
  `--ego`, `--edge`, `--entity`, `--entities`, `--case`. Live against cloud Supabase:
  `--macro OP-RAVEN-01` → 14 nodes / 16 edges `source:"postgres"`; `--ego` of Rakesh
  Sawant → 9 nodes / 11 edges; `--edge` → relationship meta + 1 evidence snippet +
  source file. `cargo check -p raven-core` and `cargo check -p raven` both clean.
- **Python engine dev-mirror:** new `engine/graph.py` + routes in `main.py`
  (`POST /graph/{macro,ego,edge_evidence,entity,entities}`) running the SAME SQL so
  the browser UI works without the Rust shell. Live-verified (macro 14/16, ego 9/11,
  edge evidence) — matches the Rust output exactly.
- **Frontend:** `src/hooks/useInvoke.ts` auto-routes `invoke` → Tauri → engine HTTP →
  embedded mock (`src/dev/mockGraph.ts`) so `npm run dev` always renders a network.
  `GraphPane.tsx` rewritten: micro/macro toggle, hops stepper, weight-floor slider,
  layout picker (fcose/cose-bilkent/circle/grid), entity search, legend, node
  shapes/colours by `entity_type`, edge width/colour by weight/`dominant_kind`,
  click node → ego (micro) / click edge → evidence panel. `EvidencePane.tsx` rewritten
  for node (identifiers + entity evidence) and edge (relationship header + evidence +
  source files) modes. `main.tsx` registers `cytoscape-fcose` + `cytoscape-cose-bilkent`;
  `types/generated.ts` updated; `store/case.ts` gained graph view controls.
  `npm run build` (tsc + vite) PASSES; `npm run dev` serves and transforms all modules.
- **Demo data:** `tools/seed_graph_demo.py` seeded a 20-entity / 20-relation network for
  `OP-RAVEN-01` (kingpin Rakesh Sawant + syndicate, CDR/structured-transfer/CCTV
  links) with ids UUID5-derived from the SAME namespace as `engine/nlp/ids.py` (so
  re-ingest collapses onto the same rows). Weights re-derived via `recompute_weight`
  (§7.1): fir_text base 25, txn_row/cctv_sighting 10, cdr_row 1, with time decay.
  Idempotent (relationships deduped; seeded evidence cleared+reinserted).
- **Caveat:** the sandbox has NO Docker, so the Neo4j Bolt path was NOT exercised
  live (only compiled + fallback path proven). On the demo machine with
  `docker compose -f infra/docker-compose.neo4j.yml up -d`, responses will report
  `source:"neo4j"`. The Postgres path is the always-available fallback.
- **Test guide:** `docs/GRAPH_TESTING.md` (3 ways to test: CLI, browser+engine, full
  Tauri). 
- **Handoff for next owner:** Backlog #4 is proven.

### Session 5 — CCTV Re-ID (DONE — code + mock proof)
- **Goal:** §6.3 spatio-temporal CCTV tracking + human-in-the-loop Re-ID across a 4-camera
  network — lock-on (D9, accountable/ledger-anchored), OSNet fingerprint, topology-gated
  handoff (D8, the 8GB-VRAM safety core), officer confirm → `cctv_sighting` evidence (+10).
  Built in seven phases; full detail per phase in `docs/cctv-roadmap.md`.
- **What landed (all mock-proven, GPU/DB-less):** real OSNet embed behind `RAVEN_CV_MODE`
  (mock = deterministic color-histogram) [P1]; lock-on persists `reid_targets` + ledger anchor
  + `audit_log`, Rust `raven_core::reid::lock_on` [P2]; cross-camera sighting match loop +
  `reid_sightings` + `cv.sighting` WS [P3]; topology-gated handoff — travel-time windows,
  `arm`/`for_camera`/`expire`, one `vram.acquire(Lane.CV)` lane [P4]; `confirm_sighting`
  (confirm/reject → `insight_reviews` + evidence + `recompute_weight`, idempotency guard,
  migration `002_cctv_evidence.sql`) [P5]; end-to-end seam proof + demo runbook [P6].
- **Proofs (all PASS):** `tools/test_reid.py`, `test_lock.py`, `test_sighting.py`,
  `test_topology.py`, `test_confirm.py`, and the Phase 6 `test_e2e.py` (18 seam checks —
  lock→arm→sighting→gate→chain→confirm/+10→re-confirm guard→reject). Ran in a scratchpad
  numpy venv (macOS dev box has no GPU/cv2/torch/asyncpg, PEP 668 blocks system pip).
- **Deferred to demo machine (by design, scripted in `docs/cctv-demo-run.md`):**
  `cargo check -p raven -p raven-core`, `tsc --noEmit`, apply migration 002, `seed_cctv.py`
  (cameras+edges), seed `officers` row for `RAVEN_BADGE`, drop 4 `.mp4` clips, real OSNet
  weights + boxmot 11.x entrypoint check, bring up Ledger+Neo4j (else `pending`, D4).
- **Handoff for next owner:** Backlog #5 is code-complete + proven. Run the demo runbook to go
  live-green, then **Backlog #6 (Geospatial routine)** — MapLibre + local PMTiles, CDR ping
  loop + hotspots (D6, §6.6).

## Backlog (one feature per session, dependency-ordered)
1. **Ingest/Storage baseline** — [DONE] Schema applied (Session 1a). Rust (`sqlx`) + Python
   (`asyncpg`) layers wired to read/write the cloud Supabase via `RAVEN_PG_DSN` (`.env`). Startup
   health gate `supabase` row now driven by a real `pg_health` probe. Proven: Python
   `engine/probe_db.py` PASSES (live read+write round-trip); Rust `tools/rust_cloud_probe`
   PASSES (live read+write) once the `hosts` override is in place. App crate compiles clean.
   Local Docker is NOT used for Supabase. (Neo4j still needs Docker per
   `infra/docker-compose.neo4j.yml`.)
2. **Ingest saga (Rust)** — [DONE] See Session 2. Full §6.1 coordinator in
   `src-tauri/core/src/saga.rs`: magic-byte MIME (`infer`), SHA-256 streaming,
   `source_files` insert (status `hashing`→`stored`→`committed`), Supabase Storage blob
   upload (with compensating delete on failure), best-effort ledger anchor (continues if
   ledger down), Neo4j `MERGE` of the Document node (+ entities once NLP lands in #3),
   and audit emit. Neo4j/ledger degrade gracefully. Headless harness `tools/raven_saga_cli`
   proves it end-to-end against cloud Supabase (DB + Storage verified; Neo4j/ledger show
   `pending` when those services are down).
3. **NLP extraction (Python)** — [DONE] See Session 3. OCR/text path, Ollama
   extraction with Pydantic schema + D11 repair-retry, deterministic mock
   fallback, and full wiring into the Rust saga (entities/identifiers/relations/
   evidence persisted to cloud Postgres, `needs_review` quarantine on D11 failure).
   Live end-to-end against cloud Supabase proven (4 entities / 3 relations /
   8 evidence). Real Ollama LLM path implemented but not exercised live (no GPU);
   `ollama pull phi3:mini` + `RAVEN_NLP_MODE=auto` enables it on the demo machine.
4. **Graph engine** — [DONE] See Session 4. Rust `get_ego_graph`/`get_macro_graph`
   (Bolt + batched evidence hydrate), Cytoscape micro/macro + evidence side panel in
   frontend (§6.2, §9.2). Proven live against cloud Supabase.
5. **CCTV Re-ID** — [DONE (code + mock proof)] YOLOv8n + ByteTrack MJPEG, human-in-loop lock-on,
   topology-gated handoff across 4-cam network (§6.3, D8/D9). Phased build tracked in
   `docs/cctv-roadmap.md`. All phases 0–6 code done + mock-proven (seed, real OSNet embed, lock-on
   persist+ledger anchor, sighting match loop, topology-gated handoff D8, human confirm+evidence,
   end-to-end proof + docs). Six `tools/test_*.py` proofs PASS. Demo-machine live run (deferred by
   design) is scripted in `docs/cctv-demo-run.md`: `cargo check`, migration 002, live DB/ledger/OSNet,
   camera + officer seed, `.mp4` clips.
6. **Geospatial routine** — MapLibre + local PMTiles, CDR ping loop + hotspots (D6, §6.6).
7. **Tamper + audit UI** — verify-evidence flow, red tamper state, audit ledger view (§6.4).
8. **Rehearsal hardening** — mock ledger fallback, `rebuild_graph` dev button, golden
   path rehearsal (§13.2, §16.2).

## Open questions
- Demo machine RAM/GPU confirmation (architecture §20 Q1, Q5).
- CCTV source: recorded clips vs live webcam (Q2) — scaffold assumes 4 MP4s.
