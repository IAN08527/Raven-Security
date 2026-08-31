# CCTV Re-ID — Demo-Machine Runbook

Everything the GPU-less dev sandbox could not exercise, in the order to run it on
the demo machine (RTX 5070 8GB). The feature is code-complete and mock-proven
(`tools/test_*.py`, all six PASS); this runbook turns the mock-proofs into a live
green run. Nothing here is a code change — it is setup + verification.

**Posture:** every "real" ML/DB/ledger step is deferred to this machine by design
(the Sessions 2/3 mock-proof discipline). If a step is blocked (download, service
down), stop and flag — do not fake footage or rows.

---

## 0. Prerequisites

- `.env` at repo root with `RAVEN_PG_DSN` (cloud Supabase), `RAVEN_BADGE` (default
  `MH-1188`), ledger + Neo4j endpoints.
- Python engine deps: `pip install -r engine/requirements.txt` (brings `asyncpg`,
  `torch`, `boxmot`, `cv2`).
- Rust toolchain (`cargo`) + Node (`npm`) for the Tauri app.

---

## 1. Rust + TS compile gates (no runtime needed)

```
cargo check -p raven -p raven-core     # Phases 2 + 5 Rust (reid.rs, db/postgres.rs, commands/cctv.rs)
npx tsc --noEmit                        # generated.ts wire shapes (LockResult, CVSighting, ConfirmResult)
```

Expected: both clean. These never ran in the sandbox (no Rust toolchain / no
`node_modules`).

## 2. Apply the CCTV evidence migration (Phase 5)

```
psql "$RAVEN_PG_DSN" -f infra/migrations/002_cctv_evidence.sql
```

Relaxes `evidence.source_file_id` NOT NULL for `kind='cctv_sighting'` only and
widens `insight_reviews.object_id` to `text` (sighting PKs are bigint). Without
it, a confirm cannot write evidence.

## 3. Seed the camera network (Phase 0)

```
python tools/seed_cctv.py
```

Expect `seeded cameras=4 camera_edges=4`. Topology:
`cam_01 ──18s──> cam_02 ──25s──> cam_04` with `cam_01 ──30s──> cam_03 ──22s──┘`.

## 4. Seed the officer badge row (Phase 5)

`confirm_sighting` resolves `RAVEN_BADGE` → `officers.id` for
`insight_reviews.officer_id` (NOT NULL) and **hard-errors if absent**. Insert one
`officers` row whose badge matches `RAVEN_BADGE` (default `MH-1188`).

## 5. Drop the demo clips (Phase 0)

Place 4 `.mp4` files in `assets/cctv/` (gitignored), named per
`assets/cctv/README.md`: same person crossing `cam_01 → cam_02 → cam_04`, with
`cam_03` as the alternate route. The mock path never needed footage; the real
YOLO/OSNet path does.

## 6. Exercise the real OSNet path

Leave `RAVEN_CV_MODE` **unset** (or `=real`) so `reid.py::get_reid` loads OSNet
instead of the mock histogram:

- First use downloads the `osnet_x0_25_msmt17` weights (needs network).
- Verify the **boxmot 11.x entrypoint** in `reid.py::get_reid` (`ReidAutoBackend`
  `.model.get_features`) matches the installed boxmot version — the one line the
  sandbox could not import-check.
- `torch.cuda.is_available()` should be `True` on the 5070.

## 7. Bring up Ledger + Neo4j

With both services up, lock-on anchoring (Phase 2) and confirm/evidence weighting
(Phase 5) return `anchored` instead of `pending` (D4). Down is tolerated — it just
shows `pending`.

---

## Live acceptance (the end-to-end demo, roadmap "Definition of done")

1. Open **cam_01** → live pedestrian boxes with 2-digit track IDs.
2. Click person **03** → box turns red "LOCKED"; a ledger `tx:` hash appears.
   Verifies: one `reid_targets` row + one `audit_log(action='reid.lock')` row.
3. Target leaves frame → engine auto-arms **cam_02** for its travel window;
   `cam_03`/`cam_04` are **not** running Re-ID (watch VRAM — one CV lane only).
4. Person reappears on **cam_02** → a sighting card pops (thumbnail + "cam_02 · sim
   0.89"). Verifies: one `reid_sightings` row + one `cv.sighting` WS event.
5. Click **Confirm** → verifies: `insight_reviews` row + `reid_sightings.confirmed_by`
   set + one `cctv_sighting` evidence row per edge, and the linked graph edge weight
   rises by **+10** (`recompute_weight`).

Green when all five write the expected rows and the anchors read `anchored`.

---

## Where the mock-proofs already cover the logic

| Live step | Sandbox proof (already PASS) |
| :-- | :-- |
| Embedding stability | `tools/test_reid.py` |
| Lock-on payload / pgvector round-trip | `tools/test_lock.py` |
| Sighting match + attribution | `tools/test_sighting.py` |
| Topology window math + gate | `tools/test_topology.py` |
| Confirm route guard + SQL parity | `tools/test_confirm.py` |
| Full chain across seams | `tools/test_e2e.py` |

The demo machine confirms the **real backends** (GPU/DB/ledger) behave as the mocks
predicted; it is not re-proving the logic.
