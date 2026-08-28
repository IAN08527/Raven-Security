import cv2

_model = None


def get_model():
    global _model
    if _model is None:
        try:
            from ultralytics import YOLO
            _model = YOLO("yolov8n.pt")
        except ImportError:
            _model = None
    return _model


def detect_persons(frame, conf: float = 0.4):
    model = get_model()
    results = model.track(frame, classes=[0], conf=conf, persist=True)
    boxes = []
    for r in results:
        for box in r.boxes:
            if box.id is None:
                continue
            x, y, w, h = box.xywh[0].tolist()
            boxes.append({
                "track_id": int(box.id[0]),
                "x": int(x - w / 2), "y": int(y - h / 2),
                "w": int(w), "h": int(h),
                "conf": float(box.conf[0]),
            })
    return boxes
