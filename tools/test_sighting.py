"""Phase 3 proof: the sighting match loop recognizes a locked target downstream.

Phase 3 turns a persisted target (Phase 2) into a live cross-camera match: on a
watched feed, every detected person is embedded and cosine-compared to the
target fingerprint; an above-threshold box becomes a `reid_sightings` row + a
`cv.sighting` event. The DB write + websocket run on the demo machine; what we
prove here, GPU-less and DB-less, is the decision core:

  - the same outfit re-appearing on another camera matches above threshold,
  - a different outfit does not match,
  - when two people are in frame, only the right one is attributed to the target
    (a box maps to at most its single best target),
  - the per-(target, camera) cooldown suppresses duplicate sightings,
  - the topology `watching` gate (the Phase 4 seam) selects the right cameras.

Run:  RAVEN_CV_MODE=mock python tools/test_sighting.py
"""
import os
import sys

os.environ.setdefault("RAVEN_CV_MODE", "mock")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))

import numpy as np  # noqa: E402
from cv.match import evaluate_matches  # noqa: E402
from cv.reid import embed, to_b64  # noqa: E402
from cv.targets import TargetRegistry  # noqa: E402

THRESHOLD = 0.75


def person_frame(color, h=120, w=80, noise=0):
    """A frame with a solid-outfit 'person' filling it; optional pixel noise."""
    f = np.zeros((h, w, 3), dtype="uint8")
    f[:] = color
    if noise:
        rng = np.random.default_rng(0)
        f = np.clip(f.astype("int16") + rng.integers(-noise, noise + 1, f.shape), 0, 255).astype("uint8")
    return f


def box(track_id, w, h):
    return {"track_id": track_id, "x": 0, "y": 0, "w": w, "h": h, "conf": 0.9}


def register_target(reg, target_id, color, source_camera="cam_01", watching=None):
    frame = person_frame(color)
    vector, _crop, _bb = embed(frame, [0, 0, frame.shape[1], frame.shape[0]])
    reg.register(target_id, to_b64(vector), "case-x", source_camera, watching)


def main() -> None:
    RED = (200, 40, 40)
    BLUE = (40, 60, 200)

    # --- 1. same outfit on a downstream camera matches ---
    reg = TargetRegistry()
    register_target(reg, "t-red", RED)
    frame = person_frame(RED, noise=8)  # slightly different frame, same outfit
    matches = evaluate_matches(frame, [box(3, 80, 120)], reg.for_camera("cam_02"), THRESHOLD)
    assert len(matches) == 1, f"same outfit must produce 1 sighting, got {len(matches)}"
    assert matches[0]["target_id"] == "t-red"
    sim = matches[0]["similarity"]
    assert sim >= THRESHOLD, f"same-outfit similarity {sim:.4f} must clear threshold"
    print(f"same outfit downstream: 1 sighting, sim={sim:.4f}")

    # --- 2. a different outfit does not match ---
    other = person_frame(BLUE)
    none = evaluate_matches(other, [box(4, 80, 120)], reg.for_camera("cam_02"), THRESHOLD)
    assert none == [], f"different outfit must not match, got {none}"
    print("different outfit: 0 sightings")

    # --- 3. two people in one frame, only the target is attributed ---
    # Red person on the left half, blue person on the right; each box crops its
    # own half, so only the red one should be attributed to the red target.
    mixed_frame = np.concatenate([person_frame(RED), person_frame(BLUE)], axis=1)
    red_box = {"track_id": 3, "x": 0, "y": 0, "w": 80, "h": 120, "conf": 0.9}
    blue_box = {"track_id": 9, "x": 80, "y": 0, "w": 80, "h": 120, "conf": 0.9}
    mixed = evaluate_matches(mixed_frame, [red_box, blue_box], reg.for_camera("cam_02"), THRESHOLD)
    ids = {m["track_id"] for m in mixed}
    assert ids == {3}, f"only the red person (track 3) should match, got {ids}"
    print("two-person frame: only the target attributed (track 3)")

    # --- 4. cooldown suppresses duplicates ---
    assert not reg.in_cooldown("t-red", "cam_02", 10), "fresh target not in cooldown"
    reg.mark("t-red", "cam_02")
    assert reg.in_cooldown("t-red", "cam_02", 10), "just-logged sighting must be in cooldown"
    assert not reg.in_cooldown("t-red", "cam_03", 10), "cooldown is per-camera"
    assert not reg.in_cooldown("t-red", "cam_02", 0), "zero window never suppresses"
    print("cooldown: per-(target, camera), suppresses within window")

    # --- 5. topology gate (Phase 4 seam) ---
    gated = TargetRegistry()
    register_target(gated, "t-g", RED, watching={"cam_02": {"start": 0}})
    assert [t["id"] for t in gated.for_camera("cam_02")] == ["t-g"], "armed camera matches"
    assert gated.for_camera("cam_03") == [], "un-armed camera does not match"
    assert gated.for_camera("cam_01") == [], "source camera not armed"
    print("topology gate: only armed downstream camera is matched")

    print("\nPHASE 3 PROOF (match loop): PASS")


if __name__ == "__main__":
    main()
