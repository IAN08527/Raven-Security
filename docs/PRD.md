# Product Requirements Document

**Project:** Raven
**Version:** 2.0 (real build). Supersedes v1.0, the SIH prototype PRD.
**Origin:** SIH26189, MHA / NCRB. Retained as reference use case, not as scope
boundary (see D25 and Appendix A).
**Status:** requirements agreed, build not started.

---

## 1. What this is

Raven is a criminal network analysis platform for law enforcement. It ingests case
documents, communication records, financial records and camera footage, extracts
the entities and relationships inside them, and presents the resulting network with
every link traceable back to the evidence that produced it.

Two properties separate it from a general analytics tool:

1. **Every automatically produced claim is evidence-backed and reversible.** An
   edge in the graph points to the document, page and text span it came from. A
   cross-camera match points to the frames, the score and the reason it was
   proposed. A person confirms or rejects before anything enters the case record.
2. **Nothing leaves the premises.** Extraction, recognition and matching all run
   on local hardware. There are no third-party API calls at any point in the
   pipeline, including for map tiles.

### 1.1 What changed from v1.0

v1.0 described a prototype: simulated data sources, a single machine, one operator,
a demonstration lasting minutes. This version targets a system that can be
installed, used by multiple people over months, and evaluated against measured
error rates.

| Area | v1.0 | v2.0 |
|:---|:---|:---|
| Data | Six simulated government feeds, generated content | Real public datasets plus own collected data, provenance tracked (D19) |
| Cameras | Four clips, topology-gated inference | All feeds live, count scales with hardware (D14, D15) |
| Documents | Digital PDFs plus basic OCR | Handwritten multi-script recognition with review queue (D17, D18) |
| Deployment | One machine, one operator | Server, engine nodes, thin clients, real accounts (D20, D21) |
| Ledger | Single-node test-network | Multi-org with cross-org endorsement (D22) |
| Success | A working demonstration | Measured metrics in `RESULTS.md` (D24) |

---

## 2. Users and roles

Roles are enforced, not decorative. Each maps to a database role with row-level
security scoped per case (D21).

| Role | Does | Cannot |
|:---|:---|:---|
| Investigating Officer | Ingests documents, runs ego-graph queries, locks on to targets, confirms or rejects sightings, annotates | See cases they are not assigned to |
| Intelligence Analyst | Macro network views, cross-case pattern queries, routine analysis | Confirm sightings, modify case records |
| Forensic Auditor | Read-only across assigned cases, ledger verification, access-log review | Modify any record, including their own annotations |
| Administrator | User and case assignment, camera and node registration, form template management | Read case content |

The administrator exclusion is deliberate. Someone has to manage the system
without being able to read the intelligence in it.

---

## 3. Functional requirements

### FR-1 Ingestion

**FR-1.1 Source routing.** Files are routed by magic-byte sniffing, never by
extension. Structured formats (CSV, JSON, XLSX) take a typed parse path with no
model inference. PDFs with an embedded text layer extract directly. Scanned PDFs
and images take the document recognition path (FR-2). Unrecognised types are
rejected with a reason shown in the UI.

**FR-1.2 Content-addressed storage.** Every ingested file is stored under its
SHA-256, computed streaming in fixed-size chunks so a large record dump does not
balloon memory. Duplicate ingests of identical bytes deduplicate to one blob with
two case references.

**FR-1.3 Provenance.** Every row created by ingestion carries a provenance value
(`benchmark`, `collected`, `synthetic`) that propagates into entities, identifiers,
relationships and evidence rows (D19). The UI shows it. The evaluation harness
refuses to compute metrics over synthetic rows.

**FR-1.4 Ingest status is visible and recoverable.** Every ingest is a job with a
status. Failures land in a queue with the failure reason and a retry action. No
silent drops.

### FR-2 Document recognition, including handwriting

**FR-2.1 Page preparation.** Deskew, dewarp and binarise. Script-agnostic.

**FR-2.2 Layout and line segmentation.** Detect text regions and split into lines.
Script-agnostic. This is the layer no public word-level corpus trains, so it is
validated on collected forms (Corpus B).

**FR-2.3 Script identification per line.** Classify script per line, not per
document, because forms routinely mix English field labels with Indic content.

**FR-2.4 Multi-script recognition.** A single line recogniser with a shared Unicode
charset handles all supported scripts (D17). Model choice and training set are in
`ARCHITECTURE.md` and `EVALUATION.md`.

**FR-2.5 Form-template field constraints.** For registered form layouts, each
field applies a restricted charset and a format validator; free-text narrative is
unconstrained (D18). Unregistered layouts fall back to unconstrained recognition.

**FR-2.6 Per-script gating.** A script produces automatic entity extraction only
once its character error rate on held-out data clears the gate defined in
`EVALUATION.md`. Below the gate, the pipeline still segments, still recognises and
still pre-fills, but every field requires human confirmation before any entity is
created. The UI shows current per-script status.

**FR-2.7 Review queue.** Any field below the confidence threshold, and every field
from a non-gated script, appears in a review queue showing the cropped source image
beside the transcription. Corrections are stored and attributed. No entity derived
from an unreviewed low-confidence field ever enters the graph.

### FR-3 Entity extraction and resolution

**FR-3.1 Extraction.** One task per model call with a hard output schema. Entities
(person, organisation, location, vehicle), identifiers (phone, account, vehicle
registration, IMEI), and incident metadata, each with a character span into the
source text so provenance is exact.

**FR-3.2 Schema enforcement.** Constrained decoding plus schema validation plus one
bounded repair retry. A third failure quarantines the document for review (D11).

**FR-3.3 Entity resolution.** Candidates merge on, in order: exact biometric or
unique-identifier match; shared identifier plus normalised name match; normalised
name match plus a shared case. Every merge is recorded and reversible, because an
incorrect merge in a policing tool is a serious error an auditor must be able to
unwind.

**FR-3.4 Resolution is measured.** Pairwise precision and recall on an annotated
set, reported in `RESULTS.md`. Merges are not asserted to be correct.

### FR-4 Network analysis

**FR-4.1 Person-centric graph.** The default view is person-to-person. Other
entity types exist in the model and are expanded on demand from a selected person
or via explicit filters, never rendered by default (D23).

**FR-4.2 Local view.** A one-to-two hop ego-graph centred on a selected person,
with a weight floor and a result limit.

**FR-4.3 Global view.** The full person network for the current case scope, for
identifying bridges between separately investigated groups.

**FR-4.4 Evidence on every edge.** Selecting an edge opens the underlying evidence
without re-querying or re-laying-out the graph. The panel lists each contributing
piece of evidence with its type, date, source document and provenance.

**FR-4.5 Calibrated edge weights.** Connection strength is a configurable weighted
sum over evidence types with a time-decay term. The weighting is validated against
covert-network datasets with published ground truth rather than asserted (D27).

**FR-4.6 Tamper state propagates.** If a source document fails ledger verification,
every entity and edge derived from it is visually marked and excluded from
analysis until resolved.

### FR-5 Camera analysis

**FR-5.1 All feeds visible.** Every registered camera renders continuously in the
UI. Display is independent of inference.

**FR-5.2 Continuous detection on all feeds.** Person detection runs on all cameras,
batched, within the compute budget derived at startup (D14). Per-feed effective
FPS is displayed. A warning state appears when FPS falls below the quality floor.

**FR-5.3 Mixed live and recorded sources.** Sources register with mode, declared
start time and frame rate; all downstream timestamps use the case clock (D16).
Historic footage replays through the identical pipeline.

**FR-5.4 Human lock-on.** The detector assigns local track ids. An officer selects
the target. Only then is an appearance embedding generated, and that action is
signed and anchored (D9).

**FR-5.5 Cross-camera candidate matching.** Matching runs on all cameras.
The camera topology graph modulates the match threshold rather than gating
execution: a candidate inside the predicted arrival window from a confirmed
sighting clears at a lower similarity than one at an implausible place and time
(D15). Matching is per-tracklet, not per-frame.

**FR-5.6 Every candidate is explained.** A proposed sighting shows the similarity
score, the topology expectation that informed the threshold, the source and
candidate crops, and the time gap.

**FR-5.7 Confirmation required.** Candidates are proposals. Nothing enters the case
record, the map or the graph until a person confirms it. Rejections are recorded
too, because they are training signal and audit evidence.

**FR-5.8 Loss is stated, not hidden.** When no candidate clears in the expected
window, the UI says the target was lost at a named camera and offers to widen the
search, rather than silently continuing.

### FR-6 Movement and geospatial

**FR-6.1 Aggregated location timeline.** Location points from communication
records, case locations, registered addresses and confirmed camera sightings,
merged onto one timeline per person.

**FR-6.2 Local basemap.** MapLibre over a locally hosted PMTiles extract. No
third-party tile requests (D6).

**FR-6.3 Routine identification.** Frequent locations and recurring temporal
patterns, with the confidence and the supporting point count shown. A pattern
derived from four data points is labelled as such.

*(This module existed in v1.0 requirements but was absent from the prototype UI.
It is in scope here.)*

### FR-7 Integrity and audit

**FR-7.1 Anchoring.** File hash anchored at ingest; extraction result hash anchored
after the database commit succeeds (D5).

**FR-7.2 Verification.** Opening a document recomputes its hash from stored bytes
and compares against the ledger. Mismatch produces a visible tamper state with both
hashes shown.

**FR-7.3 Multi-org endorsement.** Ledger writes require endorsement from more than
one organisation, so altering a record requires cross-agency collusion (D22).

**FR-7.4 Attributable actions.** Confirmations, rejections, merges, annotations and
evidence access are signed with the authenticated user's ledger identity (D21).

**FR-7.5 Auditor view.** A forensic auditor can review the full access and action
history for their assigned cases and verify any document independently.

### FR-8 Administration and operations

**FR-8.1 Node and camera registration**, including topology edges with travel-time
statistics.
**FR-8.2 Form template management** for FR-2.5.
**FR-8.3 Health board** covering server, every engine node, both databases, the
ledger and model availability, with per-dependency status.
**FR-8.4 Backup and restore** for the database, blob store and ledger state.
**FR-8.5 Versioned migrations.** No manual schema changes.

---

## 4. Non-functional requirements

Targets marked *(measured)* are placeholders until the corresponding experiment in
`EVALUATION.md` reports a number. They will be replaced with measured values, not
adjusted to match aspirations.

| ID | Requirement | Target |
|:---|:---|:---|
| NFR-1 | Camera throughput, reference hardware (RTX 4050 6GB) | 16 cameras sustained at 10 FPS, real RTSP decode + TensorRT FP16 detection, peak VRAM 143.4MB of the 6GB budget (S1a, M1-T8, 2026-09-11)¹ |
| NFR-2 | Detection quality floor | *(measured, S1b)* -- not yet measured: S1b (PETS2009) was attempted 2026-09-11 and blocked -- the University of Reading's direct download server is unreachable (`RESULTS.md`, S1b/PETS2009/full-split/STATUS). Re-attempt with a working PETS2009 source, or supersede at M6 with collected campus footage. |
| NFR-3 | Ego-graph query, 2 hops | p95 under 250 ms at 100k person nodes |
| NFR-4 | Document ingest, digital PDF | p95 under 10 s end to end |
| NFR-5 | Document ingest, scanned multi-page | p95 under 90 s per page *(measured, S3)* |
| NFR-6 | Third-party network egress | Zero, verified by network policy test in CI |
| NFR-7 | Ledger verification correctness | 100% detection of single-byte modification |
| NFR-8 | RLS correctness | Zero cross-case leakage in the access-control test suite |
| NFR-9 | Recovery | Any single service restart loses no committed data |

¹ Still conservative, not necessarily the pipeline's real ceiling: `docs/RESULTS.md`'s
S1a-throughput `live_rtsp_N16` rows are the highest camera count this run
provisioned (16 looped RTSP sources via mediamtx over TCP transport), and it
sustained cleanly with peak VRAM at only 143.4MB of the 6GB budget -- nowhere
near exhausted. No level failed to sustain, so the true ceiling was not
found; it is at least 16. An earlier attempt in the same session using UDP
RTSP transport and per-stream software re-encoding produced spuriously low
numbers (1-2 cameras) purely from test-harness artifacts (loopback UDP
packet loss and CPU encoder contention across many concurrent publishers),
not a real pipeline constraint -- see the superseded `S1-throughput` rows in
`RESULTS.md` for that data, kept per the append-only rule but not the
operative figure. Re-measuring past 16 needs more provisioned RTSP sources.

---

## 5. Explicitly out of scope

- Automatic identity assertion without human confirmation. This is a permanent
  exclusion, not a roadmap item.
- Facial recognition. Appearance-based Re-ID within a session is in scope;
  biometric face matching against an identity database is not.
- Predictive policing in the sense of forecasting who will offend. Movement routine
  analysis over confirmed historical data is in scope; risk scoring of individuals
  is not.
- Live integration with CCTNS, ICJS, CFCFRMS or telecom systems. Requires
  agreements that do not exist. The ingestion layer is designed so these become
  additional source adapters when they do.
- Cloud or multi-site deployment.
- Model fine-tuning beyond the multi-script recogniser.

---

## 6. Open questions

| # | Question | Blocks | Owner |
|:---|:---|:---|:---|
| Q1 | Which Indic scripts are in the initial training mix | S3 scope, corpus download | Team |
| Q2 | Participant consent process for footage and form collection | Resolved — formal institutional approval not required for self-collected data among consenting participants per D26. Signed consent records maintained. Confirm host institution policy with faculty contact before collection. | Resolved |
| Q3 | Server hardware for the eventual pilot | NFR-1 at deployment scale | Deferred until a pilot exists |
| Q4 | Which agency organisations the Fabric orgs represent | D22 MSP design | Deferred, does not block build |
| Q5 | Retention policy for tracklet embeddings | D7 index growth | Before continuous operation |

---

## Appendix A - SIH26189 traceability

Retained so the origin requirements remain checkable.

| SIH requirement | Covered by |
|:---|:---|
| Extract entities from unstructured text | FR-3.1, FR-3.2 |
| Model syndicate structure via graph analytics | FR-4.1 to FR-4.5 |
| Track suspect movement with spatial constraints | FR-5.5, FR-6.1, FR-6.3 |
| Present supporting evidence for every detected relationship | FR-4.4 |
| Keep a human analyst in the decision loop | FR-2.7, FR-5.4, FR-5.7 |
| Anchor evidence for auditability | FR-7.1 to FR-7.5 |
| Handle fragmented sources across disconnected systems | FR-1.1, FR-3.3 |
