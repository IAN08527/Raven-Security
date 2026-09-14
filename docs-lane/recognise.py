"""Single multi-script line recogniser, shared Unicode charset (pipeline
step 4, D17).

Architecture choice (STACK.md §5: "PARSeq or CRNN"): CRNN exported to
ONNX. A CRNN is plain convolutional + recurrent ops that lower to stock
ONNX without custom decoding kernels; PARSeq's permuted-LM
autoregressive decoding is heavier to export and slower on CPU. That
matters because the document lane is queued and CPU-viable by design
(ARCHITECTURE.md §3.3: it loads on demand and yields to the resident CV
lane) -- the recogniser must run where the GPU is already spoken for.

Weights status (honest, rule 10): no CRNN has been trained -- training
needs IIIT-INDIC-HW-WORDS (DROPPED) or IAM (registration-gated) plus the
S3 harness. `ONNXCRNNRecognizer.load()` raises `RecognizerWeightsNotCached`
until weights are pulled once and cached locally per STACK.md §5 (the M2
OSNet pattern). There is deliberately no fallback recogniser: invented
transcriptions would flow into evidence (FR-4.4) and entity spans, which
is exactly the harm rule 8 exists to prevent. Unrecognised lines route
to the review queue with a stated reason (rule 9).

Dependency note: `onnxruntime` is imported function-locally inside
`load()`, after the weights check, so module import never pays the load
cost and never needs the GPU provider present. Pin when weights land:
onnxruntime-gpu 1.30.x per STACK.md §6 (verified 2026-09-11); the
`ORT_PROVIDERS` order below prefers CUDA and falls back to CPU, which is
what lets the queued lane run on the all-in-one box.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from pydantic import BaseModel, Field

ORT_PROVIDERS = ["CUDAExecutionProvider", "CPUExecutionProvider"]
TARGET_LINE_HEIGHT = 32


class LineHypothesisModel(BaseModel):
    """Pydantic boundary for one recognition hypothesis."""

    text: str
    confidence: float = Field(ge=0.0, le=1.0)


@dataclass(frozen=True)
class LineHypothesis:
    text: str
    confidence: float


class RecognizerWeightsNotCached(RuntimeError):
    """Raised when recogniser weights are requested but absent from the
    local cache. Weights are pulled once and cached locally (STACK.md
    §5) -- never downloaded at runtime (rule 6)."""


class LineRecognizer(ABC):
    """Stage boundary: line crop (HxW uint8) in, text hypothesis out."""

    @abstractmethod
    def recognise(self, line_crop: np.ndarray) -> LineHypothesis:
        """Recognise one line crop. Raises on empty input, never invents."""
        raise NotImplementedError


class ONNXCRNNRecognizer(LineRecognizer):
    """CRNN in ONNX format. Construct with the expected weights path;
    call `load()` before `recognise()`. Both raise until real weights
    exist -- see module docstring for why there is no fallback."""

    def __init__(self, weights_path: str | Path) -> None:
        self.weights_path = Path(weights_path)
        self._session: object | None = None

    def load(self) -> None:
        """Load weights into an ONNX Runtime session. Raises
        `RecognizerWeightsNotCached` when the file is absent rather than
        downloading it (rule 6) or stubbing output (rule 8)."""
        if not self.weights_path.is_file():
            raise RecognizerWeightsNotCached(
                "no recogniser weights cached at "
                f"{self.weights_path}: train the D17 CRNN once S3 data lands, "
                "export to ONNX, and place the file here (STACK.md §5: pulled "
                "once, cached locally, never downloaded at runtime). Until "
                "then every line routes to the review queue (FR-2.7)."
            )
        import onnxruntime  # type: ignore[import-untyped]  # deferred: no stubs shipped

        self._session = onnxruntime.InferenceSession(
            str(self.weights_path), providers=ORT_PROVIDERS
        )

    def recognise(self, line_crop: np.ndarray) -> LineHypothesis:
        if line_crop.size == 0:
            raise ValueError("recognise: refusing an empty line crop")
        if self._session is None:
            raise RecognizerWeightsNotCached(
                f"recogniser not loaded (weights: {self.weights_path}); "
                "call load() after caching weights, or route the line to "
                "the review queue."
            )
        raise RecognizerWeightsNotCached(
            "weights present but the forward pass is not wired until the "
            "first trained export lands with its preprocessing contract; "
            "refusing to guess rather than shipping an untested decode."
        )


def normalise_line_height(line_crop: np.ndarray, height: int = TARGET_LINE_HEIGHT) -> np.ndarray:
    """Rescale a line crop to the recogniser's input height, preserving
    aspect ratio. Pure preprocessing, no weights -- safe to use now for
    crop storage and the review queue's source images."""
    if line_crop.size == 0:
        raise ValueError("normalise_line_height: refusing an empty line crop")
    source_height, source_width = line_crop.shape[:2]
    if source_height == 0:
        raise ValueError("normalise_line_height: zero-height crop")
    scale = height / source_height
    new_width = max(int(source_width * scale), 1)
    return cv2.resize(line_crop, (new_width, height), interpolation=cv2.INTER_AREA)
