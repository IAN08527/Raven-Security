"""Phase 4 proof: topology-gated handoff (D8) — Re-ID runs only where + when.

Phase 3 matches a locked target on every feed. Phase 4 gates that: on lock-on
the engine arms only the adjacent downstream cameras, each for its travel-time
window; the match loop runs Re-ID only on a camera whose window is currently
open; closed windows expire so the GPU lane frees; a sighting chains the next
hop. The DB read + real GPU lane run on the demo machine — what we prove here,
GPU-less and DB-less, is the gating core:

  - compute_windows turns handoff edges into correct [open, close] windows,
  - a target locked on cam_01 arms cam_02 + cam_03 but NOT cam_04,
  - for_camera matches a camera only inside its open window (before = no,
    during = yes, after = no),
  - expire() drops closed windows so the camera stops running Re-ID,
  - a sighting on cam_02 chains cam_04 (the next hop).

Run:  RAVEN_CV_MODE=mock python tools/test_topology.py
"""
import os
import sys

os.environ.setdefault("RAVEN_CV_MODE", "mock")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))

import numpy as np  # noqa: E402
from cv.reid import embed, to_b64  # noqa: E402
from cv.targets import TargetRegistry  # noqa: E402
from cv.topology import compute_windows  # noqa: E402

# Seeded topology (tools/seed_cctv.py): cam_01 -> cam_02 (18s) + cam_03 (30s).
CAM01_EDGES = [
    {"code": "cam_02", "mean_travel_s": 18, "stddev_s": 3},
    {"code": "cam_03", "mean_travel_s": 30, "stddev_s": 4},
]
# cam_02 -> cam_04 (25s), the next hop.
CAM02_EDGES = [{"code": "cam_04", "mean_travel_s": 25, "stddev_s": 5}]

SIGMA = 2.0
PAD = 3.0


def target_b64(color=(200, 40, 40)):
    frame = np.zeros((120, 80, 3), dtype="uint8")
    frame[:] = color
    vector, _c, _b = embed(frame, [0, 0, 80, 120])
    return to_b64(vector)


def main() -> None:
    T0 = 1000.0

    # --- 1. window math ---
    w = compute_windows(CAM01_EDGES, T0, sigma=SIGMA, pad_s=PAD)
    # cam_02: open = T0 + (18 - 2*3 - 3) = T0+9 ; close = T0 + 18 + 9 = T0+27
    assert abs(w["cam_02"]["open_at"] - (T0 + 9)) < 1e-6, w["cam_02"]
    assert abs(w["cam_02"]["close_at"] - (T0 + 27)) < 1e-6, w["cam_02"]
    # cam_03: open = T0 + (30 - 8 - 3) = T0+19 ; close = T0 + 30 + 11 = T0+41
    assert abs(w["cam_03"]["open_at"] - (T0 + 19)) < 1e-6, w["cam_03"]
    assert abs(w["cam_03"]["close_at"] - (T0 + 41)) < 1e-6, w["cam_03"]
    print(f"windows: cam_02 [{w['cam_02']['open_at']-T0:.0f},{w['cam_02']['close_at']-T0:.0f}]s  "
          f"cam_03 [{w['cam_03']['open_at']-T0:.0f},{w['cam_03']['close_at']-T0:.0f}]s")

    # --- 2. lock-on arms the right downstream set (cam_04 NOT armed) ---
    reg = TargetRegistry()
    reg.register("t1", target_b64(), "case-x", "cam_01")
    reg.arm("t1", w)
    armed = set(reg._targets["t1"]["watching"].keys())
    assert armed == {"cam_02", "cam_03"}, f"armed set should be cam_02+cam_03, got {armed}"
    print(f"lock-on cam_01 arms {sorted(armed)} — cam_04 dark")

    # --- 3. for_camera matches only inside the open window ---
    assert reg.for_camera("cam_02", T0 + 5) == [], "before window: no Re-ID"
    assert [t["id"] for t in reg.for_camera("cam_02", T0 + 18)] == ["t1"], "in window: Re-ID armed"
    assert reg.for_camera("cam_02", T0 + 40) == [], "after window: no Re-ID"
    # cam_04 was never armed -> never matched, regardless of time.
    assert reg.for_camera("cam_04", T0 + 18) == [], "un-armed camera never runs Re-ID"
    print("gate: cam_02 matched only inside [9,27]s; cam_04 never")

    # --- 4. expire frees closed windows ---
    reg.expire(T0 + 30)  # cam_02 closed (27 < 30); cam_03 still open (closes 41)
    remaining = set(reg._targets["t1"]["watching"].keys())
    assert remaining == {"cam_03"}, f"cam_02 window should have expired, left {remaining}"
    assert reg.has_open_windows("t1", T0 + 30), "cam_03 still open"
    reg.expire(T0 + 50)  # everything closed
    assert reg._targets["t1"]["watching"] == {}, "all windows expired"
    assert not reg.has_open_windows("t1", T0 + 50), "no windows left -> GPU lane frees"
    print("expire: cam_02 dropped at +30s; all clear at +50s (lane frees)")

    # --- 5. sighting on cam_02 chains the next hop (cam_04) ---
    T2 = T0 + 18  # a sighting fires mid-window
    reg.arm("t1", compute_windows(CAM02_EDGES, T2, sigma=SIGMA, pad_s=PAD))
    assert "cam_04" in reg._targets["t1"]["watching"], "sighting must arm the next hop cam_04"
    # cam_04 window opens ~ T2 + (25 - 10 - 3) = T2+12
    assert [t["id"] for t in reg.for_camera("cam_04", T2 + 25)] == ["t1"], "cam_04 now armed in-window"
    print("chain: sighting on cam_02 arms cam_04 for its window")

    print("\nPHASE 4 PROOF (topology gate): PASS")


if __name__ == "__main__":
    main()
