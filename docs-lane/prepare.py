"""Page preparation: deskew, binarise, normalise. Script-agnostic
(pipeline step 1, ARCHITECTURE.md §4.1).

Pure OpenCV on pixels already on disk -- no model, no corpus, no network.
True curved-page dewarping is NOT attempted here: `prepare_page` corrects
in-plane rotation (the failure that breaks line splitting) and documents
the limit rather than pretending affine warps flatten curled paper.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class PreparedPage:
    image: np.ndarray  # deskewed + binarised, uint8 HxW, values in {0, 255}
    deskew_angle_deg: float  # rotation removed, degrees, in [-45, 45)
    source_height: int
    source_width: int


def to_grayscale(image_bgr: np.ndarray) -> np.ndarray:
    """BGR or already-grey input to single-channel uint8. Raises
    `ValueError` on empty or misshaped input rather than guessing."""
    if image_bgr.size == 0:
        raise ValueError("prepare: refusing an empty image (fail loud, never silent)")
    if image_bgr.ndim == 2:
        gray = image_bgr
    elif image_bgr.ndim == 3 and image_bgr.shape[2] in (3, 4):
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    else:
        raise ValueError(f"prepare: expected HxW or HxWx3/4, got shape {image_bgr.shape}")
    if gray.dtype != np.uint8:
        low, high = float(gray.min()), float(gray.max())
        span = high - low if high > low else 1.0
        gray = ((gray - low) * (255.0 / span)).astype(np.uint8)
    return gray


def estimate_skew_angle(gray: np.ndarray) -> float:
    """In-plane skew via the minimum-area rectangle over foreground pixels
    after Otsu thresholding. Returns 0.0 (not a crash) when the page has no
    foreground to measure -- a blank page still flows downstream (rule 9)."""
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    coords = cv2.findNonZero(binary)
    if coords is None or len(coords) < 10:
        return 0.0
    angle = float(cv2.minAreaRect(coords)[-1])
    # minAreaRect reports in [-90, 0): map to the deskew rotation in
    # [-45, 45) so callers always undo, never amplify, the tilt.
    if angle < -45.0:
        angle += 90.0
    return angle


def deskew(gray: np.ndarray, angle_deg: float) -> np.ndarray:
    """Rotate by `angle_deg` around the page centre, filling exposed
    borders with paper white (255), never black (black borders become
    phantom text columns in segmentation)."""
    if angle_deg == 0.0:
        return gray
    height, width = gray.shape[:2]
    centre = (width / 2.0, height / 2.0)
    matrix = cv2.getRotationMatrix2D(centre, angle_deg, 1.0)
    return cv2.warpAffine(
        gray, matrix, (width, height), flags=cv2.INTER_LINEAR, borderValue=255
    )


def binarise(gray: np.ndarray) -> np.ndarray:
    """Adaptive Gaussian threshold (photographed pages have uneven light;
    a global Otsu cut drowns the dim corner). Output is uint8 with values
    exactly {0, 255}."""
    return cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10
    )


def prepare_page(image_bgr: np.ndarray) -> PreparedPage:
    """Full step 1: grey -> skew estimate -> deskew -> binarise."""
    gray = to_grayscale(image_bgr)
    source_height, source_width = gray.shape[:2]
    angle = estimate_skew_angle(gray)
    return PreparedPage(
        image=binarise(deskew(gray, angle)),
        deskew_angle_deg=angle,
        source_height=source_height,
        source_width=source_width,
    )
