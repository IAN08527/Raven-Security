"""Cross-camera Re-ID matching (Backlog #5, Phase 3).

`evaluate_matches` is the pure decision core: given a frame, the detected
person boxes, and the active targets, it embeds each person and returns the
candidate sightings (a box that matches a target above threshold). One box is
attributed to at most its single best target, so one person never logs as two
different targets in the same frame.

Kept free of DB / websocket / cooldown side effects so it is provable in the
GPU-less sandbox (mock embeddings) — the stream loop layers persistence,
cooldown, and broadcast on top.
"""
from .reid import cosine_sim, embed


def evaluate_matches(frame, boxes, targets, threshold: float) -> list[dict]:
    """Return [{target_id, similarity, bbox, crop, track_id}] for matching boxes.

    `boxes` are detection dicts ({track_id, x, y, w, h, ...}); `targets` are
    registry entries carrying a `vector`. A box is emitted once, against its
    best-scoring target at or above `threshold`.
    """
    results = []
    for b in boxes:
        bbox = [b["x"], b["y"], b["w"], b["h"]]
        vector, crop, cbbox = embed(frame, bbox)
        best = None
        for t in targets:
            sim = cosine_sim(vector, t["vector"])
            if sim >= threshold and (best is None or sim > best["similarity"]):
                best = {
                    "target_id": t["id"],
                    "similarity": sim,
                    "bbox": cbbox,
                    "crop": crop,
                    "track_id": b.get("track_id"),
                }
        if best is not None:
            results.append(best)
    return results
