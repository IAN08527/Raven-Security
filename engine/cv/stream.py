import asyncio
import os
import time
from datetime import datetime, timezone

import cv2

from .detect import detect_persons
from .match import evaluate_matches
from .targets import registry
from . import topology

# Top-level engine module (engine/ is on sys.path when main:app runs). Optional
# so the stream still serves frames on a box with no asyncpg / DB configured.
try:
    import db as db_layer
except Exception:  # pragma: no cover - import guard
    db_layer = None

try:
    from vram import vram, Lane
except Exception:  # pragma: no cover - import guard
    vram = None
    Lane = None

SIGHTING_DIR = os.path.join("assets", "cctv", "sightings")


def _save_sighting_frame(crop, target_id: str, camera_code: str, ts: str) -> str:
    """Best-effort: write the matched crop to disk; return path or ''."""
    try:
        os.makedirs(SIGHTING_DIR, exist_ok=True)
        stamp = ts.replace(":", "").replace("-", "").replace(".", "")
        short = target_id.replace("-", "")[:8]
        path = os.path.join(SIGHTING_DIR, f"{camera_code}_{short}_{stamp}.jpg")
        cv2.imwrite(path, crop)
        return path
    except Exception:
        return ""


async def _rearm_downstream(target_id: str, from_camera: str) -> None:
    """Phase 4: chain the next hop — arm the sighting camera's downstream cams.

    A confirmed re-appearance on camN means the target is moving; arm camN's
    own downstream (cam_02 → cam_04) so the handoff follows the network.
    """
    try:
        import time as _time
        edges = await topology.predict_handoff(from_camera)
        windows = topology.compute_windows(edges, _time.time())
        if windows:
            registry.arm(target_id, windows)
    except Exception:
        pass


async def _emit_sightings(camera_code, frame, boxes, ws_push) -> None:
    """Phase 3 match loop, Phase 4 topology-gated.

    Re-ID runs only on a camera whose travel-time window is currently open for a
    target (D8) and behind the single CV VRAM lane, so an 8GB GPU never runs
    more than one Re-ID lane at a time. Above-threshold matches become
    `reid_sightings` rows + a `cv.sighting` WS event; a match chains the next
    hop. A DB outage still surfaces the sighting to the officer (D4 posture).
    """
    now = time.time()
    registry.expire(now)  # closed windows free the GPU lane
    targets = registry.for_camera(camera_code, now)
    if not targets:
        return
    threshold = float(os.environ.get("RAVEN_REID_THRESHOLD", "0.75"))
    cooldown = float(os.environ.get("RAVEN_REID_COOLDOWN_S", "10"))

    # The embed is the GPU work — hold the CV lane only around it (D8/§6.3).
    if vram is not None:
        await vram.acquire(Lane.CV)
    try:
        matches = evaluate_matches(frame, boxes, targets, threshold)
    finally:
        if vram is not None:
            vram.release()

    for m in matches:
        target_id = m["target_id"]
        if registry.in_cooldown(target_id, camera_code, cooldown):
            continue
        registry.mark(target_id, camera_code)

        ts = datetime.now(timezone.utc).isoformat()
        similarity = round(float(m["similarity"]), 4)
        frame_path = _save_sighting_frame(m["crop"], target_id, camera_code, ts)

        sighting_id = None
        if db_layer is not None:
            try:
                camera_id = await db_layer.resolve_camera_id(camera_code)
                if camera_id:
                    sighting_id = await db_layer.insert_reid_sighting(
                        target_id, camera_id, ts, similarity, m["bbox"], frame_path
                    )
            except Exception:
                pass  # DB down: still broadcast; row is best-effort (D4)

        await ws_push({
            "type": "cv.sighting",
            "payload": {
                "sighting_id": sighting_id,
                "target_id": target_id,
                "camera_code": camera_code,
                "similarity": similarity,
                "bbox": m["bbox"],
                "frame_path": frame_path,
                "ts": ts,
                "track_id": m.get("track_id"),
            },
        })

        # Phase 4: the target moved — arm this camera's downstream for the
        # next hop (cam_02 sighting -> arm cam_04).
        await _rearm_downstream(target_id, camera_code)


async def mjpeg_stream(session, ws_push):
    """MJPEG stream + detection broadcast for one CVSession.

    Also maintains the session's per-track box cache (`last_boxes`) and the most
    recent frame (`last_frame`) so a Phase 2 lock-on can crop the actual selected
    track from the frame the officer is looking at, and runs the Phase 3 match
    loop that turns re-appearances of an active target into sightings.
    """
    camera_code = session.camera_code
    cap = cv2.VideoCapture(session.feed_uri)
    while cap.isOpened():
        ok, frame = cap.read()
        if not ok:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue
        h, w = frame.shape[:2]
        # Detection is the Backlog #5 hook; keep the stream alive even if the
        # YOLO stack is not installed yet (frontend wiring path).
        try:
            boxes = detect_persons(frame)
        except Exception:
            boxes = []
        session.last_frame = frame
        session.last_boxes = {b["track_id"]: [b["x"], b["y"], b["w"], b["h"]] for b in boxes}
        await ws_push({
            "type": "cv.detections",
            "payload": {
                "camera_code": camera_code,
                "boxes": boxes,
                "frame_w": int(w),
                "frame_h": int(h),
            },
        })
        # Phase 3: re-identify active targets on this feed. Never let a match
        # failure kill the stream the officer is watching.
        try:
            await _emit_sightings(camera_code, frame, boxes, ws_push)
        except Exception:
            pass
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n")
        await asyncio.sleep(1 / 15)
    cap.release()
