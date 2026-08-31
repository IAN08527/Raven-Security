import os
from datetime import datetime, timezone

import cv2

from .detect import detect_persons
from .reid import embed, to_b64, to_pgvector

THUMB_DIR = os.path.join("assets", "cctv", "thumbs")


class CVSession:
    def __init__(self, camera_code: str, feed_uri: str) -> None:
        self.camera_code = camera_code
        self.feed_uri = feed_uri
        self.track_id = None
        self.target_vector = None
        self.watching = {}
        # Phase 2: the stream loop writes the most recent detected boxes and the
        # frame they came from here, so lock-on can crop the actual selected
        # track instead of guessing a quadrant.
        self.last_boxes: dict[int, list] = {}
        self.last_frame = None

    def _save_thumb(self, crop, track_id: int, ts: str) -> str:
        """Best-effort: write the target crop to disk; return path or ''."""
        try:
            os.makedirs(THUMB_DIR, exist_ok=True)
            stamp = ts.replace(":", "").replace("-", "").replace(".", "")
            path = os.path.join(THUMB_DIR, f"{self.camera_code}_{track_id:02d}_{stamp}.jpg")
            cv2.imwrite(path, crop)
            return path
        except Exception:
            return ""

    async def lock_on(self, track_id: int) -> dict:
        # Prefer the live frame + cached box for this track (populated by the
        # stream loop). Fall back to reading frame 0 if the stream isn't running.
        frame = self.last_frame
        bbox = self.last_boxes.get(track_id)
        if frame is None:
            cap = cv2.VideoCapture(self.feed_uri)
            ok, frame = cap.read()
            cap.release()
            if not ok:
                return {"ok": False}
        if bbox is None:
            h, w = frame.shape[:2]
            bbox = [0, 0, w, h]

        vector, crop, cbbox = embed(frame, bbox)
        ts = datetime.now(timezone.utc).isoformat()
        thumbnail_path = self._save_thumb(crop, track_id, ts)

        self.track_id = track_id
        self.target_vector = vector
        return {
            "ok": True,
            "target_vector_b64": to_b64(vector),
            "feature_literal": to_pgvector(vector),
            "crop_bbox": cbbox,
            "source_camera_code": self.camera_code,
            "source_ts": ts,
            "thumbnail_path": thumbnail_path,
        }

    async def stop(self) -> dict:
        self.watching = {}
        return {"ok": True, "gpu_released": True}
