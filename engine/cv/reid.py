"""OSNet person Re-ID embeddings (Backlog #5, Phase 1).

`embed(frame, bbox)` crops the person's box out of a frame and returns an
L2-normalized 512-d appearance vector (the "fingerprint"), the crop, and the
clamped bbox. Same person -> nearly the same vector; different person ->
different vector. Cross-camera matching (Phase 3) is a cosine compare of two
such vectors.

Two backends, selected by `RAVEN_CV_MODE` (mirrors `RAVEN_NLP_MODE`):
  auto (default) - real OSNet if it loads, else the deterministic mock
  real           - force OSNet (raises if unavailable)
  mock           - force the deterministic mock (no GPU / no weights)

The mock is an appearance descriptor built from a coarse 8x8x8 color histogram
of the crop (exactly 512 bins). It is deterministic and pixel-derived, so the
same outfit yields a high cosine even across slightly different frames, and a
different outfit yields a low one. That makes the persist/match/topology logic
(Phases 2-4) provable on a machine with no GPU. Pure-numpy: the mock path pulls
in neither cv2 nor torch.
"""
import os
import numpy as np

DIM = 512

_reid = None


def _mode() -> str:
    return os.environ.get("RAVEN_CV_MODE", "auto").lower()


def _crop(frame, bbox):
    """Clamp an [x, y, w, h] box to the frame and return (crop, clamped_bbox)."""
    h, w = frame.shape[:2]
    x, y, bw, bh = (int(round(v)) for v in bbox)
    x0 = max(0, min(x, w - 1))
    y0 = max(0, min(y, h - 1))
    x1 = max(x0 + 1, min(x + bw, w))
    y1 = max(y0 + 1, min(y + bh, h))
    return frame[y0:y1, x0:x1], [x0, y0, x1 - x0, y1 - y0]


def _normalize(vec) -> np.ndarray:
    vec = np.asarray(vec, dtype="float32").reshape(-1)
    n = float(np.linalg.norm(vec))
    if n < 1e-12:
        vec = np.ones(DIM, dtype="float32")
        n = float(np.linalg.norm(vec))
    return vec / n


def get_reid():
    """Lazy singleton OSNet backend (boxmot). Raises if the CV stack is absent.

    NOTE: the exact boxmot 11.x entrypoint is verified on the demo machine (it
    needs torch + the osnet_x0_25_msmt17 weights, which download on first use).
    The mock path is what proves the logic in a GPU-less environment.
    """
    global _reid
    if _reid is None:
        from pathlib import Path
        import torch
        from boxmot.appearance.reid_auto_backend import ReidAutoBackend

        device = "cuda" if torch.cuda.is_available() else "cpu"
        _reid = ReidAutoBackend(
            weights=Path("osnet_x0_25_msmt17.pt"),
            device=device,
            half=False,
        ).model
    return _reid


def _embed_real(frame, xywh) -> np.ndarray:
    model = get_reid()
    x, y, w, h = xywh
    xyxy = np.array([[x, y, x + w, y + h]], dtype="float32")
    feats = model.get_features(xyxy, frame)  # (1, 512)
    return _normalize(np.asarray(feats)[0])


def _embed_mock(crop) -> np.ndarray:
    """Deterministic appearance fingerprint: an 8x8x8 color histogram (=512)."""
    arr = np.asarray(crop)
    if arr.size == 0 or arr.ndim < 3:
        return _normalize(np.ones(DIM))
    px = arr.reshape(-1, arr.shape[-1])[:, :3].astype("int32")
    idx = np.minimum(px // 32, 7)  # 256/32 = 8 bins per channel
    flat = idx[:, 0] * 64 + idx[:, 1] * 8 + idx[:, 2]
    hist = np.bincount(flat, minlength=DIM).astype("float32")
    return _normalize(hist)


def embed(frame, bbox):
    """Return (vector, crop, clamped_bbox) for the person at `bbox`.

    `bbox` is [x, y, w, h] in pixels. Backend per `RAVEN_CV_MODE`.
    """
    crop, cbbox = _crop(frame, bbox)
    mode = _mode()
    if mode in ("auto", "real"):
        try:
            return _embed_real(frame, cbbox), crop, cbbox
        except Exception:
            if mode == "real":
                raise
            # auto: fall through to the mock backend
    return _embed_mock(crop), crop, cbbox


def cosine_sim(a, b) -> float:
    a = np.asarray(a, dtype="float32").reshape(-1)
    b = np.asarray(b, dtype="float32").reshape(-1)
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom < 1e-12:
        return 0.0
    return float(np.dot(a, b) / denom)
