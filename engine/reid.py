"""Re-ID appearance embedding, per tracklet (D9, D15, M2-T1).

Lock-on only: an embedding is computed from the best-quality crops of a
completed tracklet after an officer selects the target -- never per-frame
(D15: per-tracklet aggregation is both cheaper and more stable than any
single crop). All vectors are float32 and L2-normalised before return.

Engine selection (OSNet x1.0 vs x0.25, TensorRT FP16) is measured, not
guessed: whichever engine file fits within ``vram_ceiling`` after the
detector is already resident is chosen, by ``stat().st_size`` -- the same
pattern as ``PersonDetector``'s ceiling check. Model weights are pulled
once and cached locally per ``STACK.md`` §5; ``models/osnet_x1_0.engine``
is now cached and export-verified (see ``docs/RESULTS.md`` S2 rows), but
``embed_single`` still serves the deterministic fallback (see
``_fallback_embed``) until a TensorRT inference path lands here -- and no
production call passes engine paths yet, so variant selection cannot
mislabel fallback vectors as OSNet output. S2 numbers require real
inference over identity-labelled data; never treat fallback vectors as a
measurement (CLAUDE.md rule 10).
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import torch
from pydantic import BaseModel, Field

EMBEDDING_DIM = 512
TOP_K = 5
FALLBACK_INPUT_SIZE = (32, 64)  # (width, height) for cv2.resize; fixed so the projection is fixed
_VRAM_TOLERANCE_MB = 50.0


class QualityFloorNotRecorded(RuntimeError):
    """Raised when D14's quality floor would be needed but is unmeasured."""


def quality_floor_fps() -> float:
    """D14's quality floor (ARCHITECTURE.md §3.2) is an honest placeholder:
    S1b is blocked on dataset access, so there is no measured value to
    return. Raise rather than guess (CLAUDE.md rule 10)."""
    raise QualityFloorNotRecorded("quality floor unmeasured, complete S1b first — see D14")


class TrackletCrops(BaseModel):
    """Model boundary for per-tracklet embedding (CLAUDE.md conventions:
    Pydantic at every model boundary, including internal ones)."""

    confidences: list[float] = Field(min_length=1)


def _l2_normalise(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    if norm == 0.0:
        raise ValueError("cannot L2-normalise a zero vector")
    return (vector / norm).astype(np.float32)


def _fallback_projection() -> np.ndarray:
    """Fixed 512 x N projection, seeded once. Deterministic per process:
    the same crop always yields the same vector (required by tests), with
    no per-call randomness and no network access."""
    flat_len = FALLBACK_INPUT_SIZE[0] * FALLBACK_INPUT_SIZE[1] * 3
    rng = np.random.RandomState(0)
    return rng.standard_normal(size=(EMBEDDING_DIM, flat_len)).astype(np.float32)


_FALLBACK_PROJECTION = _fallback_projection()


def _fallback_embed(crop: np.ndarray) -> np.ndarray:
    """Deterministic stand-in for the OSNet forward pass.

    NOT a measurement of Re-ID accuracy -- it exists so the per-tracklet
    aggregation, storage, pipeline and UI paths are testable before the
    TensorRT engines land. Same input bytes always give the same unit-norm
    output; different inputs generally differ.
    """
    if crop.size == 0:
        raise ValueError("cannot embed an empty crop")
    if crop.ndim == 2:
        crop_rgb = cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR)
    elif crop.ndim == 3 and crop.shape[2] == 3:
        crop_rgb = crop
    else:
        raise ValueError(f"expected HxW or HxWx3 crop, got shape {crop.shape}")
    resized = cv2.resize(crop_rgb, FALLBACK_INPUT_SIZE, interpolation=cv2.INTER_AREA)
    flat = resized.astype(np.float32).reshape(-1) / 255.0
    return _l2_normalise(_FALLBACK_PROJECTION @ flat)


def current_vram_mb() -> float:
    """``torch.cuda.memory_allocated()`` in MB, or 0.0 without CUDA so the
    VRAM-stability tests pass on CPU-only CI rather than erroring."""
    if not torch.cuda.is_available():
        return 0.0
    return float(torch.cuda.memory_allocated()) / 1e6


class ReIDEmbedder:
    """Appearance embedder, resident alongside the detector (ARCH §3.3).

    ``vram_ceiling_bytes`` comes from ``CalibrationResult``; the detector
    is already resident, so ``detector_resident_bytes`` is subtracted first
    and the OSNet variant is chosen from what remains -- measured file
    sizes, never guessed sizes.
    """

    def __init__(
        self,
        vram_ceiling_bytes: int,
        detector_resident_bytes: int = 0,
        x10_engine_path: str | Path | None = None,
        x025_engine_path: str | Path | None = None,
    ) -> None:
        available = vram_ceiling_bytes - detector_resident_bytes
        if available <= 0:
            raise RuntimeError(
                "no VRAM headroom left for the Re-ID embedder after the detector "
                f"(ceiling {vram_ceiling_bytes} <= resident {detector_resident_bytes}); "
                "re-run calibration"
            )
        x10_size = self._engine_size(x10_engine_path)
        x025_size = self._engine_size(x025_engine_path)
        if x10_size is not None and x10_size <= available:
            self.variant = "osnet_x1_0"
            self.engine_bytes = x10_size
        elif x025_size is not None and x025_size <= available:
            self.variant = "osnet_x0_25"
            self.engine_bytes = x025_size
        elif x10_size is None and x025_size is None:
            # No TensorRT engine paths passed (STACK.md §5: weights are pulled
            # once and cached locally). VRAM accounting still holds -- the
            # fallback allocates negligibly -- but vectors are NOT OSNet
            # measurements; see module docstring.
            self.variant = "fallback_deterministic"
            self.engine_bytes = 0
        else:
            raise RuntimeError(
                "neither OSNet engine fits in the remaining VRAM budget "
                f"(available {available} bytes after detector resident "
                f"{detector_resident_bytes}; x1.0={x10_size}, x0.25={x025_size}); "
                "re-run calibration or free VRAM"
            )

    @staticmethod
    def _engine_size(path: str | Path | None) -> int | None:
        if path is None:
            return None
        engine_path = Path(path)
        if not engine_path.exists():
            return None
        return engine_path.stat().st_size

    def embed_single(self, crop: np.ndarray) -> np.ndarray:
        """Embed one crop (lock-on only). Returns float32, unit norm."""
        return _fallback_embed(crop)

    def embed_tracklet(
        self, crops: list[np.ndarray], confidences: list[float] | None = None
    ) -> np.ndarray:
        """Mean of the top-k single-crop embeddings, L2-normalised (D15:
        per-tracklet, never per-frame).

        ``k = min(5, len(crops))``. When ``confidences`` (parallel to
        ``crops``) is supplied, the top-k by detection confidence are used;
        otherwise the first k in order. Returns a 512-d float32 unit vector.
        """
        if not crops:
            raise ValueError("embed_tracklet requires at least one crop")
        if confidences is not None:
            TrackletCrops(confidences=confidences)
            if len(confidences) != len(crops):
                raise ValueError(
                    f"confidences ({len(confidences)}) must be parallel to crops ({len(crops)})"
                )
            ranked = sorted(range(len(crops)), key=lambda i: confidences[i], reverse=True)
        else:
            ranked = list(range(len(crops)))
        top_k = ranked[: min(TOP_K, len(crops))]
        embedded = np.stack([self.embed_single(crops[i]) for i in top_k], axis=0)
        return _l2_normalise(embedded.mean(axis=0).astype(np.float32))
