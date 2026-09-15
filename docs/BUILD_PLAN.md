# Build Plan

Tasks sized for one working session each, with acceptance criteria you can check
rather than judge. A task is done when its criteria pass, not when the code looks
finished.

Order matters. M0 exists so that everything after it can be measured. It is dull
and it comes first anyway (D24).

**Working rule.** One task at a time. Read `CLAUDE.md`, then the documents that
task names. Check the criteria before starting the next one. If a task turns out to
need a decision that is not in `DECISIONS.md`, stop and raise it rather than
choosing.

---

## M0 — Foundations

Nothing here is a feature. Everything after it depends on it.

### M0-T1 Repository skeleton

Create the layout in `CLAUDE.md` §Layout. Workspace `Cargo.toml`, `pyproject.toml`
for both Python lanes, `package.json` for the client, `.gitignore`, `README.md`
pointing at `docs/`.

*Done when:* `cargo check --workspace`, `npm run build`, `ruff check .` and
`mypy engine docs-lane` all run and pass on empty scaffolding. CI runs all four.

### M0-T2 GPU stack verification

Run the procedure in `STACK.md` §6. Fill in the version table.

*Done when:* every command in §6 succeeds, the table is committed with real
versions and a date, and a single batched forward pass runs with measured VRAM
reported. **Blocks every CV task.** Do not start M1 without this.

### M0-T3 Database baseline

Move `supabase/migrations/20260910000000_baseline.sql` into place. `supabase start`,
`supabase db reset`.

*Done when:* reset applies cleanly from empty; all tables, enums, the two
`SECURITY DEFINER` functions, `recompute_weight` and the HNSW index exist; the
pgvector version is confirmed at 0.5 or later and recorded in `STACK.md`.

### M0-T4 RLS test suite

Two users, two cases, one assignment each. Tests attempt cross-case reads on every
policy-protected table.

*Done when:* every cross-case read returns zero rows, an admin user reads zero
case content, and a user with no assignment reads nothing. Runs in CI. **This
suite blocks release forever** (NFR-8), so it is written before there is anything
to protect rather than after.

*Note:* the `insight_reviews` policy in the baseline is permissive because
`object_id` is polymorphic. Tighten it in this task and record how.

### M0-T5 Egress test

A test that runs the full ingest and render path with outbound network access
blocked at the process level, asserting no third-party connection is attempted.
Include map tiles and fonts.

*Done when:* it passes, it is in CI, and it fails when a `fetch` to an external
host is deliberately added.

### M0-T6 Evaluation harness skeleton

`eval/run_all.py`, fixed splits committed under `eval/splits/`, one real metric
implemented end to end (CER is the easiest), and a `RESULTS.md` writer.

*Done when:* one command appends a row to `docs/RESULTS.md` carrying date, commit,
dataset, split, metric and value; the harness raises if asked to compute over
`provenance = 'synthetic'`; `--fast` runs in CI.

### M0-T7 Dataset licence audit (S0)

Work through `EVALUATION.md` §1.1. Record licence, access route and redistribution
status for each. Write download scripts under `tools/` for everything that cannot
ship.

*Done when:* every row has a licence and an access route, anything unclear is
dropped rather than deferred, and `tools/fetch_datasets.py` retrieves everything
permitted into `eval/datasets/`.

### M0-T8 Compose profiles and health gate

`all-in-one.yml` and the split profiles. Server startup blocks on a dependency
health check reporting each service pass or fail.

*Done when:* `docker compose -f infra/compose/all-in-one.yml up -d` brings up
Postgres, Neo4j and the mock ledger; `GET /health` returns per-dependency status;
killing Neo4j turns exactly one row red and does not crash anything.

---

## M1 — Camera throughput (S1)

Produces the number that replaces NFR-1 and NFR-2 and sets the quality floor
everywhere else.

### M1-T1 Source registry and case clock

Camera registration with `mode`, `declared_start_ts`, `fps`. A `CaseClock` type
converting frame sequence to case-clock timestamp.

*Done when:* registration without `declared_start_ts` is rejected; a recorded
source with a declared start of last November yields November timestamps, not
today's; there is a test proving it; no analysis path calls `now()` (D16,
CLAUDE.md rule 3).

### M1-T2 Decoder pool

Hardware-accelerated decode via PyAV for both RTSP and file sources. Live drops
frames to stay current, recorded seeks and can run off wall-clock. RTSP reconnect
with exponential backoff.

*Done when:* 4 RTSP and 4 file sources decode concurrently; pulling an RTSP cable
triggers reconnect without a crash; decode is confirmed to be using hardware, not
the CPU fallback; frames carry sequence numbers and case-clock timestamps.

### M1-T3 Calibration

Ten-second batched forward pass at startup producing `budget_dps`, `vram_ceiling`
and `max_batch`. Reported to the server and stored in `engine_nodes`.

*Done when:* two runs on the same machine agree within a stated tolerance;
measured VRAM matches `nvidia-smi` within a stated tolerance; a node that fails
calibration registers as `degraded` and is assigned no cameras.

### M1-T4 Frame scheduler

Cameras request slices against `budget_dps`. Excess demand degrades per-camera FPS
uniformly instead of dropping a camera. Per-camera effective FPS is reported.

*Done when:* adding a camera beyond budget lowers FPS across all feeds rather than
failing one; effective FPS is exposed on the control socket; a stated-tolerance
test confirms the scheduler stays within budget under load.

### M1-T5 Batched detection

One detector instance, TensorRT FP16, batch of N frames per forward pass. Person
class only. Emits `cv.boxes` per `API_CONTRACTS.md` §3.2.

*Done when:* boxes render in the client over MJPEG; batch size adapts to
`max_batch`; sustained operation for one hour shows no VRAM growth.

### M1-T6 Tracker

ByteTrack producing stable within-camera track ids and completed tracklets.

*Done when:* an id survives brief occlusion in test footage; completed tracklets
emit on the control socket with their best-quality crop indices.

### M1-T7 Video wall

All registered cameras render simultaneously in the client, each with its
effective-FPS readout and a warning band below the quality floor.

*Done when:* eight feeds render without UI stutter; the readout matches the
scheduler; the warning band appears when FPS is forced below the floor.

### M1-T8 S1 measurement

Run the experiment. Cameras sustained at 10 FPS, peak VRAM, and tracklet
fragmentation and IDF1 as a function of detection FPS on MOT17.

*Done when:* results are in `RESULTS.md`; NFR-1 and NFR-2 in `PRD.md` are replaced
with measured values; the quality floor is recorded in `DECISIONS.md` under D14.
**Measure with RTSP decode included** — reading a local MP4 is cheaper and would
flatter the number.

---

## After M1

M2 (cross-camera Re-ID, S2) is next and depends on M1-T6 and the quality floor.
M3 (document recognition, S3) is independent of M1 and M2, so it is the natural
parallel track when someone else joins.

M4 (extraction and graph) depends on M3. M5 (identity and ledger) is independent
of all of them. M6 (campus pilot) needs consent forms prepared and signed before
collection starts — see D26 for the collection approach.

Full milestone definitions are in `EVALUATION.md` §3.

---

## Cadence

Two-week cycles, one measurement run per cycle, one appended `RESULTS.md` row. A
fortnight with no new row means something is stuck, and that is the alarm it is
there to raise (D24).
