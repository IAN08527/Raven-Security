# Raven System Architecture

**Version:** 2.0 (real build). Supersedes the prototype architecture document.
**Scope:** the system as it is to be built. Decisions and their rationale live in
`DECISIONS.md`; this document describes the result.
**Reference hardware:** RTX 4050 6GB laptop as development machine and engine-node
reference. Deployment hardware scales; nothing here assumes a fixed GPU size.

---

## 0. How to read this

| Section | Answers |
|:---|:---|
| 1-2 | What runs where, and how the pieces talk |
| 3 | The compute budget, which constrains everything else |
| 4-5 | The two hard pipelines: documents and cameras |
| 6 | Data model and provenance |
| 7 | Identity, access control and the ledger |
| 8 | Repository layout and deployment profiles |
| 9 | What is honestly real versus stubbed |
| 10 | Known weaknesses |

---

## 1. Topology

Three roles. A role is a deployment unit, not necessarily a separate machine.

```text
+-------------------------------------------------------------------------+
|                        PREMISES NETWORK, NO EGRESS                      |
|                                                                         |
|  [ CLIENT ]  raven.exe, one per user                                    |
|  +-------------------------------------------------------------------+  |
|  | Tauri v2 Rust core  | local file handling, upload, session, cache  |  |
|  | WebView2 React      | graph, map, video wall, evidence, review     |  |
|  +-------------------------------------------------------------------+  |
|         | https (REST + WS)              | https (MJPEG + WS overlays)  |
|         v                                 v                             |
|  [ SERVER ]  one                    [ ENGINE NODE ]  one or more        |
|  +---------------------------+     +---------------------------------+  |
|  | Rust orchestrator         |     | Frame scheduler (compute budget)|  |
|  |  saga, single graph writer|     | Decoder pool (NVDEC)            |  |
|  |  audit emitter            |     | Detector, batched               |  |
|  | Document GPU lane         |     | Tracker                         |  |
|  |  HTR, NER, queued         |     | Re-ID embedder, per tracklet    |  |
|  | Postgres 16 + pgvector    |     | MJPEG out, WS box stream        |  |
|  | Neo4j 5                   |     | Read-only Bolt (topology only)  |  |
|  | Auth (GoTrue), RLS        |     +---------------------------------+  |
|  | Blob store, content-addr  |              ^                           |
|  | Ledger gateway -> Fabric  |              | RTSP / file               |
|  | PMTiles basemap server    |         [ CAMERAS ]                      |
|  +---------------------------+                                          |
+-------------------------------------------------------------------------+
```

Engine nodes sit near their cameras. They consume megabits of video and emit
kilobits of detections and embeddings, so putting them anywhere else wastes the
network. The document GPU lane sits on the server because it is bursty,
user-triggered, and its inputs are already there.

### 1.1 Processes and ports

| Process | Port | Runtime | Role |
|:---|:---|:---|:---|
| Client (`raven.exe`) | - | Native Windows | Per user |
| Server API | 8443 | Rust | Orchestration, auth, graph writes |
| Postgres + pgvector | 5432 | Docker | Source of truth |
| Neo4j (Bolt / HTTP) | 7687 / 7474 | Docker | Derived graph, camera topology |
| Document lane | 8757 | Python, FastAPI | HTR, NER, analytics |
| Engine node | 8756 | Python, FastAPI | Detection, tracking, Re-ID |
| Ledger gateway | 8801 | Node 20 | Fabric client, REST boundary |
| Basemap | 8802 | Static | PMTiles |
| Fabric peers / orderers | per org | Docker | Multi-org ledger |

All inter-service traffic is TLS with mutual authentication. On loopback in the
development profile this is overhead; in a split deployment it is not optional,
and running it in development means it is never discovered to be broken later.

### 1.2 Startup

The server blocks on a health gate that checks every dependency and reports each
as pass or fail before the UI becomes usable. Engine nodes register with the
server, report their calibrated compute budget (section 3), and are assigned
cameras. A node that fails calibration registers as degraded and takes no cameras.

The health gate is not polish. It converts "something is broken and we do not know
what" into a named red row.

---

## 2. How the pieces communicate

**Client to server:** REST over HTTPS for commands, WebSocket for events (ingest
progress, new candidate sightings, graph sync state). The Rust core holds the
session token; the WebView never sees credentials.

**Client to engine node:** MJPEG over `multipart/x-mixed-replace` consumed by a
plain `<img>` for video, and a separate WebSocket carrying bounding boxes as JSON
drawn as an SVG overlay. Pixels and boxes travel separately so overlays re-render
at UI framerate and box coordinates stay inspectable and testable.

**Server to engine node:** REST for control (assign camera, start session, lock on
target), WebSocket for results (tracklets, candidate matches).

**Engine node to Neo4j:** read-only Bolt, camera topology queries only. Engine
nodes never write to either database. Everything that mutates state goes through
the server's saga so it passes the audit emitter.

**Server to ledger:** HTTP to the gateway on 8801. This REST boundary is what makes
the mock ledger a one-flag swap and what insulates the Rust core from Fabric's SDK
situation.

---

## 3. Compute budget

This section constrains sections 4 and 5. Read it first.

### 3.1 Calibration

On startup an engine node runs a ten-second calibration: batched detector forward
passes at target resolution and precision, measuring sustained throughput and peak
allocated VRAM. It derives:

- `budget_dps` — sustained detections per second
- `vram_ceiling` — allocatable bytes, leaving headroom for the display and for
  decoder buffers
- `max_batch` — largest batch that fits within the ceiling

These are reported to the server and shown in the health board. They are measured
per install, not configured.

### 3.2 Allocation

Cameras request slices from a scheduler against `budget_dps`. Demand exceeding
supply degrades per-camera FPS uniformly rather than dropping a camera. The
scheduler exposes per-feed effective FPS, which the UI displays on every tile.

Below a quality floor, tracklet continuity degrades enough to hurt Re-ID. That
floor is measured in experiment S1 (`EVALUATION.md`) and is not guessed. Below it
the UI shows a warning band on affected feeds. Producing worse matches silently is
the failure this prevents.

### 3.3 Residency

On the engine node, the CV stack is resident: detector plus embedder in TensorRT
FP16. Nothing evicts it, because it is doing continuous work.

On the server, the document lane is queued. HTR and NER models load on demand and
release on idle. When the server also hosts an engine node (development profile),
the document lane yields: an in-flight tracking session pauses document processing
rather than competing for VRAM.

This inverts the prototype's mutual-eviction design, which assumed CV ran only in
short bursts (see D2, D14).

### 3.4 Indicative allocation on the 6GB reference machine

Illustrative, to be replaced by S1 measurements:

| Consumer | Approximate |
|:---|:---|
| Display and WebView2 | 0.5 - 1.0 GB |
| CUDA context | 0.3 - 0.5 GB |
| Detector, TensorRT FP16, batched | 0.8 - 1.5 GB |
| Re-ID embedder, TensorRT FP16 | 0.3 - 0.7 GB |
| Decoder buffers | 0.2 - 0.5 GB |
| Remaining for the document lane | 2.0 - 3.0 GB |

The remainder is what sizes the language model on an all-in-one install. It is
also why a 7B vision-language model for handwriting is not viable and a dedicated
line recogniser is (section 4).

---

## 4. Document pipeline

```text
file
 |
 +- magic-byte sniff (never the extension)
 |
 +- CSV / JSON / XLSX ----> typed parse -> staging -> deterministic edges
 |                          no model inference, no GPU
 |
 +- PDF with text layer --> direct text extraction, skip recognition
 |
 +- scanned PDF / image --> RECOGNITION PATH below
 |
 +- anything else --------> reject, reason shown in UI
```

### 4.1 Recognition path

```text
1  PREPARE      deskew, dewarp, binarise                      script-agnostic
2  SEGMENT      layout detection, line splitting              script-agnostic
3  IDENTIFY     script classification, per line               small CNN
4  RECOGNISE    one multi-script line recogniser              shared charset
5  CONSTRAIN    per-field charset + validator, known forms    D18
6  GATE         per-script CER gate + per-field confidence    D17, FR-2.6
7  REVIEW       queue: crop beside transcription, human edits FR-2.7
8  EXTRACT      NER over confirmed text, spans preserved      D11
```

Step 2 is the layer no public word-level corpus trains, since IIIT-INDIC-HW-WORDS
and its relatives ship word crops rather than annotated pages. It is validated on
collected forms (Corpus B), which is one of the main reasons Corpus B exists.

Step 5 is likely the cheapest accuracy improvement in the whole pipeline. FIRs are
forms: a date field with a date charset and format validator, a section-number
field with a section validator, a phone field restricted to digits. Free-text
narrative stays unconstrained.

Step 6 is the honesty mechanism. A script is auto-extract only after its CER
clears the gate on held-out data. Everything else routes to assisted
transcription: still segmented, still recognised, still pre-filled, but confirmed
by a person before any entity exists.

### 4.2 Extraction contract

One task per call, hard schema, character spans into source text so every extracted
value points back at the pixels it came from. Constrained decode, schema
validation, one bounded repair retry that feeds the validation error back into the
prompt, then quarantine to a review queue. Never a crash, never a silent drop.

### 4.3 Ingest saga

```text
 #  Actor    Action                                     On failure
--  -------  -----------------------------------------  --------------------------
 1  Server   stream file, SHA-256                       abort, nothing written
 2  Server   INSERT source_files (status hashing)       abort
 3  Server   store blob, content-addressed              delete row, abort
 4  Server   ledger anchor {docHash}                    mark pending, CONTINUE
 5  Server   UPDATE source_files SET ledger_tx_id       -
 6  Server   -> document lane: recognition (if needed)  status ocr_failed, stop
 7  Server   -> document lane: extraction               repair, then needs_review
 8  Server   (gated scripts only) human review          blocks 9 until resolved
 9  Server   pg txn: entities, identifiers,             rollback, status failed
            relationships, evidence, provenance
10  Server   Cypher MERGE nodes and edges               sync_state pending,
                                                        reconciler retries
11  Server   ledger action {extractionHash}             retry queue
12  Server   emit ingest.complete
```

Implementation split: steps 1-4 run in the HTTP handler (stream, hash,
store blob, initial DB row). Steps 5-6 run in the background saga task
(ledger anchor, MIME routing). Steps 7-9 are implemented in
`server/src/saga/ingest.rs`. Steps 10-12 (Cypher MERGE, ledger action,
emit event) are wired inside `run_steps_7_to_9`. The saga uses the
`raven_saga` database role (D33).

Steps 9 and 10 are deliberately not atomic. Step 10 is idempotent, and
`rebuild_graph()` regenerates all of Neo4j from Postgres. The graph is an index,
not a record.

Step 8 is new in v2 and is the point where a non-gated script cannot proceed
automatically.

---

## 5. Camera pipeline

### 5.1 Sources and the case clock

Every source registers as `(source_id, camera_id, mode, declared_start_ts, fps)`.
Mode is live or recorded. All downstream timestamps derive from the case clock,
never system time (D16).

- **Live:** RTSP with reconnect and exponential backoff, frames dropped to stay
  current.
- **Recorded:** seekable, may run faster or slower than wall-clock, and
  `declared_start_ts` is required with no default because a wrong value silently
  corrupts every cross-camera inference. It is displayed on every feed.

Mixing live and recorded in one session is allowed only when declared times cohere;
the system warns when they do not.

### 5.2 Continuous stage

```text
decode (NVDEC) -> scheduler slice -> batched detector -> tracker -> tracklets
                                                                 |
                                                    MJPEG out ---+--- WS boxes
```

All cameras, all the time, within `budget_dps`. Detection is shared: two analysts
watching the same camera see the same boxes because they were computed once. That
is the main reason inference is server-side rather than per-client (D20).

### 5.3 Lock-on

An officer selects a track id. Only then is an appearance embedding computed, from
the best-quality crops in that tracklet rather than a single frame. The selection
is signed with the officer's identity and anchored, because it is a decision with
evidentiary weight (D9).

### 5.4 Cross-camera matching

Matching runs on all cameras. Topology modulates the threshold rather than gating
execution (D15):

```text
for each completed tracklet on any camera:
    embed (mean of top-k quality crops, L2-normalised)
    similarity = cosine(embedding, target_embedding)     via pgvector, HNSW
    prior      = f(topology distance, elapsed time,
                   LEADS_TO mean_travel_s and stddev_s from last confirmed sighting)
    threshold  = base_threshold - prior_adjustment
    if similarity > threshold: propose candidate
```

Per-tracklet rather than per-frame: far less compute and better accuracy, since an
aggregated embedding is more stable than any single crop.

Every proposal carries its explanation: score, threshold, the topology expectation
that moved the threshold, both crops, elapsed time. FR-5.6 requires this to be
visible, and it is also what makes the parameters debuggable.

### 5.5 Confirmation and loss

Candidates are proposals. Nothing reaches the case record, the map or the graph
until a person confirms. Rejections are recorded as well, because they are audit
evidence and a source of tuning signal.

When no candidate clears within the expected window, the UI states that the target
was lost at a named camera and offers to widen the search. It does not quietly
continue.

---

## 6. Data model

### 6.1 Source of truth

Postgres 16 with pgvector holds everything. Neo4j is a derived projection,
rebuildable at any time. Blobs are content-addressed on disk by SHA-256.

Core tables: `source_files`, `ingest_jobs`, `entities`, `identifiers`,
`relationships`, `evidence`, `entity_merges`, `location_history`,
`financial_txns`, `cdr_records`, `cases`, `case_assignments`, `reid_targets`,
`reid_candidates`, `reid_sightings`, `cameras`, `camera_edges`, `engine_nodes`,
`form_templates`, `review_items`, `audit_log`.

### 6.2 Provenance

```sql
CREATE TYPE provenance AS ENUM ('benchmark', 'collected', 'synthetic');
```

Every table carrying case content has a `provenance` column, propagated from the
source file through extraction into entities, identifiers, relationships and
evidence. The evaluation harness filters on it and refuses to compute metrics over
synthetic rows (D19). This is enforced in code, not by convention.

### 6.3 Graph projection

Nodes: `Person`, `Organisation`, `Account`, `Location`, `Vehicle`, `Camera`.
Person-to-person edges carry the computed weight. Other types exist and are
expanded on demand, never rendered by default (D23).

Camera topology lives here too: `(:Camera)-[:LEADS_TO {mean_travel_s, stddev_s}]->(:Camera)`,
which is what section 5.4's prior reads.

### 6.4 Edge weight

A configurable weighted sum over evidence types with a time-decay term. The
parameters are named and versioned, and the scheme is validated against
covert-network ground truth rather than asserted (D27). See `EVALUATION.md`
experiment S5.

### 6.5 Re-ID vectors

`vector(512)` with an HNSW index. Continuous operation makes this grow, so
tracklet embeddings have a retention policy (PRD Q5). Confirmed sightings are
retained; unconfirmed tracklet embeddings expire.

---

## 7. Identity, access, ledger

### 7.1 Authentication and authorisation

GoTrue for authentication. Row-level security scoped per case, with four roles as
defined in the PRD. The administrator role manages users, cases, cameras and
templates without read access to case content.

RLS is real, not a single permissive policy. An RLS bug is a data breach, so it
has a dedicated test suite (NFR-8).

### 7.2 Ledger

Multi-org Fabric: two or three organisations with separate MSPs, each running a
peer, with an endorsement policy requiring signatures from more than one
organisation (D22). Altering a record requires collusion across agencies, which is
the property that makes tamper-evidence meaningful. A ledger you alone control
proves nothing.

The authenticated user's identity maps to a ledger identity, so confirmations,
rejections, merges and evidence access are attributable to a person rather than to
the application.

A mock ledger (in-process signed Merkle log, identical REST interface) exists as a
development flag so the UI runs without Docker. It is never the demonstrated
configuration.

### 7.3 Verification

Opening a document recomputes its hash from stored bytes and compares against the
ledger. On mismatch: a visible tamper state showing both hashes, and every entity
and edge derived from that document is marked and excluded from analysis until
resolved (FR-4.6).

---

## 8. Repository and deployment

```text
raven/
├── client/                    # Tauri desktop
│   ├── src/                   # React
│   └── src-tauri/
├── server/                    # Rust
│   ├── src/{api,saga,db,ledger,audit}/
│   └── migrations/
├── engine/                    # Python, camera node
│   ├── scheduler.py           # D14, build first
│   ├── decode.py              # NVDEC
│   ├── detect.py  track.py  reid.py
│   └── topology.py
├── docs-lane/                 # Python, server-side document lane
│   ├── prepare.py  segment.py  scriptid.py  recognise.py
│   ├── templates/             # D18 form field maps
│   └── extract.py  schemas.py
├── ledger/
│   ├── chaincode/  gateway/  mock/
├── infra/
│   ├── compose/{all-in-one.yml,server.yml,engine.yml}
│   ├── fabric/                # multi-org network
│   └── migrations/
├── eval/                      # harness, splits, metric scripts
│   ├── datasets/  splits/  metrics/
│   └── run_all.py
└── docs/
    ├── PRD.md  ARCHITECTURE.md  DECISIONS.md  EVALUATION.md  RESULTS.md
```

Deployment profiles, same images throughout:

- `all-in-one` — server, one engine node and client on one machine. Development
  and the campus pilot.
- `split` — server on one machine, engine nodes near cameras, clients per user.

---

## 9. Honest status

| Property | Status | Note |
|:---|:---|:---|
| No third-party egress | Real | Enforced by network policy test in CI, including map tiles |
| Evidence hash anchoring | Real | Actual SHA-256, actual ledger transactions |
| Tamper detection | Real | Recompute and compare on every read |
| Cross-org endorsement | Real once D22 lands | Single-org until then, and labelled as such |
| Officer identity | Real | GoTrue identity mapped to ledger identity |
| Row-level security | Real | Per-case policies with a test suite |
| Multi-script recognition | Per-script | Auto-extract only above the CER gate; status table published |
| Cross-camera Re-ID | Proposal only | Never asserts identity without human confirmation |
| Real case data | Not present | Corpora A, B, C only. No agency data exists in the system |
| Live government system integration | Absent | Adapter-shaped, no agreements exist |

The right column is the reason this table exists. A system that states what is
stubbed reads as more credible than one that implies everything is production
grade.

---

## 10. Known weaknesses

1. **MJPEG on a LAN.** Fine on loopback, expensive across a network at high camera
   counts. First thing to revisit if per-feed bandwidth becomes the constraint;
   WebRTC is the successor. Measure before switching.
2. **`declared_start_ts` is a silent failure surface.** A wrong value corrupts
   cross-camera reasoning without any error. Mitigated by making it required and
   always visible, not solved.
3. **Re-ID under clothing change or long time gaps.** Appearance embeddings do not
   survive either. The topology prior helps within a session and does nothing
   across days. This is a real limit and belongs in any claim made about the
   system.
4. **Multi-script accuracy will be uneven.** Low-resource scripts in the joint
   training mix will lag. Handled by gating, not by pretending otherwise.
5. **The single server is a single point of failure.** Acceptable at pilot scale,
   not beyond it.
6. **Neo4j staleness windows.** Brief and self-healing via the reconciler, but real.
7. **No agency data has ever been processed.** Everything is validated on public
   benchmarks and self-collected data. Real FIR handwriting, real CDR structure and
   real case complexity may differ in ways that are currently unknown.
