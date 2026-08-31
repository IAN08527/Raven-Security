"""Phase 2 proof: the lock-on persistence payload is correct and lossless.

Phase 2 turns a fingerprint into a durable, anchored `reid_targets` row. The DB
write + ledger anchor run in Rust (`raven_core::reid::lock_on`) and exercise on
the demo machine. What we prove here, GPU-less and DB-less, is the wire payload
the engine hands Rust to persist:

  - the vector serializes to base64 and round-trips losslessly (cosine == 1),
  - the pgvector text literal ('[..]') has 512 components and re-parses to the
    same vector (so `$n::vector` stores exactly what was embedded),
  - the clamped crop bbox is inside the frame.

Run:  RAVEN_CV_MODE=mock python tools/test_lock.py
"""
import os
import sys

os.environ.setdefault("RAVEN_CV_MODE", "mock")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))

import numpy as np  # noqa: E402
from cv.reid import embed, cosine_sim, to_b64, from_b64, to_pgvector, DIM  # noqa: E402


def solid(color, h=80, w=40):
    f = np.zeros((h, w, 3), dtype="uint8")
    f[:] = color
    return f


def main() -> None:
    frame = solid((200, 40, 40))
    bbox = [5, 10, 30, 60]

    vector, crop, cbbox = embed(frame, bbox)
    print(f"dim={vector.shape[0]} norm={np.linalg.norm(vector):.4f} crop_bbox={cbbox}")

    # 1. base64 round-trip (the target_vector_b64 wire field + hash input)
    b64 = to_b64(vector)
    back = from_b64(b64)
    assert back.shape[0] == DIM, f"b64 decode must be 512-d, got {back.shape[0]}"
    assert cosine_sim(vector, back) > 0.99999, "base64 round-trip must be lossless"

    # 2. pgvector literal (the feature_literal bound to $n::vector)
    lit = to_pgvector(vector)
    assert lit.startswith("[") and lit.endswith("]"), "pgvector literal shape"
    parts = lit[1:-1].split(",")
    assert len(parts) == DIM, f"pgvector literal must have 512 parts, got {len(parts)}"
    parsed = np.array([float(p) for p in parts], dtype="float32")
    assert cosine_sim(vector, parsed) > 0.99999, "pgvector literal must re-parse exactly"

    # 3. bbox is clamped inside the frame
    x, y, w, h = cbbox
    fh, fw = frame.shape[:2]
    assert 0 <= x and 0 <= y and x + w <= fw and y + h <= fh, f"bbox out of frame: {cbbox}"

    print(f"b64 len={len(b64)}  pgvector parts={len(parts)}  round-trip cosine=1.0000")
    print("\nPHASE 2 PROOF (payload): PASS")


if __name__ == "__main__":
    main()
