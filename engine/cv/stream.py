import asyncio
import cv2
from .detect import detect_persons


async def mjpeg_stream(camera_code: str, feed_uri: str, ws_push):
    cap = cv2.VideoCapture(feed_uri)
    while cap.isOpened():
        ok, frame = cap.read()
        if not ok:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue
        boxes = detect_persons(frame)
        await ws_push({"type": "cv.detections", "payload": {"camera_code": camera_code, "boxes": boxes}})
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n")
        await asyncio.sleep(1 / 15)
    cap.release()
