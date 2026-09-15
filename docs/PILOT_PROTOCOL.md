# Campus Pilot Protocol (M6)

This protocol turns "we ran it" into evidence. Follow it exactly, write
down every deviation at the time it happens, and file the deviations
with the results — a documented deviation is data, an undocumented one
is doubt.

M6 completes when participant consent documentation is obtained and
signed before collection begins, Corpus B is collected, and S7 is
reported over a multi-day run (`EVALUATION.md` §3). This document is the
procedure for getting there.

---

## 1. Pilot objectives

What the campus pilot is designed to validate:

- **Multi-camera tracking pipeline under real optics and lighting (S1b
  quality floor measurement).** Public S1b data is blocked (PETS2009
  unreachable, WILDTRACK and MOT17 dropped — `RESULTS.md`
  S1b/PETS2009/full-split/STATUS). The pilot's own footage, with known
  routes and real-time ground truth, is the replacement source for the
  IDF1-vs-detection-FPS curve that sets D14's quality floor.
- **Document ingestion with handwritten forms (S3).** 30+ forms from 5+
  writers on the real FIR layout, scanned at 300 DPI with immediate
  transcriptions, giving the first per-script CER on in-domain pages
  and the first validation of the segmentation layer no public
  word-level corpus trains (`ARCHITECTURE.md` §4.1, step 2).
- **End-to-end case workflow from ingestion to graph to candidate
  review.** At least 5 forms through the full ingest saga to committed
  entities, at least one target locked on across cameras with at least
  one human-confirmed sighting, and ledger anchors verifiable for every
  action.

What it is NOT designed to validate:

- **Accuracy against real criminal case data.** The corpus is
  fictional: invented FIR stories, consenting colleagues walking
  routes, no real names, addresses, incidents, or agency records
  anywhere (D19 Corpus B). Numbers from the pilot describe the system
  under pilot conditions, not its performance on real casework, and
  must never be presented otherwise.
- **Production-scale performance.** Pilot scale is 4 cameras and a
  handful of participants over sessions of tens of minutes. It says
  nothing about months of continuous operation, dozens of cameras, or
  server sizing for an agency — those are later measurements with
  their own rows.

---

## 2. Setup checklist

Before the pilot session. Every item is checked off by name; an
unchecked item blocks collection, not just the session.

- [ ] All services healthy: `GET /health` all green (postgres, neo4j,
  ledger), basemap `GET /maharashtra` 200, glyph range 200, engine
  node `ready` in `GET /nodes` with a sane `budget_dps`.
- [ ] Engine node enrolment wired (BLOCKING): `POST /v1/nodes` requires a
  verified admin JWT since the node-registration auth fix, so
  `register_with_server` answers 401 and the node reports
  `registered: false` until admin credentials are provided to the engine.
  Confirm `registered: true` in the engine startup log and the node
  `ready` in `GET /nodes`. A tracking session cannot start until the
  node is registered — this item blocks collection, not just the session.
- [ ] At least one case created and assigned (the pilot case; team
  roles assigned per D21 — io, analyst, auditor — with the admin
  excluded from case content).
- [ ] Camera feeds registered with correct `declared_start_ts`
  (verified against the actual recording start or the live clock;
  displayed on every feed).
- [ ] Camera topology edges defined for every adjacent pair the routes
  use, with measured `mean_travel_s`/`stddev_s` (walk the route with a
  stopwatch; do not guess).
- [ ] Test document ingestion with one PDF before the main session:
  upload, watch `ingest.progress` on the socket (or the 30s poll
  fallback), confirm it reaches the review queue with its crop beside
  the transcription.
- [ ] Consent forms signed by all participants (both variants as
  applicable, filed by session reference number). No signature, no
  recording, no form — no exceptions.
- [ ] Ground truth log prepared: a blank table in the format of §3
  (paper printout plus a plain-text file), with a synced clock
  available to the operator (phone clock is fine; note which clock).

---

## 3. Data collection procedure

### Camera footage

- **Minimum 4 cameras** with overlapping fields of view, placed or
  selected per D26 (existing campus cameras or four placed cameras).
  Record the placement (sketch + camera codes `cam_01`…`cam_04`) with
  the session file.
- **At least 3 participants** walking known routes. Assign participant
  codes (P01, P02, …) at sign-in; the ground truth log uses codes,
  never names.
- **Each participant walks each route at least 3 times,** at normal
  walking pace, in varied lighting if the session allows (midday and
  late afternoon beats three identical noon walks).
- **Operator logs ground truth in real time:** participant code,
  timestamp, camera code, approximate location. Format (pipe-separated
  plain text, one sighting per line, UTF-8):

```text
# ground_truth_log — session <REF> — clock: <operator phone, HH:MM:SS>
# person | timestamp (ISO 8601, local + offset) | camera | location
P01 | 2026-10-04T09:12:44+05:30 | cam_01 | north gate walkway, heading east
P02 | 2026-10-04T09:13:02+05:30 | cam_01 | north gate walkway, heading east
P01 | 2026-10-04T09:14:10+05:30 | cam_02 | library corner, entering frame left
```

The header lines (session reference, which clock) are mandatory, not
decoration: without them the log cannot be joined to the case clock.
Corrections go on new lines (`CORRECTION <line-no> <fixed text>`);
never edit a written line.

- **Minimum 30 minutes of footage per session.** Shorter sessions do
  not produce enough handoffs to measure anything.
- **After collection:** for every recorded file, set
  `declared_start_ts` to the actual recording start time before
  ingestion. A file ingested with a guessed start time corrupts every
  cross-camera inference downstream (D16) — this step is where that
  corruption is prevented.

### Handwritten forms

- Use the Maharashtra Police FIR format (Form 154 CrPC) templates
  registered under `docs-lane/templates/` (D18 field maps). If the
  template used differs from the registered map, note the difference
  with the session file — unrecognised layouts fall back to
  unconstrained recognition rather than failing, but the fallback must
  be recorded.
- **All content is fictional** — no real names, addresses, or
  incidents. Work from the prompt sheet; the collector spot-checks
  each form at hand-in and excludes anything suspicious for
  destruction.
- **Minimum 30 forms, minimum 5 different writers.** Label each form
  with its writer code (W01, W02, …) at hand-in, matching the consent
  form's writer code.
- **Scan at 300 DPI, save as PDF,** one file per form, filename
  `<session-ref>_<writer-code>_<nn>.pdf`.
- **Transcribe each form immediately after scanning** (typed
  plain-text file next to the PDF, same basename, `.txt`). The
  transcription is the ground truth for S3 CER measurement — a form
  without a same-day transcription is a form that cannot be measured,
  because the writer's memory of ambiguous words decays within hours.

---

## 4. Measurement runs during the pilot

All numbers go through `eval/run_all.py` and land as new append-only
rows in `RESULTS.md` (D24) with date, commit, dataset (`collected`
provenance — the harness refuses `synthetic`, D19), split, metric, and
value. Hand-entered numbers are not results.

### S1b (quality floor)

1. Run the collected camera footage through the system at native FPS.
2. Re-run at throttled detection rates (the scheduler's uniform
   degradation is the throttle; record per-feed effective FPS for each
   run from the video-wall readout).
3. Compute tracklet fragmentation and IDF1 against the §3 ground truth
   log at each rate.
4. Record the IDF1-vs-FPS rows in `RESULTS.md`; the FPS at which IDF1
   drops materially becomes the D14 quality floor proposal. Update D14
   in the same change (marking the placeholder superseded, not
   deleting it).
5. Honesty constraint: the pilot cameras' native FPS caps the top of
   the throttling curve (same caveat PETS2009's 7 FPS carried in D14),
   so the measured floor is conservative by construction — state the
   native FPS alongside the floor.

### S3 (HTR accuracy)

1. Ingest all scanned forms. Every field routes to the review queue
   (the gate is unmeasured, so `gate.py` refuses auto-extract — this
   is the system working as designed, FR-2.6/FR-2.7).
2. Reviewers correct in the queue with crops beside transcriptions;
   corrections are stored and attributed.
3. Compute CER (and WER) per script against the same-day
   transcriptions, plus field-level exact-match on constrained form
   fields, plus percentage of fields routed to review.
4. Record per-script CER rows in `RESULTS.md`; update the per-script
   gate status (which scripts clear auto-extract, which stay in
   assisted transcription) in the same change.
5. Ablation if time allows: with and without D18 form-template field
   constraints, to test whether the template work earned its keep
   (`EVALUATION.md` S3).

### End-to-end workflow

During the session, demonstrably:

- [ ] Ingest at least 5 forms through the full pipeline to committed
  entities with evidence spans.
- [ ] Lock on to at least one target across cameras (signed, anchored
  lock-on per D9).
- [ ] Confirm at least one cross-camera candidate (proposal → human
  confirm → case record/graph/map entry; rejection of at least one
  wrong candidate also recorded).
- [ ] Verify ledger anchors for all actions (`GET /files/{id}/verify`
  → `verified` on ingested files; candidate decisions show their
  action receipts).
- [ ] Run `GET /health` at end of session: all green, recorded with
  the session file.

---

## 5. Error reporting

During the pilot, log every error. "Error" means anything the system
showed that was wrong, confusing, or unexpected — crashes, wrong
numbers, misleading labels, buttons that did nothing, feeds that
froze, review items that vanished. If a participant noticed it, it
counts even if the team considers it trivial.

One plain-text file: `pilot_errors.txt`, kept open during the session.
One entry per error, in this format:

```text
[2026-10-04T09:31:10+05:30] screen: video wall / action: lock-on P01 on cam_02 /
  showed: spinner for 40s then "NODE_UNAVAILABLE" /
  expected: lock-on confirmation with embedding receipt /
  screenshot: errors/img_0041.png (if taken) /
  recovered: yes — retried after 1 min, succeeded / operator: <initials>
```

Fields: timestamp, which screen, what action, what the system showed,
what was expected, screenshot path if taken, whether it was recovered
from and how, operator initials. Screenshots go in `errors/` next to
the file. This file becomes the bug backlog after the pilot — file
each entry as an issue in the repo (§7). An error nobody wrote down
did not happen as far as the backlog is concerned.

---

## 6. Success criteria

The pilot is successful when **all** of these hold:

1. At least one target is tracked across at least 2 cameras with a
   human-confirmed sighting (candidate proposed with score/threshold/
   crops → confirmed by an io-role user → visible in the case record).
2. At least 5 forms are ingested and appear in the review queue with
   crops beside transcriptions.
3. `RESULTS.md` has at least one new S1b row and one new S3 row with
   real measurements from this pilot's data (harness-produced rows,
   not hand-entered).
4. No data loss: every ingested file verifies against the ledger
   (`GET /files/{id}/verify` → `verified` for each).
5. `GET /health` shows all services green at end of session
   (recorded output filed with the session).

**The pilot is not failed by poor S1b or S3 numbers. A measured bad
number is better than no number.** An IDF1 of 0.3 with ground truth
and method attached advances the project; a missing row does not. What
fails the pilot is missing evidence: unsigned consent, unlogged ground
truth, unverifiable files, or an empty `pilot_errors.txt` that nobody
believes.

---

## 7. After the pilot

In order, before anyone calls M6 done:

1. **Commit all new `RESULTS.md` rows.** Verify each row carries date,
   commit, dataset, split, metric, value (D24). A row without its
   provenance (`collected` for pilot data) is not a row.
2. **File `pilot_errors.txt` as issues in the repo,** one issue per
   entry, with screenshots attached. The text file itself is committed
   alongside the session ground truth log.
3. **Run `eval/test_rls.py` against the pilot database before wiping
   it.** Note: the task list for this step names `engine/test_rls.py`
   alongside it, but no such file exists in the tree as of this
   writing — the RLS suite is `eval/test_rls.py` (81 tests, M0-T4).
   Run what exists; do not invent the other. Record the pass/fail with
   the session file. A red RLS suite against pilot data is a breach
   investigation, not a cleanup step.
4. **Export a `pg_dump` of the pilot database as a named artifact**
   (see `DEPLOYMENT.md` backup section for the command and the
   blobs-plus-ledger pairing note). Name it
   `raven-pilot-<yyyymmdd>-<session-ref>.dump`.
5. **Delete participant footage per consent form terms** unless
   participants agreed to extended retention: video files, unconfirmed
   embeddings, scans and transcriptions for withdrawn or
   non-extended participants, plus paper forms shredded. Confirm each
   deletion in writing to the participant where contact exists. Ledger
   anchors remain as uninterpretable hashes (see `DPIA.md` §5 for why
   and what participants were told).
6. **Update D14 and D17 with measured values** from the S1b and S3
   rows: the quality-floor proposal goes to D14, per-script gate
   statuses to D17's companion record — each marking its placeholder
   superseded in the same change, with the `RESULTS.md` row cited, per
   the decision-log discipline. If a measurement failed to produce a
   value (too little data, harness fault), update the decisions to say
   so with the reason rather than leaving the old placeholder to rot.
