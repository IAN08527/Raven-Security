"""Phase 6 proof: end-to-end Re-ID chain (Backlog #5).

Phases 1-5 each proved one unit in isolation (embed, lock payload, sighting
match, topology gate, confirm guard). This test proves the **seams between
them** — the handoffs the unit tests can't see:

    lock-on  →  arms the right downstream cameras (topology)
             →  a re-appearance on a watched camera in-window becomes a sighting
             →  the gate stays shut off-window and on un-armed cameras
             →  a sighting chains the next hop
             →  confirm mints evidence + bumps the linked graph edges (+10)
             →  a re-confirm is refused (no double-count); a reject is review-only

It drives the **real** engine modules (`cv.reid`, `cv.match`, `cv.targets`,
`cv.topology`) with mock vectors — the same GPU-less discipline as every prior
phase. The confirm/evidence step lives in Rust (`raven_core::reid::confirm_sighting`,
no importable Python surface), so it is modeled here by `ConfirmModel`, whose
logic mirrors `reid.rs::confirm_sighting` line-for-line and whose +10 edge score
is read from the real `001_init.sql` `recompute_weight` source — not hardcoded.
The live Rust confirm + DB weight bump verify on the demo machine (`cargo check`
+ one live confirm), exactly as documented for Phases 2 and 5.

Run:  RAVEN_CV_MODE=mock python tools/test_e2e.py
"""
import os
import re
import sys

os.environ.setdefault("RAVEN_CV_MODE", "mock")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))

import numpy as np  # noqa: E402
from cv.reid import embed, to_b64  # noqa: E402
from cv.match import evaluate_matches  # noqa: E402
from cv.targets import TargetRegistry  # noqa: E402
from cv.topology import compute_windows  # noqa: E402

fails = []


def check(cond, msg):
    print(f"  {'ok  ' if cond else 'FAIL'} {msg}")
    if not cond:
        fails.append(msg)


# --- Seeded topology (tools/seed_cctv.py) -----------------------------------
# cam_01 -> cam_02 (18s) + cam_03 (30s);  cam_02 -> cam_04 (25s), the next hop.
CAM01_EDGES = [
    {"code": "cam_02", "mean_travel_s": 18, "stddev_s": 3},
    {"code": "cam_03", "mean_travel_s": 30, "stddev_s": 4},
]
CAM02_EDGES = [{"code": "cam_04", "mean_travel_s": 25, "stddev_s": 5}]
SIGMA, PAD = 2.0, 3.0
THRESHOLD = 0.75


def outfit_frame(color):
    """A solid-color 'person' crop — a distinct mock appearance fingerprint."""
    frame = np.zeros((120, 80, 3), dtype="uint8")
    frame[:] = color
    return frame


def person_box():
    return [{"track_id": 3, "x": 0, "y": 0, "w": 80, "h": 120}]


def sighting_pass(reg, camera_code, frame, boxes, now):
    """Mirror of stream.py::_emit_sightings decision core (no DB / WS / cv2).

    expire closed windows -> gate to this camera's open window -> match ->
    cooldown-suppress. Returns the sightings this frame would emit.
    """
    reg.expire(now)
    targets = reg.for_camera(camera_code, now)
    if not targets:
        return []
    matches = evaluate_matches(frame, boxes, targets, THRESHOLD)
    out = []
    for m in matches:
        tid = m["target_id"]
        if reg.in_cooldown(tid, camera_code, 10.0):
            continue
        reg.mark(tid, camera_code)
        out.append(m)
    return out


# ---------------------------------------------------------------------------
# ConfirmModel — mirrors raven_core::reid::confirm_sighting (Rust; Phase 5).
# The +10 weight is read from the real recompute_weight SQL, not invented.
# ---------------------------------------------------------------------------
def cctv_sighting_score():
    init_sql = open(os.path.join(ROOT, "infra", "migrations", "001_init.sql")).read()
    m = re.search(r"WHEN\s+'cctv_sighting'\s+THEN\s+(\d+)", init_sql)
    if not m:
        raise AssertionError("recompute_weight cctv_sighting score not found in 001_init.sql")
    return int(m.group(1))


class ConfirmModel:
    """In-memory stand-in for the Rust confirm flow + graph, to prove the seam.

    Semantics copied from reid.rs::confirm_sighting:
      confirm on a linked target -> set confirmed_by, mint one cctv_sighting
      evidence row per edge touching the entity, recompute_weight (+score) each;
      re-confirm -> error (idempotency guard); reject -> review row only.
    """

    def __init__(self, edges):
        self.score = cctv_sighting_score()
        self.edge_weight = {e: 0 for e in edges}   # entity's graph edges
        self.confirmed = set()                     # sighting_ids already confirmed
        self.reviews = []                          # insight_reviews rows
        self.evidence = []                         # cctv_sighting evidence rows

    def confirm(self, sighting_id, entity_linked=True):
        if sighting_id in self.confirmed:
            raise ValueError(f"sighting {sighting_id} already confirmed")
        self.reviews.append((sighting_id, "confirm"))
        self.confirmed.add(sighting_id)
        edges_bumped = 0
        if entity_linked:
            for e in self.edge_weight:
                self.evidence.append((sighting_id, e))
                self.edge_weight[e] += self.score
                edges_bumped += 1
        return edges_bumped

    def reject(self, sighting_id):
        self.reviews.append((sighting_id, "reject"))
        # no evidence, no weight change


def main():
    reg = TargetRegistry()
    T0 = 1000.0

    red = outfit_frame((200, 40, 40))    # the locked target
    blue = outfit_frame((40, 40, 200))   # a decoy (different outfit)

    # --- 1. lock-on: register + topology-arm the downstream set --------------
    print("lock-on cam_01 -> arm downstream")
    tvec, _c, _b = embed(red, [0, 0, 80, 120])
    reg.register("t1", to_b64(tvec), "case-x", "cam_01")
    reg.arm("t1", compute_windows(CAM01_EDGES, T0, sigma=SIGMA, pad_s=PAD))
    armed = set(reg._targets["t1"]["watching"].keys())
    check(armed == {"cam_02", "cam_03"}, f"armed cam_02+cam_03 (got {sorted(armed)})")
    check(reg.for_camera("cam_04", T0 + 18) == [], "cam_04 never armed -> dark")

    # --- 2. decoy on a watched camera in-window does NOT match --------------
    print("decoy re-appearance (different outfit)")
    s = sighting_pass(reg, "cam_02", blue, person_box(), T0 + 18)
    check(s == [], "different outfit on cam_02 -> 0 sightings")

    # --- 3. the target re-appears on cam_02 inside its window -> 1 sighting --
    print("target re-appearance on cam_02 (in-window)")
    s = sighting_pass(reg, "cam_02", red, person_box(), T0 + 18)
    check(len(s) == 1, f"target on cam_02 in-window -> 1 sighting (got {len(s)})")
    sim = s[0]["similarity"] if s else 0.0
    check(sim >= 0.99, f"same outfit cosine ~1.0 (got {sim:.4f})")
    check(s and s[0]["target_id"] == "t1", "sighting attributed to the locked target")

    # the sighting chains the next hop: arm cam_02's downstream (cam_04)
    reg.arm("t1", compute_windows(CAM02_EDGES, T0 + 18, sigma=SIGMA, pad_s=PAD))
    check("cam_04" in reg._targets["t1"]["watching"], "sighting chains next hop -> cam_04 armed")

    # --- 4. topology gate stays shut off-window and on un-armed cameras ------
    print("topology gate shut off-window / un-armed")
    reg2 = TargetRegistry()
    reg2.register("t1", to_b64(tvec), "case-x", "cam_01")
    reg2.arm("t1", compute_windows(CAM01_EDGES, T0, sigma=SIGMA, pad_s=PAD))
    check(sighting_pass(reg2, "cam_02", red, person_box(), T0 + 40) == [],
          "target present but cam_02 window closed -> 0 sightings")
    check(sighting_pass(reg2, "cam_04", red, person_box(), T0 + 18) == [],
          "target present but cam_04 un-armed -> 0 sightings")

    # --- 5. confirm mints evidence + bumps every linked edge (+10) ----------
    print("confirm -> evidence + graph edge bump")
    model = ConfirmModel(edges=["edge_A", "edge_B"])
    check(model.score == 10, f"recompute_weight scores cctv_sighting = 10 (got {model.score})")
    before = dict(model.edge_weight)
    bumped = model.confirm(sighting_id=501, entity_linked=True)
    check(bumped == 2, f"both linked edges bumped (got {bumped})")
    check(len(model.evidence) == 2, "one cctv_sighting evidence row per edge")
    check(all(model.edge_weight[e] == before[e] + 10 for e in model.edge_weight),
          "each linked edge weight rose by +10")

    # --- 6. idempotency: a re-confirm is refused (no double-count) ----------
    print("re-confirm guard")
    doubled = False
    try:
        model.confirm(sighting_id=501, entity_linked=True)
    except ValueError:
        doubled = True
    check(doubled, "re-confirming the same sighting raises (guard)")
    check(all(w == 10 for w in model.edge_weight.values()), "edges still +10, not +20 (no double-count)")

    # --- 7. reject is review-only (no evidence, no weight change) -----------
    print("reject -> review only")
    ev_before = len(model.evidence)
    model.reject(sighting_id=777)
    check(len(model.evidence) == ev_before, "reject writes no evidence")
    check((777, "reject") in model.reviews, "reject records a review row")

    print()
    if fails:
        print(f"FAILED ({len(fails)}): " + "; ".join(fails))
        sys.exit(1)
    print("PASS — Phase 6 end-to-end chain green (mock). "
          "Live Rust confirm + DB weight bump verify on the demo machine.")


if __name__ == "__main__":
    main()
