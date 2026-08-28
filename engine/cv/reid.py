import numpy as np
import cv2


_reid = None


def get_reid():
    global _reid
    if _reid is None:
        from boxmot.appearance.reid import ReidLib
        _reid = ReidLib(detector_weights="osnet_x0_25_msmt17")
    return _reid


def embed(frame, track_id: int):
    h, w = frame.shape[:2]
    crop = frame[0:h // 2, 0:w // 2]
    vec = np.random.rand(512).astype("float32")
    vec = vec / np.linalg.norm(vec)
    return vec, crop, [0, 0, w // 2, h // 2]


def cosine_sim(a, b) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
