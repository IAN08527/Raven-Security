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
| D21 | Real identity, RLS and signed actions | ACTIVE | - |
| D22 | Multi-org Fabric | ACTIVE | - |
| D23 | Person-centric graph | ACTIVE | - |
| D24 | Metric-gated milestones | ACTIVE | - |
| D25 | General LEA framing | ACTIVE | - |
| D26 | Campus pilot before agency pilot | ACTIVE | - |
| D27 | Calibrated edge weights | ACTIVE | - |
| D28 | insight_reviews RLS tightening | ACTIVE | - |

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

### D21 - Real identity, real RLS, signed actions `ACTIVE`

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

**Decision:** run a controlled campus deployment first, with institutional ethics
approval and consenting participants, using either existing campus cameras or four
placed cameras. Collect the handwriting corpus the same way. Pursue the agency
conversation in parallel, starting with faculty and an institutional letter.

**Why:** the campus deployment is a genuine pilot that validates the full pipeline
under real optics, lighting and occlusion, and it produces the consent and ethics
process an agency will ask about anyway.

**Consequences:** ethics approval and consent forms become gating artifacts for
data collection. Corpus B cannot be collected before they exist.

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

### D30 - TypeScript type generation `ACTIVE, not yet implemented`

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
