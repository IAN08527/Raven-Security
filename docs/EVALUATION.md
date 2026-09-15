# Evaluation Plan and Dataset Register

The difference between the prototype and the real system is this document. The
prototype had a demo script. The real system has held-out sets, metrics, and a
harness that fails when a number regresses.

Two rules govern everything here:

1. **Metrics are computed only over `benchmark` and `collected` rows.** The harness
   filters on the provenance column and refuses synthetic data (D19). This is
   enforced in code.
2. **Results are appended, never edited.** `RESULTS.md` is append-only. Every entry
   carries a date, commit, dataset, split and number. A number that moved is a new
   row, not a correction.

---

## 1. Dataset register

### 1.1 Corpus A, public benchmarks

Every published metric comes from here. None of it is Indian police data and it is
never described as such.

Licence and status were checked against each dataset's actual current source page
on 2026-09-11 (CLAUDE.md rule 10: never guessed). `DROPPED` means no clear licence
is locatable today and the dataset is not used, per S0's decision rule, not merely
deferred. Full detail, including why each `DROPPED` page failed and how each `STUB`
is gated, lives in `tools/fetch_datasets.py`'s `DATASETS` table, which this row set
mirrors. Datasets not yet run through this audit are marked accordingly rather than
guessed at.

| Purpose | Dataset | Licence | Status | Notes |
|:---|:---|:---|:---|:---|
| Covert network structure and role labels (S5) | KONECT — Koblenz Network Collection | varies per dataset, pending audit | NOT AUDITED | Terms stated per dataset, not site-wide — verify each network's page before use. Target networks: Noordin Top (role labels for centrality validation) and any additional covert/dark networks with role annotations. Licence status: pending per-dataset audit (S0 follow-up). |
| Larger weighted network | Stockholm street gang surveillance network | not yet audited | NOT AUDITED | 234 gang-member nodes, weighted edges, published on Figshare. Not in the M0-T7 pass; do not use until checked. |
| Financial edges | Elliptic Bitcoin transaction graph | CC BY-NC-ND 4.0 | STUB (licence check required) | Licit/illicit labels. Confirmed via Kaggle: non-commercial use only, no derivative redistribution. Licence is clear but restrictive, so `tools/fetch_datasets.py` gates it on a manual human check rather than auto-downloading. |
| Financial edges, alternate | IEEE-CIS Fraud Detection | not yet audited | NOT AUDITED | Kaggle. Tabular rather than graph-native; used for the transaction ingestion path. Not in the M0-T7 pass; do not use until checked. |
| Communication graph | Enron email corpus | not yet audited | NOT AUDITED | Real communication network, stands in for CDR structure. Not in the M0-T7 pass; do not use until checked. |
| Mobility and call logs | MIT Reality Mining | not yet audited | NOT AUDITED | Real call logs with location traces. Registration required. Not in the M0-T7 pass; do not use until checked. |
| Geospatial incidents | police.uk street-level crime | Open Government Licence v3.0 | OK | Incident-level with coordinates, which NCRB's public release does not provide. Confirmed at data.police.uk/about/: permissive, attribution required, commercial use and redistribution allowed, no registration. `tools/fetch_datasets.py` downloads the archive index. |
| Geospatial incidents, alternate | Chicago open crime portal | not yet audited | NOT AUDITED | Not in the M0-T7 pass; do not use until checked. |
| Person Re-ID | Market-1501 | unverifiable: official host is dead | DROPPED | Standard Re-ID training and evaluation. Original homepage (liangzheng.org) is now a parked domain; the Kaggle mirror and Academic Torrents both list no licence field. |
| Person Re-ID, alternate | MSMT17 | unverifiable: official host is dead | DROPPED | Official host (pkuvmc.com) returned 404. Secondary sources reference "complying with all licenses of MSMT17" without quoting actual terms. |
| Multi-object tracking, throughput/quality floor | MOT17 | no licence or terms visible | DROPPED | motchallenge.net returned 410 Gone site-wide at time of audit, no licence or terms visible, same failure mode as WILDTRACK — cannot use without clear terms |
| Multi-camera tracking | WILDTRACK | no licence stated | DROPPED | 7 synchronised outdoor cameras, over 40,000 boxes, 300+ identities. Rechecked 2026-09-11 (M1-T8): the page is back online at epfl.ch/labs/cvlab/data/data-wildtrack/ (was 404 during the M0-T7 audit) but states no licence or terms of use anywhere -- download links only. S0's decision rule still drops it, for a different reason than before. |
| S1b quality floor + S2 cross-camera development | PETS2009 | copyright University of Reading, free for academic/industrial research per secondary sources (unverified against live page) | STUB (server unreachable) | Held out for S2 per the existing plan; also now the S1b IDF1-vs-FPS data source since MOT17 dropped. Rechecked 2026-09-11 (M1-T8, Part 3): the University of Reading's direct download server (ftp.cs.rdg.ac.uk / sida.rdg.ac.uk, 134.225.220.39) timed out on port 80 and refused on port 443, while reading.ac.uk and its CentAUR repository are both reachable -- a dead host, not a general network failure. CentAUR and an OpenTraj mirror quote "copyright University of Reading, permission granted for free download for academic and industrial research", but CLAUDE.md rule 10 requires checking the actual current source page, and that page is unreachable, so this licence text is not independently confirmed. Not used (`RESULTS.md`, S1b/PETS2009/full-split/STATUS/BLOCKED). Re-check when the server is back up. |
| Multi-camera tracking, alternate | MMPTrack | research use only, signed Terms & Conditions required | STUB (registration required) | 9.6 hours across five environments at 15 FPS with camera calibration included. Requires downloading and emailing a signed T&C form to iccv2021mmp@outlook.com before a link is issued. |
| Handwriting, Indic | IIIT-INDIC-HW-WORDS (with IIIT-HW-DEV, IIIT-HW-TELUGU) | unverifiable: gated behind download | DROPPED | 872K handwritten instances, 135 writers, covering 10 Indic scripts. Word-level crops. CVIT page states terms are "in the README file" inside the downloadable zip -- not independently verifiable without downloading first. |
| Handwriting, English | IAM Handwriting Database | free for non-commercial research use only, registration required | STUB (registration required) | Full pages, so it also exercises segmentation. Confirmed at fki.tic.heia-fr.ch: "freely available for non-commercial research purposes"; account required at fki.inf.unibe.ch. |

**Do not use DukeMTMC.** It was withdrawn by Duke over consent problems. Using
withdrawn surveillance data in a policing tool is indefensible regardless of how
convenient the benchmark is.

**Licence audit is a gating task (S0).** Some of these permit research use only,
some require registration, some cannot be redistributed. Every entry needs a
recorded licence, a recorded access route, and a note on whether it can ship with
the repository or must be downloaded by the user.

### 1.2 Corpus B, collected

Real signal, invented content, collected with participant consent documentation
(D26) — a signed consent record from each person appearing in collected footage.
This is the in-domain evaluation set and the only data that matches deployment
conditions.

| Item | Target | Purpose |
|:---|:---|:---|
| Filled FIR forms | 150+ pages, 30+ writers, 200 and 300 DPI scans, multiple scripts | Page segmentation validation, in-domain CER, form-template validation |
| Multi-camera footage | 4 cameras, known routes, 20+ participants, varied lighting | Cross-camera Re-ID under real optics, occlusion and lighting |
| Transcriptions and route ground truth | Full | Makes both of the above evaluable |

Two days of collection produces something no public dataset can: in-domain
handwriting on the actual form layouts, and multi-camera handoff with ground truth
you control. Signed participant consent records are prerequisites
for data collection. See D26.

### 1.3 Corpus C, synthetic

Joins and case scaffolding only. Entity ids, case structure, assignments, the
connective tissue that lets a Montreal network and a scanned Marathi form live in
one coherent case. Never raw signal: no generated handwriting, no generated video,
no generated network topology. Excluded from every metric.

---

## 2. Experiments

Each has a question, a dataset, a metric and a decision rule. A milestone completes
when its experiment reports a number, not when its code is written.

### S0 - Licence and access audit

**Question:** which of the Corpus A datasets can we actually use and ship?
**Output:** a table with licence, access route, redistribution status, and a
download script for everything that cannot ship.
**Decision rule:** anything without a clear licence is dropped, not used and
explained later.
**Blocks:** everything downstream.

### S1 - Camera throughput and quality floor

**Question:** how many cameras at what FPS on the reference machine, and below what
FPS does tracklet quality degrade?

MOT17 is dropped (§1.1: motchallenge.net returned 410 Gone site-wide, no licence
or terms visible). This experiment now splits into two sub-experiments run against
different data, since no single dropped-in replacement covers both throughput and
quality.

**S1a - Throughput and peak VRAM.** Any video source works; content is irrelevant
and no annotations are required. Run on the reference machine with a real GPU,
via RTSP sources for realistic decode cost.
**Metrics:** cameras sustained at 10 FPS; peak VRAM.
**Status:** reported (M1-T8, 2026-09-11). See `RESULTS.md` (S1a-throughput) and
NFR-1.

**S1b - IDF1 vs FPS quality floor.** Data: PETS2009, anonymous download,
permissive terms. Native framerate is 7 FPS, which caps the top of the throttling
curve -- the quality floor measured here is therefore conservative relative to
what a higher-framerate source would show.
**Metrics:** tracklet fragmentation and IDF1 as a function of detection FPS.
**Status:** blocked (M1-T8, 2026-09-11; re-checked 2026-09-13, still blocked).
PETS2009's direct download server (University of Reading) is unreachable --
see §1.1's PETS2009 row and `RESULTS.md`
(S1b/PETS2009/full-split/STATUS/BLOCKED). NFR-2 and D14's quality floor stay
unmeasured placeholders until the server is reachable again or M6 supersedes
this measurement with collected campus footage.

**Decision rule:** the FPS at which IDF1 drops materially becomes the quality floor
in D14. NFR-1 and NFR-2 are then replaced with these measurements.
**Note:** measure with RTSP decode included. Reading a local MP4 is meaningfully
cheaper and would flatter the result.

The quality floor from S1b will be re-measured on collected campus footage at M6
and a second RESULTS.md row appended. The M6 measurement supersedes S1b as the
operative number.

### S2 - Cross-camera Re-ID

**Question:** how well does the matching pipeline actually identify the same person
across cameras, and does the topology prior help?
**Data:** MSMT17 for the embedder; WILDTRACK or MMPTrack for cross-camera;
PETS2009 held out; collected campus footage as the in-domain set.
**Metrics:** rank-1 and mAP for the embedder; IDF1 and HOTA for cross-camera; and
critically, precision at the operating threshold, because a false match is the
harm this system can cause.
**Ablation:** with and without the topology prior, and with per-frame versus
per-tracklet matching. If the prior does not improve precision at fixed recall,
D15 is wrong and should be revisited.
**Decision rule:** the operating threshold is chosen for precision, not F1. Missing
a sighting costs an investigator time; a false one costs someone their liberty.

### S3 - Handwriting recognition

**Question:** what is the character error rate per script, and which scripts clear
the auto-extract gate?
**Data:** IIIT-INDIC-HW-WORDS and IAM for training; held-out splits of both, plus
collected forms as the in-domain set.
**Metrics:** CER and WER per script; field-level exact-match accuracy on
constrained form fields; percentage of fields routed to review.
**Decision rule:** the gate. A script is auto-extract only below its CER threshold
on the in-domain set, not the benchmark set, because benchmark word crops are
easier than a real scanned page. Everything else is assisted transcription
(FR-2.6). Publish the per-script status table.
**Ablation:** with and without form-template field constraints (D18), because that
determines whether the template work was worth it.

### S4 - Entity extraction and resolution

**Question:** how accurate is the extraction, and how often does entity resolution
merge two people who are not the same person?
**Data:** annotated subset of collected forms plus a hand-annotated slice of Enron.
**Metrics:** entity-level precision, recall and F1 by type; span accuracy; for
resolution, pairwise precision and recall plus B-cubed.
**Decision rule:** merge precision is the number that matters. An incorrect merge
fuses two people's records, and it must be measured and reported rather than
assumed correct because the rules look sensible.

**Status (measured 2026-09-14, `RESULTS.md` S4/enron-s4-20/s4-annotation-set):**
EntityExtractor via OllamaBackend `qwen2.5:1.5b` (warmup) over the reviewed
20-item Enron slice (430 gold mentions): micro precision/recall/F1 all 0.0000,
span exact-match accuracy 0.0000. 18 of 20 items quarantined after 3 repair
failures (predominantly self-loop relationships and out-of-range spans); the 2
extracted items produced 5 mentions, 0 exact hits. Precision below 0.7 on all
five measured types (PERSON, ORGANIZATION, LOCATION, PHONE, ACCOUNT) — flagged
per-row in `RESULTS.md`. Reading: the 1.5B model cannot emit exact character
spans on full raw emails (headers + body, up to 3000 chars); the D11
validate-and-quarantine path held (nothing ungrounded was persisted), but there
 is currently no working extractor for this data. Resolution metrics
 (pairwise/B-cubed) unmeasurable: no resolver implements FR-3.3 yet.

 **Status — S4-rerun (measured 2026-09-14, `RESULTS.md`
 S4-rerun/enron-s4-20/s4-annotation-set, D11-A surface-then-resolve):** the
 original 0.0000 rows above are transport+span failure (the 1.5B model asked
 to count characters across 3000-char raw emails emitted plausible small
 integers unrelated to actual positions; 18 of 20 items quarantined). The
 S4-rerun rows use D11-A: the model returns {type, value} surfaces only and
 `SpanResolver` grounds them via str.find() with occurrence-index
 disambiguation. Timeout rate 0.0500 (1 of 20 transport timeouts after all
 retries — below the 20% infra flag); extraction rate 0.7000 (14 of 20 got
 a model answer, vs 2 of 20 originally); span resolution 17/27 (0.6296).
 Micro precision 0.5294 / recall 0.0209 / F1 0.0403; PERSON precision
 0.8000 and ORGANIZATION 1.0000 (1/1) clear 0.7, while ACCOUNT, LOCATION
 and PHONE remain below 0.7 and are flagged per-row. Reading: D11-A fixed
 the span-arithmetic failure (extraction now answers), but the 1.5B model
 still under-predicts massively (17 resolved spans vs 430 gold) — recall,
 not spans, is now the binding constraint.

### S5 - Edge weight calibration

**Question:** does the connection-strength scheme carry real signal, or are the
constants decoration?
**Data:** KONECT networks carrying role annotations for centrality validation
(target: Noordin Top, pending the per-dataset licence audit above), plus a
KONECT temporal snapshot sequence for link prediction; additional KONECT
covert/dark networks held out.
**Metrics:** correlation between weighted centrality and known leadership roles;
link-prediction AUC using snapshot *t* weights to predict *t+1* edges in the
KONECT temporal sequence.
**Decision rule:** if the weighting performs no better than unweighted degree, the
scoring matrix is decoration and either gets replaced or gets described honestly as
a display heuristic (D27).

**Status:** link-prediction half BLOCKED 2026-09-14 (`RESULTS.md`
S5-dataset-audit/SNAP-CollegeMsg+email-Eu-core-temporal/licence-status/BLOCKED):
CollegeMsg (1899 nodes, 59835 temporal edges) and email-Eu-core-temporal (986
nodes, 332334 temporal edges) both lack any licence or terms-of-use statement
on their SNAP pages and the SNAP index, so neither was downloaded per S0's
 rule; email-EuAll is not temporal. Role-recovery half remains BLOCKED (Noordin
 Top is not on KONECT; Caviar and Ndrangheta lack terms — prior rows).

 **Status — link prediction MEASURED via Enron (2026-09-14, `RESULTS.md`
 S5-enron/enron-cmu-2015):** Enron CMU 2015-05-07 maildir (FERC public
 record, research distribution — terms verified 2026-09-13) used for the
 link-prediction half: `tools/build_enron_network.py` → 3,356,325 dated
 edges (2,519 malformed-header out-of-range edges excluded, stated in
 `eval/s5_link_prediction.py`), 3 equal-interval snapshots over
 1999-01-04..2002-07-12. Weighted (CALLED-base decay, half-life 180d) vs
 unweighted degree-product baseline: t0→t1 0.6120 vs 0.8043 (delta
 −0.1922); t1→t2 0.7552 vs 0.7957 (delta −0.0406). Weighted ≤ unweighted
 on both pairs → **D27 FLAGGED** (see DECISIONS.md D27-FINDING): the v1
 scoring matrix is decoration for this data. Role recovery still BLOCKED;
 D27 no longer stands unflagged.

### S6 - Integrity and access control

**Question:** does tamper detection actually work, and does RLS actually isolate?
**Data:** the system's own corpus.
**Metrics:** single-byte modification detection rate (target 100%); cross-case
access attempts blocked (target 100%); ledger write throughput under load.
**Decision rule:** anything below 100% on either correctness metric blocks release.
These are not tuning parameters.

### S7 - End-to-end system

**Question:** does it hold up in continuous operation?
**Metrics:** ingest latency p95 by document type; ego-graph query p95 by graph
size; sustained multi-day operation without memory growth or drift; recovery
behaviour on each single-service restart.
**Includes a network egress test in CI** that fails the build on any third-party
request, map tiles included (NFR-6).

---

## 3. Milestones

Metric-gated, not clock-gated (D24). Two-week cadence, one measurement run per
cycle. A fortnight with no new `RESULTS.md` row means something is stuck.

| M | Milestone | Completes when |
|:---|:---|:---|
| M0 | Foundations | S0 complete; harness runs; egress test in CI; `RESULTS.md` has its first row |
| M1 | Camera throughput | S1 reported; NFR-1 and NFR-2 replaced with measurements |
| M2 | Cross-camera Re-ID | S2 reported including the topology-prior ablation |
| M3 | Document recognition | S3 reported; per-script status table published |
| M4 | Extraction and graph | S4 and S5 reported |
| M5 | Identity and ledger | S6 at 100% on both correctness metrics |
| M6 | Campus pilot | Participant consent documentation obtained and signed before collection begins, Corpus B collected, S7 reported over a multi-day run |

M6 is where the project becomes defensible: a real deployment, real optics, real
handwriting, consent documented, numbers published.

---

## 4. Harness

```text
eval/
├── datasets/        # download and preparation scripts, one per dataset
├── splits/          # fixed, committed, never regenerated silently
├── metrics/         # cer.py reid.py graph.py extraction.py integrity.py
└── run_all.py       # emits a RESULTS.md row
```

Requirements:

- Splits are fixed and committed. A regenerated split invalidates every prior
  comparison.
- The harness reads provenance and refuses synthetic rows.
- One command produces a full table.
- CI runs the fast subset on every commit and fails on regression beyond a stated
  tolerance.
- Every row records date, commit, dataset, split, metric and value. Nothing else
  counts as a result.

---

## 5. What a good outcome looks like

Not a demonstration. A table like this, filled with real numbers, on a real
deployment:

| Claim | Evidence |
|:---|:---|
| Handles handwritten FIRs in N scripts | Per-script CER on 150 in-domain pages, with the gate stated |
| Tracks a suspect across cameras | IDF1 and precision at the operating threshold on PETS2009 and campus footage |
| Scales with hardware | Cameras at 10 FPS on 6GB, and on whatever the pilot machine is |
| Links are evidence-backed | Every edge traces to a document span; extraction precision reported |
| Connection strength means something | Role recovery and link prediction against covert-network ground truth |
| Evidence is tamper-evident | 100% single-byte detection, cross-org endorsement |
| Nothing leaves the premises | CI egress test, map tiles included |

Every row of that table is a number someone else could reproduce. That is the
entire point, and it is what a pilot conversation will actually turn on.
