# Raven Decision Log

Every architectural decision, why it was made, and what it cost. Prototype-era
decisions (D1-D13) are kept with their status so the reasoning behind changes is
visible rather than silently overwritten.

**Status values:** `ACTIVE` · `AMENDED` (still holds, scope changed) ·
`SUPERSEDED` (replaced, see successor) · `RETIRED` (no longer applicable)

**Format:** context, decision, consequences. A decision is not a plan. If a
decision needs a number to be correct, it names the experiment that produces it.

---

## Summary table

| ID | Area | Status | Successor |
|:---|:---|:---|:---|
| D1 | Engine transport | AMENDED | - |
| D2 | GPU model residency | SUPERSEDED | D14 |
| D3 | Video to UI | ACTIVE | - |
| D4 | Postgres/Neo4j consistency | ACTIVE | - |
| D5 | Ledger anchor timing | ACTIVE | - |
| D6 | Basemap | ACTIVE | - |
| D7 | Re-ID vector storage | AMENDED | - |
| D8 | Camera topology gating | SUPERSEDED | D15 |
| D9 | Human-in-the-loop Re-ID | ACTIVE | - |
| D10 | Single graph writer | AMENDED | - |
| D11 | LLM output handling | AMENDED | D11-A |
| D11-A | Surface-then-resolve extraction | ACTIVE | - |
| D12 | Supabase footprint | AMENDED | - |
| D13 | Fabric client boundary | AMENDED | D22 |
| D14 | Compute-budget scheduler | ACTIVE | - |
| D15 | Topology as a match prior | ACTIVE | - |
| D16 | Case clock | ACTIVE | - |
| D17 | Single multi-script recogniser | ACTIVE | - |
| D18 | Form-template field constraints | ACTIVE | - |
| D19 | Three corpora and provenance | ACTIVE | - |
| D20 | Server / engine node / thin client | ACTIVE | - |
| D21 | Real identity, RLS and signed actions | AMENDED | D37 |
| D22 | Multi-org Fabric | ACTIVE | - |
| D23 | Person-centric graph | ACTIVE | - |
| D24 | Metric-gated milestones | ACTIVE | - |
| D25 | General LEA framing | ACTIVE | - |
| D26 | Campus pilot before agency pilot | ACTIVE | - |
| D27 | Calibrated edge weights | ACTIVE | - |
| D28 | insight_reviews RLS tightening | ACTIVE | - |
| D29 | Preview extraction contract | ACTIVE | - |
| D30 | TypeScript type generation | ACTIVE | - |
| D31 | Egress gate scope: anchor hrefs excluded | ACTIVE | - |
| D32 | Camera list unauthenticated on LAN | ACTIVE | - |
| D33 | Ingest saga database role | ACTIVE | - |
| D34 | Document upload: io role only, 200MB cap | ACTIVE | - |
| D35 | PDF routing: lopdf text extraction | ACTIVE | - |
| D36 | Structured file ingest path | ACTIVE | - |
| D37 | Administrator read access to case content | ACTIVE | - |

---

## Prototype decisions, carried forward

### D1 - Engine transport `AMENDED`

**Original:** the Python engine runs as a sidecar HTTP and WebSocket server on
`127.0.0.1:8756` rather than communicating over Tauri IPC, because IPC serialises
every payload through the Rust bridge and stalls the WebView render thread on
large payloads and video frames.

**Amendment:** the transport choice was right and turns out to be what makes D20
cheap. The engine is no longer a localhost sidecar; it is a network service that
registers with the server and owns a set of cameras. The client talks to a LAN
address instead of loopback. No protocol change.

**Consequences:** engine nodes need discovery, health reporting and
authentication, none of which loopback required. TLS on the engine API is now
mandatory rather than pointless.

### D2 - GPU model residency `SUPERSEDED by D14`

**Original:** a single `asyncio.Lock` gated the GPU, and acquiring it for one lane
explicitly evicted the other. CV evicted Ollama, NLP evicted the CV stack.

**Why it fails now:** the original assumed CV runs only during a demonstrated
tracking session. The system now watches all cameras continuously, so the CV lane
is permanently resident and there is nothing to evict it for. Mutual eviction
becomes mutual starvation.

### D3 - Video to UI `ACTIVE`

**Decision:** MJPEG over `multipart/x-mixed-replace` consumed by a plain `<img>`,
with bounding boxes sent separately as JSON over WebSocket and drawn as an SVG
overlay.

**Why it still holds:** the browser decodes MJPEG natively with no JavaScript
involvement, and separating boxes from pixels keeps overlays re-rendering at UI
framerate while leaving box coordinates inspectable and testable.

**Consequences:** MJPEG is bandwidth-hungry, which was irrelevant on loopback and
is not irrelevant on a LAN. At high camera counts this is the first thing to
revisit; WebRTC is the successor if per-feed bandwidth becomes the constraint.
Measure before switching, because MJPEG's simplicity is worth real bandwidth.

### D4 - Postgres and Neo4j consistency `ACTIVE`

**Decision:** a saga with compensating transactions and an idempotent rebuild
path, not two-phase commit. Postgres commits first and is the source of truth.
Neo4j writes use `MERGE`. On Neo4j failure the row is marked `sync_state='pending'`
and a reconciler retries. `rebuild_graph()` regenerates the whole graph from
Postgres.

**Why:** true 2PC needs an XA transaction manager and prepared-transaction support
on both resources, which Neo4j Community and the Bolt driver do not provide.

**Consequences:** brief windows of graph staleness, acceptable because Neo4j is a
derived index and not a system of record.

### D5 - Ledger anchor timing `ACTIVE`

**Decision:** two independent anchors. The file hash is anchored at ingest because
it is a fact about bytes. The extraction result hash is anchored only after the
Postgres commit succeeds.

**Consequences:** two transaction ids per document to track.

### D6 - Basemap `ACTIVE`

**Decision:** MapLibre GL JS over a local PMTiles extract, not Mapbox or Leaflet
defaults.

**Rationale:** sending a suspect's location trail to a commercial
tile server is a data leak regardless of whether the machine has internet.

### D7 - Re-ID vector storage `AMENDED`

**Decision:** pgvector in Postgres, `vector(512)`, cosine distance, rather than a
dedicated vector database.

**Amendment:** the original justification was that the corpus is tens of vectors.
Continuous multi-camera operation makes it hundreds of thousands. Add an HNSW
index, and set a retention policy on tracklet embeddings so the gallery does not
grow without bound. Revisit at roughly 10M vectors.

### D8 - Camera topology gating `SUPERSEDED by D15`

**Original:** after lock-on, inference is suspended on the source camera and
activated only on adjacent cameras inside a predicted arrival window derived from
`(:Camera)-[:LEADS_TO {mean_travel_s, stddev_s}]->(:Camera)`.

**Why it fails now:** the requirement is that every camera which sees the suspect
shows the suspect. A hard gate means an unmapped route loses the target
permanently, which the original doc accepted as by design. That is no longer
acceptable.

### D9 - Human-in-the-loop Re-ID `ACTIVE, strengthened`

**Decision:** no automatic identity assertion. The detector assigns local track
ids, the officer selects the target, and only then is a feature vector generated.

**Extended:** the confirmation requirement now also covers cross-camera matches.
The system proposes candidate sightings ranked by score; a person confirms or
rejects each one, and only confirmed sightings enter the case record or the graph.

**Why:** automatic Re-ID accuracy on commodity hardware and low-resolution CCTV is
poor, and a false automatic match in a policing tool is a serious harm. The
officer's confirmation is also a legally meaningful act, which is why it is signed
and anchored.

**Consequences:** requires an operator, and throughput is bounded by human review.
Positioned as evidentiary accountability, not as a limitation.

### D10 - Single graph writer `AMENDED`

**Decision:** exactly one component writes to Neo4j; everything else has read-only
credentials. Every graph mutation therefore passes the audit emitter.

**Amendment:** the writer is now the server's Rust core rather than a local
process, and engine nodes hold read-only Bolt credentials for topology queries
only.

### D11 - LLM output handling `ACTIVE`

**Decision:** constrained JSON decode plus a Pydantic model plus one bounded repair
retry that feeds the validation error back into the prompt. A third failure
quarantines the document into a `needs_review` queue.

**Why:** fail into a visible queue, never into a crash or a silent drop.

**D11-A — Surface-then-resolve extraction contract (supersedes span-from-model):**
the model returns {type, value} pairs only. Character spans are resolved
deterministically by the harness via str.find() with occurrence-index
disambiguation. Rationale: a 1.5B model counting characters across 3000-char raw
emails produced systematically wrong spans in S4 (see RESULTS.md S4 rows). The
model's job is surface identification, not offset arithmetic. Evidence: all 2
answered items in S4 emitted plausible small integers unrelated to actual
character positions.

### D12 - Supabase footprint `AMENDED`

**Original:** trim `config.toml` heavily because RAM is the binding constraint and
none of the auth or API surface is used.

**Amendment:** real accounts and row-level security are now requirements, so
GoTrue, PostgREST and Storage are earning their memory. Analytics (Logflare),
imgproxy, edge-runtime and inbucket stay disabled. The trim is narrower, not gone.

### D13 - Fabric client boundary `AMENDED, extended by D22`

**Decision:** the ledger is reached through a thin Node REST service rather than
from Rust directly, because there is no maintained production-grade Rust SDK for
Fabric.

**Why it still holds:** the REST boundary is what makes the mock ledger a
one-flag swap, and it survives the move to multi-org unchanged.

---

## New decisions

### D14 - Compute-budget scheduler `ACTIVE`

**Context:** camera count must scale with whatever hardware the system is
installed on, from a 6GB laptop to a server GPU, without a code change or a config
file that lies.

**Decision:** at startup the engine node runs a calibration pass (batched detector
forward passes at target resolution for ten seconds) and derives a budget in
detections per second and a VRAM ceiling. Cameras request slices from a scheduler
against that budget. When demand exceeds supply, per-camera detection FPS degrades
uniformly rather than a camera failing. The CV lane is resident; the document
lane (OCR, HTR, LLM) is queued and yields to it.

**Consequences:**

- Per-feed effective FPS must be visible in the UI. An operator watching a feed at
  3 FPS has to know that.
- A quality floor is required: below roughly 5 FPS, tracklet continuity degrades
  enough that Re-ID quality drops. The exact figure comes from S1b and is **still
  not measured** (M1-T8, 2026-09-11 -- S1b re-attempted this pass): it needs IDF1
  as a function of detection FPS against ground-truth multi-camera identity
  tracks. `EVALUATION.md`'s S1 datasets are dropped or blocked -- MOT17 dropped
  (motchallenge.net returned 410 Gone site-wide, no licence visible), WILDTRACK
  dropped (no licence stated anywhere on its page, rechecked directly), MMPTrack
  requires a signed T&C form with no registration link received, and PETS2009 --
  the intended S1b source, anonymous download, permissive terms per secondary
  sources -- was attempted 2026-09-11 and is currently blocked: the University of
  Reading's direct HTTP server (ftp.cs.rdg.ac.uk / sida.rdg.ac.uk) timed out on
  port 80 and refused on 443, while the university's main site and institutional
  repository are both reachable, so this is a dead host, not a general network
  failure (`RESULTS.md`, S1b/PETS2009/full-split/STATUS/BLOCKED). `engine/detect.py`'s
  `quality_floor_fps()` continues to raise rather than guess (rule 10). Below the
  floor the UI warns rather than silently producing worse matches, once the floor
  is known. When PETS2009 does become reachable, note in advance that its native
  7 FPS caps the throttling curve, making that quality floor conservative by
  construction -- M6's campus footage re-measurement supersedes it.
- Re-checked 2026-09-13 (M1-T7/T8 follow-up): PETS2009's direct host is still
  down, unchanged from 2026-09-11. WILDTRACK's own dataset page was re-fetched
  directly and confirms no licence is stated for the dataset (only its toolkit
  code carries a licence, GPLv3, which does not cover the data). A third-party
  Kaggle re-upload of PETS2009 was found but rejected: it re-hosts the data
  without a verifiable licence chain back to the University of Reading
  copyright holder, which is the same unverifiable-provenance problem rule 10
  exists to prevent, not a fix for it. Still blocked; see `RESULTS.md`
  (S1b/PETS2009/full-split/STATUS/BLOCKED, 2026-09-13 row).
- Throughput reference figure published in `RESULTS.md` (S1a-throughput,
  M1-T8, 2026-09-11): 16 cameras sustained at 10 FPS each on the reference
  RTX 4050 6GB machine, real RTSP decode (16 looped RTSP sources via mediamtx,
  TCP transport), real TensorRT FP16 detection. All tested levels (1 through
  16) sustained; peak VRAM stayed at 143.4MB of the 6GB budget, so the true
  ceiling was not found and is at least 16 -- re-measuring past it needs more
  provisioned RTSP sources than this pass set up. An earlier attempt in the
  same session (superseded `S1-throughput` rows in `RESULTS.md`) used UDP RTSP
  transport and per-stream software re-encoding and measured a spuriously low
  1-2 camera ceiling; that was loopback UDP packet loss and CPU encoder
  contention from too many concurrent local publishers, not a real pipeline
  constraint, and is not the operative figure.

### D15 - Topology as a match prior `ACTIVE, replaces D8`

**Context:** D8 saved compute by refusing to look. The requirement is now to look
everywhere and still be smart about it.

**Decision:** detection runs on all cameras continuously. Re-ID matching also runs
on all cameras, but the camera topology graph modulates the decision threshold
rather than gating execution. A candidate inside the predicted arrival window from
a confirmed sighting clears at a lower similarity; a candidate on a camera three
hops away at an implausible time needs a much higher one. The predicted window
comes from the same `LEADS_TO` edges as before.

**Why this is better:** it keeps the contribution (the topology graph doing real
work) while removing the failure mode (unmapped route means permanent loss). It
also produces an explanation for every proposed match, which the evidence panel
needs: this candidate scored 0.68, and the topology prior expected an arrival here
between 14:22 and 14:31.

**Consequences:** more compute than D8, bounded by D14's budget. Thresholds and
the prior's weighting are parameters, and they must be tuned on labelled
multi-camera data rather than guessed live. See `EVALUATION.md`.

### D16 - Case clock `ACTIVE`

**Context:** sources are a mix of live RTSP feeds and recorded files. Cross-camera
Re-ID is meaningless without a shared time base, and a recorded clip has no
inherent wall-clock time.

**Decision:** every source registers as
`(source_id, mode, declared_start_ts, fps, camera_id)`. All downstream timestamps
are case-clock, derived from the declared start plus frame offset. Nothing
downstream reads system time.

**Consequences:**

- Historic footage replays through exactly the same topology and travel-window
  logic as a live feed.
- A wrong `declared_start_ts` silently corrupts every cross-camera inference, so it
  is a required field with no default, and the UI shows it on every feed.
- Live and recorded sources can coexist in one session only when their declared
  times overlap coherently. The system warns when they do not.

### D17 - Single multi-script line recogniser `ACTIVE`

**Context:** handwritten documents must be supported across English and several
Indic scripts, on a GPU that is already hosting a resident CV lane.

**Decision:** one recogniser (PARSeq or a CRNN) with a shared Unicode charset,
fine-tuned jointly across all target scripts, rather than one model per script.
Preceded by script identification per line, because FIR forms routinely mix
English labels with Indic content.

**Why:**

- VRAM. One model at roughly 200-400MB stays resident alongside the CV lane. Eight
  cannot, and load-on-demand thrashes on mixed-script documents.
- Transfer. Indic scripts share structural features, which is why the source
  corpus (IIIT-INDIC-HW-WORDS) is published as a combined multi-script set.
- Maintenance. One training run, one eval harness, one CER table.

**Consequences:** per-script accuracy sits below what a dedicated single-script
model would reach, and low-resource scripts in the mix lag. Handled by D17's
companion rule: a script is auto-extract only once its CER on held-out data clears
the gate. Everything else routes to assisted transcription, where the pipeline
still segments and pre-fills but a person confirms before any entity is created.

### D18 - Form-template field constraints `ACTIVE`

**Context:** FIRs are forms, not free prose. Generic OCR ignores that.

**Decision:** register a field map per known form layout. Recognition is
constrained per field: a date field gets a date charset and a format validator, an
IPC section field gets a section-number validator, a phone field gets digits.
Free-text narrative stays unconstrained.

**Why:** likely to buy more accuracy on the fields entity extraction depends on
than any model change at this layer, at a fraction of the effort.

**Consequences:** each supported form layout is a small piece of configuration to
author and maintain. Unrecognised layouts fall back to unconstrained recognition
rather than failing.

### D19 - Three corpora and a provenance column `ACTIVE`

**Context:** "we use real data" has to be a checkable claim.

**Decision:** three separate corpora.

| Corpus | Contents | Role |
|:---|:---|:---|
| A - benchmark | Public real datasets (see `EVALUATION.md`) | Every published metric |
| B - collected | Own filled forms, own multi-camera footage, with consent | In-domain evaluation and demonstration |
| C - synthetic | Joins and case scaffolding only | Connecting A and B into coherent cases |

Corpus C never generates raw signal. No fabricated handwriting, no fabricated
video, no fabricated network topology. Every row in the database carries
`provenance ENUM('benchmark','collected','synthetic')`, propagated through
extraction into entities and edges and surfaced in the UI.

**Consequences:** metrics may be computed only over benchmark and collected rows.
This is enforced in the evaluation harness, not by convention.

### D20 - Server, engine nodes, thin clients `ACTIVE`

**Context:** multiple users with real accounts, plus continuous multi-camera
inference, on hardware that varies.

**Decision:** three roles.

| Role | Holds | Why there |
|:---|:---|:---|
| Server | Postgres + pgvector, Neo4j, ledger gateway, document GPU lane, auth | Bursty, user-triggered, small payloads, near the data |
| Engine node | Detection, tracking, Re-ID embedding, MJPEG out | Continuous, video-bandwidth-heavy, emits almost nothing |
| Client | Tauri desktop UI, local file handling | Presentation only, no inference |

One or more engine nodes, each owning a set of cameras. Server and engine node may
be the same machine; `docker compose` profiles cover all-in-one development and
split deployment with the same images.

**Why not per-client GPUs:** two analysts watching the same camera would run
detection twice and could see different boxes on the same footage. Two officers
disagreeing about what a camera showed is an evidentiary problem, not just waste.
Server-side detection runs once and both see identical results.

**Consequences:**

- Adding cameras means adding an engine node, not buying a larger GPU.
- The 6GB laptop is the development machine and the engine-node reference
  configuration, not the deployment target.

### D21 - Real identity, real RLS, signed actions `AMENDED, see D37`

**Context:** accounts are a requirement, and the prototype listed both officer
identity and RLS in its "simulated" column.

**Decision:** Supabase GoTrue for authentication, real row-level security scoped
per case, and three roles (investigating officer, intelligence analyst, forensic
auditor) with distinct capability sets. The authenticated identity maps to a
ledger identity, so confirm, reject and access actions are signed by the person
who performed them.

**Consequences:** the audit ledger stops being a log of assertions and becomes
cryptographically attributable. Access control now needs its own test suite,
because an RLS bug is a data breach.

### D22 - Multi-org Fabric `ACTIVE, extends D13`

**Context:** a single-node ledger anchoring your own hashes to your own ledger,
verified by you, proves nothing. You are checking your data against a record you
fully control.

**Decision:** two or three organisations with separate MSPs (for example district
CID, cyber cell, and a records bureau org), each running a peer, with an
endorsement policy requiring signatures from more than one org. Altering a record
then requires collusion across agencies, which is the property that makes the
tamper claim non-trivial.

**Consequences:** substantially more setup than test-network. The mock ledger
(in-process signed Merkle log, identical REST interface) stays as a development
flag so nobody needs Docker to run the UI, but it is never the demonstrated
configuration.

### D23 - Person-centric graph `ACTIVE`

**Context:** the prototype PRD restricted the graph to person-to-person edges to
avoid visual clutter, while the built UI rendered five entity types.

**Decision:** the default view is person-to-person. Other entity types
(organisation, account, location, vehicle) exist in the data model and are
expanded on demand, either from a selected person or via explicit filters. They
are never rendered by default.

**Why:** a person-to-person view answers the actual investigative question
directly, and a graph showing every account and location at once is unreadable at
any real scale. Making the other types reachable rather than absent keeps the
underlying links available without paying the clutter cost.

**Consequences:** the underlying edge weight must still be computed from all
evidence types even though only person-person edges are drawn by default.

### D24 - Metric-gated milestones `ACTIVE`

**Context:** the prototype plan was clock-gated (36 hours, a cut gate at hour 20).
There is no deadline now, and the failure mode changes from running out of time to
drifting indefinitely.

**Decision:** milestones complete when their metric is measured and recorded, not
when hours elapse. `RESULTS.md` is append-only and every entry carries a date,
commit, dataset and number. Two-week cadence, one measurement run per cycle.

**Consequences:** a fortnight with no new row in `RESULTS.md` is the signal that
something is stuck. That is the intended alarm.

### D25 - General LEA framing with SIH traceability `ACTIVE`

**Decision:** the product is a general law-enforcement criminal network analysis
platform. SIH26189 and its NCRB women-safety framing are retained as the origin
and reference use case in a traceability appendix rather than as the scope
boundary.

**Why:** a pilot happens with whichever agency will actually engage, as likely a
cyber cell or district CID as a women safety division. Requirements written around
one division get rewritten the day a different one says yes.

### D26 - Campus pilot before agency pilot `ACTIVE`

**Context:** the goal is a real pilot, and there is currently no route to a police
agency. Agency approvals take months and are not in the team's control.

**Decision:** run a controlled campus deployment first, with participant consent
documentation and consenting participants, using either existing campus cameras or four
placed cameras. Collect the handwriting corpus the same way. Pursue the agency
conversation in parallel, starting with faculty and an institutional letter.

**Why:** the campus deployment is a genuine pilot that validates the full pipeline
under real optics, lighting and occlusion, and it produces the consent and ethics
process an agency will ask about anyway.

**Consequences:** Participant consent documentation (signed consent records)
must be obtained before collection starts. Confirm with your faculty contact
whether the host institution has its own policy requiring additional
approval — this is a check, not an assumed blocker. Corpus B cannot be
collected before they exist.

**Note:** Data collection approach confirmed: footage recorded by the team
themselves with consenting participants (friends and colleagues), FIR forms
filled by hand with fictional content. Formal institutional ethics approval
is not required for self-collected data among consenting adults who
understand the purpose. A signed consent record is maintained for each
participant.

### D27 - Calibrated edge weights `ACTIVE`

**Context:** the prototype scored connection strength with hand-picked constants
(call +1, transfer +10, co-accused +25, co-location +10) multiplied by a time decay.
The numbers were invented and nothing validated them.

**Decision:** weights become named, configurable parameters, and the weighting
scheme is validated against covert-network datasets with published ground truth.
Two concrete tests: whether weighted centrality recovers known leadership roles in
the Ndrangheta network, and whether weights at snapshot *t* predict edges at *t+1*
in the Caviar sequence.
(Superseded: KONECT Noordin Top used instead for role recovery, and a KONECT
temporal snapshot sequence for link prediction — see EVALUATION.md §S5. No
KONECT S5 dataset audit row exists in RESULTS.md yet; the per-dataset licence
audit is pending (S0 follow-up), so no date is cited here rather than invented.
Original sentences retained as history.)

**Consequences:** the scoring matrix becomes a measurable claim rather than an
assertion, and the same harness detects when a change to the weights makes results
worse.

**D27-FINDING (2026-09-14, S5-enron — FLAGGED, not suppressed):** the v1
weighting performs worse than unweighted degree on real temporal data.
`eval/s5_link_prediction.py` over the Enron CMU communication network
(3,356,325 dated edges, 1999-01-04..2002-07-12, 3 equal-interval snapshots,
CALLED-base decay half-life 180d vs degree-product baseline, top-2000
degree-capped universe, seeded negatives): pair t0→t1 weighted AUC 0.6120
vs unweighted 0.8043 (delta −0.1922); pair t1→t2 weighted 0.7552 vs
unweighted 0.7957 (delta −0.0406). Weighted ≤ unweighted on both pairs, so
per the S5 decision rule the v1 scoring matrix is decoration for this data
— it must be replaced or described honestly as a display heuristic, not
used as an analytical claim. The decay-only persistence signal loses to
preferential attachment on Enron; whether this generalises to covert
networks is untested (role-recovery half still BLOCKED). Rows:
`RESULTS.md` S5-enron/enron-cmu-2015.

### D28 - insight_reviews RLS tightening `ACTIVE`

**Context:** the baseline's `via_case` policy on `insight_reviews` is
`USING (true)`, noted in the baseline as permissive because `object_id` is a
polymorphic reference (`object_type` names which table it points into) and the
baseline shipped no per-type join (M0-T3, M0-T4/NFR-8).

**Decision:** an additive migration (`20260911000000_tighten_insight_reviews_policy.sql`)
replaces the policy with `insight_review_case_access(object_type, object_id)`, a
`SECURITY DEFINER` function that joins to the correct parent per `object_type` and
calls `has_case_access`. Discovered while implementing it: `insight_reviews.object_id`
is `uuid`, but `reid_candidates.id` and `entity_merges.id` are `bigserial`. A
`'candidate'` or `'merge'` review's `object_id` can never match a real row under
either table's actual key type, so those two branches return `false`
unconditionally (fail closed, D9-style) rather than silently resolving nothing and
passing.

**Consequences:** `candidate` and `merge` reviews are unreadable by anyone until
the underlying type mismatch is fixed. The real fix is a schema change -
`reid_candidates.id` and `entity_merges.id` to `uuid`, or a typed discriminated FK
on `insight_reviews` - tracked as a follow-up rather than done here, since
migrations are additive after the baseline and this is a data-model change, not a
policy change.

### D29 - Preview extraction contract `ACTIVE`

**Context:** `POST /cases/{id}/preview-extraction` was specified as running
"SpanResolver only" with a body of `{text, source_node}` and no model call,
which leaves the `{type, value}` surfaces and any confidence numbers without
a specified source.

**Decision:** the endpoint accepts caller-supplied surfaces
`[{type, value}]` in the request body rather than running a model call.
SpanResolver grounds them against the supplied text and returns
`[{type, value, char_start, char_end}]`. No model inference, no confidence
values (confidence is the recogniser's output, already present in the
`review_items` row the client is displaying).

**Rationale:** the Document Review right panel already holds recognised text
and surfaces from the review queue - re-running recognition server-side would
be redundant and would require a model call with no benefit. The endpoint's
job is span resolution only.

**Origin:** Session 12 - implementation showed the original spec was
underspecified.

### D30 - TypeScript type generation `ACTIVE`

**Context:** API_CONTRACTS.md §6 rule 2 requires client TypeScript types
to be generated from Rust signatures. No generation tooling (ts-rs,
specta, utoipa) exists in the tree. `client/src/types/api.ts` is
currently hand-written and marked temporary.

**Decision:** add ts-rs derives to server Rust structs and a
`cargo xtask generate-types` command before M6. The hand-written file
must be kept in sync manually until then and is a known correctness
risk.

**Origin:** Session 12 - type generation tooling absent from tree,
discovered when Entity Profile endpoint shape changed.

**Implemented:** `cargo xtask generate-types`, 2026-09-15. Generated
types in `client/src/types/generated/` (gitignored, derived from Rust
structs via `#[derive(TS)]`). Notes: upstream ts-rs 10.1 has no
`chrono`/`uuid` features and no `time` support, so the features used
are `uuid-impl` + `serde-json-impl` with explicit `#[ts(type =
"string")]` on case-clock fields and `#[ts(type = "number")]` on i64
fields (JSON wire carries numbers, never bigint); `#[ts(export)]` is
deliberately not used (it emits file-writing tests — parallel writers
on shared paths), the registry in `server/src/ts_export.rs` enumerates
boundary types instead, with a unit test pinning the shape-identical
duplicate sources (nine ErrorEnvelope/ErrorBody copies, two
DecideDecisions). The rich client `Camera` is a contract-target view
model (`CameraView`), not wire truth: the stub `GET /cameras` serves
only the five M1-T1 fields (see `main.tsx`).

### D31 - Egress gate scope: anchor hrefs excluded `ACTIVE`

**Context:** eval/test_no_egress.py narrowed its href= pattern from any
href= to <link href= (stylesheet/font vectors only) after MapLibre's
inert library anchor strings (opt-in logo default, attribution
default) tripped the gate on strings that are never fetched at
runtime. The fetching patterns (fetch(), <script>/<img src=, <link
href=, CSS url(), WebSocket) remain fully covered. Plain <a href=
hyperlinks are excluded because they require a user click and do not
constitute programmatic egress.

**Verification:** the gate refinement is tested with a scratch matrix:
all six fetching vectors caught, all three inert anchor cases ignored.

**Origin:** Session 12 Map screen — MapLibre bundle included
maplibre.org anchor strings that triggered a false positive.

### D32 - Camera list unauthenticated on LAN `ACTIVE`

**Context:** `GET /cameras` requires no authentication. This was
intentional — officers need the camera list without admin rights —
but was never recorded as a decision, so it read as an oversight.

**Decision:** `GET /cameras` requires no authentication. Rationale:
any authenticated endpoint on a premises LAN that lists camera
locations is not meaningfully more secure than an unauthenticated
one — an attacker with LAN access already has the information.
Requiring auth adds friction for legitimate users (investigators
checking feeds) with no real security benefit in the threat model.
Camera registration (`POST /cameras`) requires admin auth (e951ad6),
and topology edge creation (`POST /camera-edges`) requires admin auth
with the same auth→audit pattern; both write platform-scoped
(nil-`case_id`) audit rows (`camera.register`, `camera.edge`).

**Revisit if:** the system is ever exposed beyond a premises LAN.
Pinned by `server/tests/cameras.rs`
(`list_cameras_needs_no_authentication`).

**Origin:** Session 13 — Part 4 camera auth audit.

### D33 - Ingest saga database role `ACTIVE`

**Context:** the ingest saga runs as a background task with no user JWT,
so neither the per-request RLS identity nor the service-role key fits:
the service-role key bypasses RLS and application code never uses it,
and there is no user token to ride on.

**Decision:** the saga uses a dedicated Postgres role `raven_saga` with
INSERT/UPDATE on `source_files`, `ingest_jobs`, `entities`,
`identifiers`, `relationships`, `evidence`, `entity_aliases`,
`location_history`, `cdr_records`, `financial_txns` and SELECT on
`cases` and `case_assignments`. It does not use the service-role key
(which bypasses RLS) and does not use a user JWT (which it does not
have).

The saga role is created in a new migration. It is not an RLS subject —
it owns its tables directly. Actions it takes are attributed to the
uploading user via the `source_files.uploaded_by` column, not via the
database connection.

Ledger actions from the saga use the uploading user's `ledger_id` from
`profiles`. If `ledger_id` is null:
`ledger_status='skipped_no_identity'`, same as the decide endpoints.
The `case_id` comes from the `source_files` row. Both are read from the
database using the saga role before the ledger call.

Trait migration: `CaseDb`, `GraphWriter`, `LedgerAnchor`,
`ExtractionClient` traits move to async. The existing sync signatures
in `ingest.rs` are superseded. Test fakes become async fakes. This is a
breaking change to `ingest.rs` and its tests — update them as part of
the upload implementation session.

**Amendment (upload implementation session):** production wiring uses
adapters, not new services. `SagaDb` (sqlx pool on `SAGA_DATABASE_URL`)
implements async `CaseDb`; a `GraphWriter` adapter records merges
in memory (production parity with the tested fake — the merge call
carries no `case_id`, so placement into case snapshots awaits either
that on the call or the Neo4j writer); a `LedgerAnchor` adapter over
`LedgerClient + SagaDb` reads case/ledger identity per this decision
and anchors the extraction hash via `POST /action` with
`actionType='extraction.anchor'` (ARCHITECTURE.md §4.3 step 11 is a
ledger *action*); a null `ledger_id` becomes
`LedgerOutcome::PendingRetry` carrying the `skipped_no_identity`
reason. Handler tests use trait-generic repos with in-memory fakes
(hermetic-suite convention); `run_ingest` reads `DOCS_LANE_URL` for its
OCR client through the same default const as `DocsLaneClient::from_env`.
Known gaps, not silently fixed: the specified saga-role GRANTs omit
`INSERT ON review_items` (the D36 structured path needs it — one-line
follow-up, since landed as `20260916000001_saga_review_grant.sql`),
and GRANTs alone leave the RLS policies (keyed on
`auth.uid()`, which is NULL in background sessions) denying the role —
owner transfer or equivalent is a follow-up decision. `record_ledger`
therefore persists the extraction-anchor outcome as an `ingest_jobs`
`handoff` row rather than overwriting `source_files.ledger_tx_id`,
which the verify flow needs for the *file* anchor (overwriting it
would compare file bytes against the extraction hash and false-positive
tamper).

**Resolution (2026-09-20, local-functionality session):** the
"owner transfer or equivalent" follow-up is resolved as the
equivalent, in least-privilege form — not owner transfer (which would
bypass RLS wholesale) and not `BYPASSRLS`. `supabase/migrations/
20260920000000_saga_worker_rls.sql` adds permissive policies scoped
`TO raven_saga` mirroring exactly the granted operations
(`source_files` SELECT/INSERT/UPDATE, `ingest_jobs` INSERT/UPDATE,
`review_items`/`entities`/`entity_aliases`/`identifiers`/
`relationships`/`evidence`/`location_history`/`cdr_records`/
`financial_txns` INSERT). `20260920000001_saga_case_insert.sql` adds
`GRANT INSERT ON cases` plus a saga-scoped INSERT policy, because
`POST /cases` dual-writes the row so later uploads satisfy
`source_files_case_id_fkey`. Baseline policies for every other role
are untouched; attribution stays column-based (`uploaded_by`). The
dual-write is pinned by `server/tests/case_assignments.rs`
(`admin_creates_case...` asserts the durable row); the RLS effect
itself was verified live (upload went from RLS-denied to accepted).
The RLS suite (`eval/test_rls.py`) still guards the user paths.

**Resolution, part 3 (session request — cases/assignments must survive
a restart):** `cases` and `case_assignments` reads, and
`case_assignments` writes, join the raven_saga least-privilege set.
`supabase/migrations/20260923193148_saga_case_and_assignment_reads.sql`
adds a `saga_select` policy on `cases` (the D33 role migration already
GRANTed SELECT, but — same RLS caveat as above — no policy meant no
rows), plus `GRANT INSERT, UPDATE ON case_assignments` and matching
`saga_select`/`saga_insert`/`saga_update` policies. `CaseTable` (the
existing hermetic-test seam `create_case` already used) gains
`all_cases`, `insert_assignment_row` and `all_assignments`; `main.rs`
calls the two `all_*` methods once at startup to rehydrate `CaseStore`
and `AssignmentStore` before the router serves anything, and
`assign_user` now writes through `insert_assignment_row` before
touching the in-memory store (D4 order, mirroring `create_case`).

This is deliberately a write-behind cache, not a move to live per-request
Postgres reads: `CaseStore`/`AssignmentStore` stay the synchronous
in-memory structures every authorization check already reads
(`is_assigned` etc.), unchanged, so none of the ~10 call sites the D37
consolidation touched needed to change again. A rehydration failure at
startup is logged and the server still starts empty rather than
refusing to boot (rule 9). Pinned by
`server/tests/case_assignments.rs::cases_and_assignments_survive_a_simulated_restart`,
which throws away the in-memory stores and rebuilds them from the same
`FakeCaseTable`, exactly mirroring `main.rs`'s startup path. Verified
live against `supabase_db_Raven-Security`: `raven_saga` reads the two
pre-existing test cases and successfully upserts an assignment row
under the new policies. Real per-request RLS-enforced reads for cases
(and everything else still in-memory) remain the same documented
follow-up as before.

### D34 - Document upload: io role only, 200MB cap `ACTIVE`

**Decision:** `POST /cases/{id}/files` requires io role. Analysts and
auditors read case data; they do not ingest it.

File size cap: 200MB. Files above this limit are rejected with
`VALIDATION_FAILED` before any bytes are read into memory. 200MB is an
operational limit sized for scanned FIR documents (typically under 20MB)
with headroom for multi-page batches.

Deduplication: global SHA-256. A file whose hash already exists in
`source_files` for any case returns the existing `file_id` with
`duplicate:true`. The baseline schema has a global `sha256` index;
per-case dedup would require a new unique constraint and is not the
current behavior.

Blob storage: `RAVEN_BLOB_DIR` environment variable, defaults to
`./blobs`. Path structure:
`{RAVEN_BLOB_DIR}/{sha256[0..2]}/{sha256}`. Content-addressed,
immutable once written.

MIME detected from magic bytes via `infer`, never from the filename
extension or the Content-Type header. Exception: structured text
formats (CSV, JSON, NDJSON) have no magic bytes and infer returns
unknown for them. For these types only, MIME detection falls back to
filename extension (.csv → text/csv, .json → application/json) when
infer returns unknown. Content-Type header is still never trusted.
This is a documented limitation: a CSV renamed to .pdf is detected as
application/pdf and routed to the PDF path, not the structured path.

### D35 - PDF routing: lopdf text extraction `ACTIVE`

**Decision:** PDFs are routed by attempting text extraction with lopdf.
If lopdf returns non-empty text (after stripping whitespace): the file
is a digital PDF and text is used directly. If lopdf returns empty or
errors: the file is treated as scanned and routed to the docs-lane OCR
path.

This heuristic has known failure modes: some PDFs have embedded text
that is garbage (e.g. scanned PDFs run through bad OCR). The review
queue is the safety net — all extracted text requires human confirmation
before entities are created (D17 gate, FR-2.7).

lopdf is added to `server/Cargo.toml`. It makes no network calls
(verified: lopdf is a pure Rust PDF parser with no network features).
Add to `STACK.md` server section.

### D36 - Structured file ingest path `ACTIVE`

**Decision:** CSV, JSON, XLSX, XLS files (detected by magic bytes) take
a structured parse path. In the current implementation this path sets
`status='needs_review'` and creates one `review_item` with
`kind='structured_import'` requiring human confirmation of the schema
mapping. It does not set `status='committed'` directly — doing so would
bypass provenance tracking (D19) and ledger anchoring (D5).

Full structured parsing (typed ETL into `cdr_records`,
`financial_txns` etc.) is a follow-up that requires the schema mapping
UI from `DATABASES_MODULE.md`. The current path is honest: the file is
ingested, hashed, anchored, and queued for human review.

**Amendment (upload implementation session):** `review_items` has no
`kind` column, and this session's migration budget covers only the
saga-role migration, so the marker reuses existing columns rather than
adding one: `field_name='structured_import'`,
`script='Zyyy'` (the ISO 15924 code for undetermined script — a
structured file has no handwritten script), `crop_path` set to the
file's blob `storage_path` (a structured file has no pixel crop; the
path keeps the NOT NULL column pointed at where the bytes live),
`recognised_text` NULL, `status='pending'`. The human confirms the
schema mapping before anything is extracted.

### D37 - Administrator read access to case content `ACTIVE, amends D21`

**Context:** D21 introduced four roles with distinct capability sets,
including an administrator deliberately excluded from case content — PRD.md
§2 stated the rationale directly: "someone has to manage the system without
being able to read the intelligence in it." The named harm was a system/IT
administrator browsing sensitive investigation data on people who could be
detained, without ever being formally assigned to that investigation. The
operator running this pilot decided, after that rationale was made explicit,
to retire the read exclusion: a single-operator deployment makes the
separation-of-duties boundary between "manages the system" and "reads the
intelligence" pure friction rather than a meaningful control, and administrator
oversight of every case is more useful here than the isolation was.

**Decision:** the administrator role gains unrestricted, unconditional read
access to case content across every case — no assignment required, in every
environment, not a dev-only flag. This covers case listing/detail, entities,
files, graph (ego/macro/evidence), search, movement timeline/routine, the
review queue, re-id candidates, and the audit log. It does **not** extend to
any write, confirm, reject, annotate or ingest action: document upload,
merge propose/decide/revert, entity notes, review decisions,
preview-extraction, target creation and candidate decisions all remain
gated exactly as before (`authenticate_io`, investigating-officer only).
Case creation and case assignment remain administrator-only, unaffected in
either direction.

Implementation consolidates the nine near-identical "role gate, then
`assignments.is_assigned`" checks that existed across `cases.rs`,
`entities.rs`, `files.rs`, `review.rs`, `search.rs`, `map.rs`, `timeline.rs`,
`reid.rs` and `graph/mod.rs` into one shared
`audit::authenticate_case_reader`, which skips the assignment check only for
`AppRole::Admin`. `cases.rs::read_case` and `search.rs::global_search` keep
bespoke logic instead of adopting the shared helper, because both have an
existence-check-before-assignment-check ordering (`read_case`) or a
conditional assignment check (`global_search`) that a blind swap would have
broken.

**Consequences:** the Postgres RLS layer (`has_case_access()` and every
`case_scoped`/`via_*` policy in `supabase/migrations/
20260910000000_baseline.sql`) is deliberately left unchanged — those
policies are `FOR ALL`, not `FOR SELECT`, so adding an admin bypass there
would grant Postgres-level *write* access too, which this decision does not
intend. That RLS layer also isn't in the live read path yet for anything
except `cases`/`source_files` (dual-written through the privileged
`raven_saga` role, not per-user RLS). `eval/test_rls.py`'s
`test_admin_reads_no_case_content` therefore keeps passing and is now an
intentionally-tracked gap, not a contradiction — revisit together with
whichever milestone gives case content real per-user Postgres persistence.
The client sidebar (`client/src/lib/roles.ts`) exposes every read-only
screen to the administrator except Ingestion (a write path); no case-content
screen needed a new write-action role guard — every existing write button
was already gated to the investigating-officer role specifically, not to
"anyone who can reach this screen."
