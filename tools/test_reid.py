"""Phase 1 proof: the Re-ID fingerprint is real, not random.

Runs the deterministic mock backend (no GPU / no cv2 / no torch) and checks:
  - a fingerprint is a 512-d unit vector,
  - the SAME outfit (even with pixel noise) matches itself (cosine ~ 1),
  - a DIFFERENT outfit does NOT match as well,
  - embed crops the given bbox (clamped to the frame).

Run:  RAVEN_CV_MODE=mock python tools/test_reid.py
"""
import os
import sys

os.environ.setdefault("RAVEN_CV_MODE", "mock")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))

import numpy as np  # noqa: E402
from cv.reid import embed, cosine_sim, DIM  # noqa: E402


def solid(color, h=80, w=40):
    f = np.zeros((h, w, 3), dtype="uint8")
    f[:] = color
    return f


def main() -> None:
    bbox = [0, 0, 40, 80]

    red_a = solid((200, 40, 40))
    red_b = solid((200, 40, 40)).astype("int16")
    red_b += np.random.default_rng(0).integers(-8, 9, red_b.shape)  # pixel noise
    red_b = np.clip(red_b, 0, 255).astype("uint8")
    green = solid((40, 180, 60))

    va, crop_a, cb = embed(red_a, bbox)
    vb, _, _ = embed(red_b, bbox)
    vc, _, _ = embed(green, bbox)

    same = cosine_sim(va, vb)   # same outfit, noisy
    diff = cosine_sim(va, vc)   # different outfit

    print(f"dim={va.shape[0]} norm={np.linalg.norm(va):.4f}")
    print(f"same-outfit cosine = {same:.4f}")
    print(f"diff-outfit cosine = {diff:.4f}")
    print(f"crop bbox = {cb}  crop shape = {crop_a.shape}")

    assert va.shape[0] == DIM, "fingerprint must be 512-d"
    assert abs(np.linalg.norm(va) - 1.0) < 1e-4, "must be L2-normalized"
    assert same > 0.98, f"same outfit should match itself, got {same:.4f}"
    assert diff < same - 0.2, f"different outfit should be clearly lower, got {diff:.4f}"
    assert cb == [0, 0, 40, 80], "bbox should clamp/round to the frame"

    # bbox clamping: a box larger than the frame is trimmed to it
    _, _, clamped = embed(red_a, [-10, -10, 999, 999])
    assert clamped == [0, 0, 40, 80], f"expected full-frame clamp, got {clamped}"

    print("\nPHASE 1 PROOF: PASS")


if __name__ == "__main__":
    main()
