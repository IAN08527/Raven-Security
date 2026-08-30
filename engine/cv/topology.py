"""Camera-network topology + travel-time windows (Backlog #5, Phase 4 / D8).

The topology gate is the VRAM-safety core: Re-ID runs only on the cameras a
target could plausibly reach, and only during the window it could reach them in.
`predict_handoff` reads the adjacent downstream cameras + their mean/stddev
travel times from `camera_edges`; `compute_windows` turns those into concrete
[open, close] wall-clock windows around "now".

`compute_windows` is pure (no DB) so the gating math is provable in the
GPU-less sandbox; `predict_handoff` is the thin DB read that feeds it.
"""
import os


async def predict_handoff(from_camera: str) -> list:
    """Downstream cameras of `from_camera` with their travel-time stats.

    Returns [{code, mean_travel_s, stddev_s}]. Uses the shared engine pool
    (Session 1a) rather than a raw connection.
    """
    import db as db_layer

    pool = await db_layer.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT dn.code, e.mean_travel_s, e.stddev_s
               FROM cameras sn
               JOIN camera_edges e ON e.from_camera = sn.id
               JOIN cameras dn ON dn.id = e.to_camera
               WHERE sn.code = $1""",
            from_camera,
        )
    return [dict(r) for r in rows]


def compute_windows(edges: list, now: float, sigma: float | None = None, pad_s: float | None = None) -> dict:
    """Build {cam_code: {open_at, close_at, mean_travel_s}} from handoff edges.

    A target seen at `now` reaches a downstream camera in ~mean_travel_s; the
    plausible arrival spread is ±sigma·stddev, widened by a flat pad. The window
    opens no earlier than `now` (a target can't arrive before it left) and closes
    once it would certainly have passed. `now`/`open_at`/`close_at` are epoch
    seconds so the stream loop can compare against wall-clock time.
    """
    if sigma is None:
        sigma = float(os.environ.get("RAVEN_REID_WINDOW_SIGMA", "2.0"))
    if pad_s is None:
        pad_s = float(os.environ.get("RAVEN_REID_WINDOW_PAD_S", "3.0"))

    windows = {}
    for e in edges:
        mean = float(e["mean_travel_s"])
        std = float(e.get("stddev_s", 0) or 0)
        spread = sigma * std + pad_s
        open_at = now + max(0.0, mean - spread)
        close_at = now + mean + spread
        windows[e["code"]] = {
            "open_at": open_at,
            "close_at": close_at,
            "mean_travel_s": mean,
        }
    return windows
