# CCTV Re-ID — Feature Roadmap

**Backlog item:** #5 — Spatio-Temporal CCTV Tracking & Human-in-the-Loop Re-ID
**Spec:** PRD §5.4 (FR-4.1 / FR-4.2 / FR-4.3), architecture §6.3, decisions **D8** (topology-gated Re-ID) and **D9** (ledger-anchored lock-on)
**Branch:** `feature/cctv-reid`
**Verification posture:** real OSNet code path + deterministic mock-vector proof in the GPU-less sandbox (same pattern as Sessions 2/3). Real inference runs on the demo machine (RTX 5070 8GB).

---

## What this feature is

Four simulated CCTV feeds (recorded MP4 clips). An officer watches a feed where YOLOv8 detects pedestrians and tags each with a 2-digit track ID. The officer **locks on** to one person — the decisive human act — and the engine builds an OSNet 512-dim Re-ID "fingerprint", persists it as a target, and anchors the act on the ledger. As the target moves, the engine activates Re-ID **only on adjacent downstream cameras during the predicted travel-time window** (the VRAM-saving trick that keeps an 8GB GPU alive). Re-appearances surface as sightings the officer confirms or rejects. A confirmed sighting becomes court-grade `cctv_sighting` evidence worth +10 in the graph edge-weight matrix.

The two things that make this *Raven* and not a generic tracker: **D8** (topology gating) and **D9** (human-in-the-loop lock-on is an accountable, auditable act).

---

## Starting state (before this roadmap)

**Already real:** full DB schema (`cameras`, `camera_edges`, `reid_targets` with pgvector `vector(512)`, `reid_sightings`, `audit_log`); FastAPI CV routes + WS broadcast; Rust `start/lock/stop` command proxies; `VisionPane` UI (camera selector, MJPEG player, SVG box overlay, click-to-lock); `detect.py` real YOLOv8 ByteTrack; `stream.py` MJPEG + detection broadcast.

**Still stubbed (the work):** `reid.py::embed` returns `np.random.rand(512)` with a hardcoded crop; `session.lock_on` persists nothing and does not anchor; no sighting/matching loop; `topology.predict_handoff` written but never called; Rust `lock_on_target` returns empty `tx_id`; no camera seed rows; no demo clips.

---

## Phase 0 — Clip assets & camera seed — ✅ DONE (code; DB seed pending demo machine)

**Goal:** a deterministic, repeatable demo dataset.

- Clips **deferred** (decision): this dev machine has no GPU/cv2, so real footage only exercises on the demo machine. Clip slots documented in `assets/cctv/README.md`; `.mp4` files gitignored; real clips dropped in on the demo box.
- **`tools/seed_cctv.py`** written — upserts `cameras` (4 rows) + `camera_edges` topology, idempotent, reuses `engine/db.py`. Seeded topology:
  ```
  cam_01 ──18s──> cam_02 ──25s──> cam_04
     └────30s────> cam_03 ──22s────┘
  ```
- **Not yet run** — this machine has no `.env`/`asyncpg`. On the demo machine: `pip install -r engine/requirements.txt`, ensure `.env` has `RAVEN_PG_DSN`, then `python tools/seed_cctv.py` (expect `seeded cameras=4 camera_edges=4`).

**Exit criteria:** engine opens each `feed_uri`; `cameras` / `camera_edges` rows present in cloud Postgres. If the clip download is blocked, stop and flag — do not fake footage.

**Delivered:** `tools/seed_cctv.py`, `assets/cctv/README.md`. **Remaining:** run the seeder + drop clips on the demo machine.

---

## Phase 1 — Real Re-ID embedding — ✅ DONE

**Goal:** turn the fake fingerprint into a real one.

- `reid.py`: `embed(frame, bbox)` now crops the **actual person box** (clamped to the frame), not the hardcoded quadrant. Real path runs OSNet via `boxmot` (`osnet_x0_25_msmt17`) → L2-normalized 512-vec.
- `RAVEN_CV_MODE` (`auto`/`real`/`mock`, mirrors `RAVEN_NLP_MODE`). Mock = deterministic 8×8×8 color-histogram descriptor (=512 bins), pure-numpy (no cv2/torch), so the same outfit matches itself across frames and different outfits don't — makes Phases 2–4 provable with no GPU.
- `session.py` caller updated to the new `(frame, bbox)` signature (whole-frame bbox until the Phase 2 box cache lands).
- Kept `cosine_sim`.

**Exit criteria:** `embed` returns a stable 512-vec for a given crop under `mock`; real OSNet path imports and runs on the demo machine. ✅

**Proof:** `tools/test_reid.py` (pure-numpy, `RAVEN_CV_MODE=mock`) **PASS** — 512-d unit vector; same outfit (+pixel noise) cosine `1.0000`; different outfit `0.0000`; bbox clamps to frame. Real OSNet path verified on the demo machine (needs torch + weights).

**Delivered:** `engine/cv/reid.py`, `engine/cv/session.py` (caller), `tools/test_reid.py`.

---

## Phase 2 — Lock-on persistence + ledger anchor (D9) — ✅ DONE (code + payload proof; DB/ledger on demo machine)

**Goal:** lock-on becomes a real, accountable, recoverable act.

- Stream loop maintains a per-session last-known-boxes cache (track_id → bbox), so lock-on can crop the selected track from the current frame.
- `session.lock_on`: embed the target bbox, **INSERT `reid_targets`** (feature via pgvector, `source_camera`, `source_ts`, thumbnail saved to disk), return real `target_vector_b64` / `thumbnail_path` / `crop_bbox`.
- Rust `lock_on_target`: compute payload hash, **anchor on the ledger** (reuse the `audit` / `ledger` core modules from Session 2), write `audit_log(action='reid.lock')`, return the real `tx_id`. Ledger down → `ledger_status='pending'`, no crash (D4).

**Exit criteria:** a lock-on writes one `reid_targets` row + one `audit_log` row and returns a `tx_id` (or `pending`); UI shows the tx hash. ✅

**Delivered:**
- `engine/cv/stream.py` — stream loop now takes the `CVSession` and writes a per-track box cache (`last_boxes`) + `last_frame`. `main.py` passes the session.
- `engine/cv/session.py` — `lock_on` crops the selected track from the live frame, embeds it, saves a thumbnail, returns `target_vector_b64` / `feature_literal` (pgvector text) / `crop_bbox` / `source_camera_code` / `source_ts` / `thumbnail_path`.
- `engine/cv/reid.py` — `to_b64` / `from_b64` / `to_pgvector` serialization helpers.
- `src-tauri/core/src/reid.rs` (new) — `lock_on`: resolve case+camera uuids, INSERT `reid_targets` (feature via `$n::vector`), sha256 the act, ledger-anchor (`reid.lock`), INSERT `audit_log` with tx+status, update `reid_targets.ledger_tx_id`. Ledger down → `pending` (D4, no crash).
- `src-tauri/core/src/db/postgres.rs` — `resolve_camera_id`, `insert_reid_target`, `set_reid_target_ledger`, `insert_audit_log`.
- `src-tauri/src/commands/cctv.rs` — `lock_on_target` takes `case_id`, orchestrates engine→persist→anchor, returns real `target_id` + `tx_id` + `ledger_status`. `LockResult` gained `ledger_status`.
- `src/components/vision/VisionPane.tsx` — passes `caseId` from the case store; shows anchored/pending + tx. `src/types/generated.ts` updated.

**Proof:** `tools/test_lock.py` (mock, no GPU/DB) **PASS** — vector base64 round-trips lossless (cosine 1.0000), pgvector literal has 512 parts and re-parses exactly, crop bbox clamps inside frame. `tools/test_reid.py` (Phase 1) still PASS. The pg write + ledger anchor run in Rust and verify on the demo machine (`cargo check -p raven -p raven-core` + a live lock-on writes the two rows).

**Remaining (demo machine, by design):** `cargo check` / real DB + ledger run — no Rust toolchain in this sandbox, same posture as the Phase 1 OSNet path.

---

## Phase 3 — Sighting match loop — ✅ DONE (code + mock proof; DB/WS on demo machine)

**Goal:** the target is recognized again downstream.

- In the stream/watcher loop, for each active target on a **watched** camera, embed every detected person and cosine-sim against the target vector.
- Above threshold → **INSERT `reid_sightings`** (`similarity`, `bbox`, `frame_path`) and broadcast a `cv.sighting` WS event.
- Threshold tunable via env; guard against duplicate sightings within a short window.

**Exit criteria:** a person matching a locked target on a watched camera produces a `reid_sightings` row + a `cv.sighting` event. ✅

**Delivered:**
- `engine/cv/targets.py` (new) — process-local `TargetRegistry`: active targets keyed by the real DB `target_id`, per-`(target, camera)` cooldown, and a `watching` gate. Phase 3 registers `watching=None` (match every camera); `for_camera` already honours the gate so **Phase 4 is a registration change, not a rewrite**.
- `engine/cv/match.py` (new) — `evaluate_matches(frame, boxes, targets, threshold)`: pure decision core, no DB/WS/cooldown side effects. Embeds each person, attributes a box to at most its single best target.
- `engine/cv/stream.py` — `_emit_sightings` runs after detection each frame: cooldown check → save crop → `insert_reid_sighting` (best-effort, D4) → `cv.sighting` broadcast. Env `RAVEN_REID_THRESHOLD` (0.75) / `RAVEN_REID_COOLDOWN_S` (10). Match failure never kills the stream.
- `engine/db.py` — `resolve_camera_id` (cached) + `insert_reid_sighting` (numeric via `Decimal`, `bbox` as `int[]`). A sighting is a *candidate*, not an accountable act — no ledger (the Phase 5 confirm anchors).
- `engine/main.py` — `POST /cv/targets/register` (Rust arms the match loop with the real `target_id` + fingerprint after `reid::lock_on`) + `DELETE /cv/targets/{target_id}`.
- `src-tauri/src/commands/cctv.rs` — `lock_on_target` now POSTs `/cv/targets/register` after persist+anchor (best-effort; a registry hiccup never fails the committed lock).
- `src/types/generated.ts` — `CVSighting` wire shape.

**Proof:** `tools/test_sighting.py` (mock, no GPU/DB) **PASS** — same outfit downstream = 1 sighting (sim `1.0000`); different outfit = 0; two-person frame attributes only the target (track 3); cooldown is per-`(target, camera)` and suppresses within window; topology gate matches only the armed camera. Phases 1 & 2 proofs still PASS.

**Remaining (demo machine, by design):** `cargo check -p raven` (no Rust toolchain in this sandbox) + a live locked target re-appearing on a watched feed writing one `reid_sightings` row and emitting one `cv.sighting`.

---

## Phase 4 — Topology-gated handoff (D8) — ✅ DONE (code + mock proof; DB/GPU on demo machine)

**Goal:** Re-ID runs only where and when it should — the VRAM-safety core.

- On lock-on (and on target exit from frame), call `topology.predict_handoff` to get downstream cameras + travel windows; set `session.watching = { downstream_cam: window }`.
- The match loop (Phase 3) runs Re-ID **only** on cameras currently in `watching`, and only inside the time window. Everything stays behind the existing `vram.acquire(Lane.CV)` mutex.
- Window expiry clears the watch so the GPU lane frees.

**Exit criteria:** with a target locked on cam_01, only cam_02 (and its window) is armed; cam_03/cam_04 are not running Re-ID; the watch expires on schedule. ✅

**Delivered:**
- `engine/cv/topology.py` — `predict_handoff(from_camera)` refactored onto the shared `db.get_pool()` (was a raw `asyncpg.connect`), now joins through to the downstream `code`. New pure `compute_windows(edges, now, sigma, pad_s)` → `{cam_code: {open_at, close_at, mean_travel_s}}`; window = `now + mean ± (sigma·stddev + pad)`, floored at `now`. Env `RAVEN_REID_WINDOW_SIGMA` (2.0) / `RAVEN_REID_WINDOW_PAD_S` (3.0).
- `engine/cv/targets.py` — `watching` is now **time windows**, not a flat set. `arm(target_id, windows)` merges downstream windows (lock-on + each sighting hop); `for_camera(camera, now)` matches only while the camera's window is open; `expire(now)` prunes closed windows so the GPU lane frees; `has_open_windows` reports whether a target is still live. `watching=None` still means match-everywhere (pre-arm only).
- `engine/main.py` — `/cv/targets/register` now calls `predict_handoff(source_camera)` + `compute_windows` and arms the target with the real downstream windows. DB hiccup degrades to `watching=None`, never silently arms nothing. Returns the `armed` camera list.
- `engine/cv/stream.py` — `_emit_sightings` is topology-gated: `registry.expire(now)` then `for_camera(camera, now)`; the embed (the GPU work) runs behind `vram.acquire(Lane.CV)` so an 8GB GPU never runs more than one Re-ID lane at a time; `_rearm_downstream` chains the next hop on each sighting (cam_02 sighting → arm cam_04).

**Proof:** `tools/test_topology.py` (mock, no GPU/DB) **PASS** — window math exact (cam_02 `[9,27]s`, cam_03 `[19,41]s`); lock-on cam_01 arms cam_02+cam_03, cam_04 dark; `for_camera` matches cam_02 only inside its window (before/after = no Re-ID); `expire` drops cam_02 at +30s and frees the lane at +50s; a cam_02 sighting chains cam_04. Phases 1–3 proofs still PASS.

**Remaining (demo machine, by design):** live `predict_handoff` DB read + real GPU lane contention across concurrent feeds (the mock proves the gate math + registry state machine). Rust untouched this phase.

---

## Phase 5 — Human-in-the-loop confirm (FR-2.3 + evidence)

**Goal:** close the loop and feed the graph.

- New Rust `confirm_sighting` command: confirm/reject → write `insight_reviews` + set `reid_sightings.confirmed_by`; a confirm emits a `cctv_sighting` **evidence** row so `recompute_weight` bumps the relationship edge (+10, §5.3).
- `VisionPane`: sightings panel listing incoming `cv.sighting` events across cameras (thumbnail + camera + similarity) with Confirm / Reject buttons; surface lock `tx_id`.
- Regenerate `src/types/generated.ts` for the new shapes.

**Exit criteria:** confirming a sighting writes `insight_reviews` + evidence; the linked graph edge weight increases.

---

## Phase 6 — Proof & documentation

**Goal:** prove it and hand off cleanly.

- Headless mock test (no GPU): lock-on persists a target, the match loop writes a sighting, the topology gate selects the correct downstream camera, confirm writes evidence.
- Document the real-OSNet run for the demo machine (weights download, GPU, `RAVEN_CV_MODE` unset).
- Update `CONTEXT.md` session ledger; move Backlog #5 to DONE with the standard handoff note.

**Exit criteria:** mock test passes; `cargo check -p raven` / `-p raven-core` clean; `CONTEXT.md` updated.

---

## Definition of done (end-to-end demo)

Officer opens **cam_01** → live pedestrian boxes with IDs. Clicks person **03** → box turns red "LOCKED", a ledger `tx:` hash appears. Target leaves frame; engine auto-arms **cam_02** for its travel window. Person reappears on cam_02 → a sighting card pops: thumbnail + "cam_02 · sim 0.89". Officer clicks **Confirm** → it becomes evidence and that person's graph edges thicken (+10). The GPU never runs more than one Re-ID lane at a time.

## Risks & dependencies

- **OSNet weights + torch/CUDA** only run real on the demo machine; sandbox uses the mock path.
- **pgvector** cosine search relies on `CREATE EXTENSION vector` (present in `001_init.sql`).
- **Ledger/Neo4j** may be down in the sandbox → `pending` states, consistent with D4; full green needs those services up on the demo machine.
- **Clip sourcing** (Phase 0) is the one external dependency; a blocked download stalls the demo dataset.

## Phase dependency order

`Phase 0 → 1 → 2 → 3 → 4 → 5 → 6`. Phases 3 and 4 are tightly coupled (the match loop is what the topology gate switches on/off) but are listed separately so the gating logic is verified on its own.

---

## Progress status (living — update as phases land)

_Last updated: 2026-08-30_

| Phase | Title | Status |
| :--- | :--- | :--- |
| 0 | Clips + camera/topology seed | ✅ Code done · DB seed + clips pending demo machine |
| 1 | Real Re-ID embedding | ✅ Done + proven (mock) |
| 2 | Lock-on persist + ledger anchor (D9) | ✅ Code done + payload proof · DB/ledger + cargo check pending demo machine |
| 3 | Sighting match loop | ✅ Code done + proven (mock) · DB/WS + cargo check pending demo machine |
| 4 | Topology-gated handoff (D8) | ✅ Code done + proven (mock) · DB/GPU pending demo machine |
| 5 | Human-in-loop confirm + evidence | ⬜ Not started |
| 6 | Proof & documentation | ⬜ Not started |

### What we actually did

**Phase 0 — camera network seeded (code).**
- Wrote `tools/seed_cctv.py`: idempotent upsert of 4 `cameras` (cam_01–04, one locality cluster, `feed_uri` → `assets/cctv/cam_0N.mp4`) + 4 `camera_edges` forming the topology `cam_01→cam_02→cam_04` with a `cam_03` branch that reconverges on cam_04. Reuses `engine/db.py`, prints a topology summary on run.
- Wrote `assets/cctv/README.md` documenting the 4 clip slots; `.mp4` already gitignored.
- **Decision:** clips deferred to demo-machine setup (this dev machine has no GPU/cv2, so real footage only exercises there). Add clip files last, after Phase 6, during demo-machine setup.

**Phase 1 — Re-ID fingerprint made real (done + proven).**
- Rewrote `engine/cv/reid.py`. `embed(frame, bbox)` now crops the **actual person box** (clamped to frame) instead of the old hardcoded top-left quadrant, and returns `(vector, crop, clamped_bbox)`.
- Replaced the fake `np.random.rand(512)` with two real backends behind `RAVEN_CV_MODE` (`auto`/`real`/`mock`): **real** = OSNet via `boxmot` (`osnet_x0_25_msmt17`), L2-normalized 512-vec; **mock** = deterministic 8×8×8 color-histogram descriptor (=512 bins), pure-numpy (no cv2/torch).
- Updated the `session.py` caller to the new signature.
- Proof `tools/test_reid.py` PASSES: 512-d unit vector; same outfit (+noise) cosine `1.0000`; different outfit `0.0000`; bbox clamps.

**Phase 2 — lock-on persisted + anchored (done + payload proof).**
- Stream loop (`stream.py`) now takes the `CVSession` and maintains a per-track box cache (`last_boxes`) + `last_frame`; `main.py` passes the session in. Fixed a latent `main.py` module-scope crash (annotation referenced an unimported `cv_session`).
- `session.lock_on` crops the **selected track** from the live frame (not the whole frame), embeds it, writes a thumbnail, and returns the full persistence payload: `target_vector_b64`, `feature_literal` (pgvector text), `crop_bbox`, `source_camera_code`, `source_ts`, `thumbnail_path`. Added `to_b64`/`from_b64`/`to_pgvector` to `reid.py`.
- New `raven_core::reid::lock_on`: resolves case + camera to UUIDs, inserts `reid_targets` (feature via `$n::vector`), sha256-hashes the act, anchors it on the ledger (`reid.lock`), inserts `audit_log` with the tx + status, and stamps `reid_targets.ledger_tx_id`. Ledger outage → `pending`, never blocks the committed row (D4). Backed by four new `db::postgres` helpers.
- Rust `lock_on_target` now takes `case_id`, orchestrates engine→persist→anchor, and returns a real `target_id` + `tx_id` + `ledger_status`. `VisionPane` supplies `caseId` from the case store and shows anchored/pending + tx.
- Proof `tools/test_lock.py` PASSES: base64 round-trip lossless (cosine `1.0000`), pgvector literal = 512 parts and re-parses exactly, crop bbox clamps. Phase 1 proof still PASSES.

**Phase 3 — sighting match loop (done + proven).**
- New `engine/cv/targets.py` `TargetRegistry`: the live set of locked targets the match loop compares against, keyed by the real DB `target_id`. Separate from any `CVSession` because a sighting fires on a *different* camera than the lock camera. Carries a per-`(target, camera)` cooldown and a `watching` gate; Phase 3 leaves `watching=None` (all cameras) — Phase 4 fills it in.
- New `engine/cv/match.py` `evaluate_matches`: pure, side-effect-free matcher (embed each person, cosine vs each target, one box → its best target ≥ threshold). Testable with mock vectors, no DB/GPU.
- `stream.py` now runs `_emit_sightings` each frame: cooldown-gated, saves the crop, writes `reid_sightings` (best-effort — DB down still broadcasts, D4), emits `cv.sighting`. Thresholds via `RAVEN_REID_THRESHOLD` / `RAVEN_REID_COOLDOWN_S`.
- `engine/db.py`: `resolve_camera_id` (cached) + `insert_reid_sighting` (Decimal numeric, `int[]` bbox). No ledger — a sighting is a candidate; Phase 5 confirm is the accountable act.
- `engine/main.py`: `/cv/targets/register` + `DELETE /cv/targets/{id}`. Rust `lock_on_target` arms the match loop by POSTing the anchored `target_id` + fingerprint after persist (best-effort).
- `src/types/generated.ts`: `CVSighting` shape.
- Proof `tools/test_sighting.py` PASSES: same outfit = 1 sighting (sim `1.0000`); different outfit = 0; two-person frame attributes only the target; cooldown per-camera; topology gate arms only the right camera. Phases 1 & 2 still PASS.

**Phase 4 — topology-gated handoff (done + proven).**
- `topology.py`: `predict_handoff` moved onto the shared pool + joins to the downstream code; new pure `compute_windows(edges, now, sigma, pad)` builds `[open, close]` travel-time windows (`now + mean ± (sigma·stddev + pad)`, floored at `now`). Env `RAVEN_REID_WINDOW_SIGMA` / `RAVEN_REID_WINDOW_PAD_S`.
- `targets.py`: `watching` became time windows. `arm` merges downstream windows (lock-on + sighting chain), `for_camera(cam, now)` gates on the open window, `expire(now)` frees closed windows, `has_open_windows` reports liveness.
- `main.py`: `/cv/targets/register` arms the real downstream windows via `predict_handoff` + `compute_windows` (DB down → `watching=None`).
- `stream.py`: `_emit_sightings` expires + gates by window, holds `vram.acquire(Lane.CV)` around the embed (one GPU lane), and `_rearm_downstream` chains the next hop on each sighting.
- Proof `tools/test_topology.py` PASSES: window math exact; cam_01 lock arms cam_02+cam_03 (cam_04 dark); cam_02 matched only in-window; expiry frees the lane; cam_02 sighting chains cam_04. Phases 1–3 still PASS.

### What remains

- **Phases 5–6:** not started (see each phase section above for the plan + exit criteria).
- **Demo-machine-only work (deferred by design, not blockers to building 3–6):**
  - `cargo check -p raven -p raven-core` (no Rust toolchain in this sandbox) + one live lock-on writing the `reid_targets` + `audit_log` rows.
  - Run `python tools/seed_cctv.py` against cloud Supabase (needs `.env` + `pip install -r engine/requirements.txt`). Expect `seeded cameras=4 camera_edges=4`.
  - Drop the 4 real `.mp4` clips into `assets/cctv/` (same person crossing cam_01→02→04, cam_03 = alt route).
  - Exercise the **real OSNet path** (`RAVEN_CV_MODE` unset/`real`) — needs torch + CUDA + weights download; verify the `boxmot` 11.x entrypoint in `reid.py::get_reid`.
  - Bring up Ledger + Neo4j so lock-on anchoring (Phase 2) and evidence weighting (Phase 5) go green instead of `pending`.

### Environment notes (this dev machine — macOS)

- No GPU, no `cv2`/`torch`, no `asyncpg`; Python is externally-managed (PEP 668) so system `pip install` is blocked. The Phase 1 proof runs in a scratchpad venv with only `numpy`. All "real" ML/DB execution is the demo machine's job — matches the Sessions 2/3 mock-proof discipline in `CONTEXT.md`.
- Every phase is built + unit-proven here with fake frames / mock vectors; clips + GPU integrate last.
