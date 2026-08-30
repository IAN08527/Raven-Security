import asyncio

import cv2

from .detect import detect_persons


async def mjpeg_stream(session, ws_push):
    """MJPEG stream + detection broadcast for one CVSession.

    Also maintains the session's per-track box cache (`last_boxes`) and the most
    recent frame (`last_frame`) so a Phase 2 lock-on can crop the actual selected
    track from the frame the officer is looking at.
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
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n")
        await asyncio.sleep(1 / 15)
    cap.release()
