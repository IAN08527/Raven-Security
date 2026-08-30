import cv2
from .detect import detect_persons
from .reid import embed
import asyncio


class CVSession:
    def __init__(self, camera_code: str, feed_uri: str) -> None:
        self.camera_code = camera_code
        self.feed_uri = feed_uri
        self.track_id = None
        self.target_vector = None
        self.watching = {}

    async def lock_on(self, track_id: int) -> dict:
        cap = cv2.VideoCapture(self.feed_uri)
        ok, frame = cap.read()
        cap.release()
        if not ok:
            return {"ok": False}
        # Phase 1: embed now takes the person's [x,y,w,h] box. The per-track box
        # cache that feeds the real bbox lands in Phase 2 (lock-on persistence);
        # until then fall back to the whole frame.
        h, w = frame.shape[:2]
        vector, crop, bbox = embed(frame, [0, 0, w, h])
        self.track_id = track_id
        self.target_vector = vector
        return {"target_vector_b64": "", "thumbnail_path": "", "crop_bbox": bbox}

    async def stop(self) -> dict:
        self.watching = {}
        return {"ok": True, "gpu_released": True}
