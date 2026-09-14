"""M3-1. Prepare-stage tests on synthetic fixtures (image ops, not corpus
metrics -- D19 governs benchmark rows, not code tests)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

import prepare  # noqa: E402


def _bar_page(height: int = 600, width: int = 400, bars: int = 5) -> np.ndarray:
    page = np.full((height, width, 3), 255, dtype=np.uint8)
    for i in range(bars):
        y = 60 + i * 90
        cv2.rectangle(page, (50, y), (350, y + 14), (0, 0, 0), thickness=-1)
    return page


def _rotated(page: np.ndarray, angle_deg: float) -> np.ndarray:
    height, width = page.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2.0, height / 2.0), angle_deg, 1.0)
    return cv2.warpAffine(page, matrix, (width, height), borderValue=(255, 255, 255))


def test_skew_estimate_recovers_known_rotation() -> None:
    tilted = _rotated(_bar_page(), 7.0)
    prepared = prepare.prepare_page(tilted)
    assert abs(abs(prepared.deskew_angle_deg) - 7.0) < 1.5
    assert prepared.source_height == 600
    assert prepared.source_width == 400


def test_output_is_binary_and_shape_preserved() -> None:
    prepared = prepare.prepare_page(_bar_page())
    assert prepared.image.shape == (600, 400)
    assert prepared.image.dtype == np.uint8
    assert set(np.unique(prepared.image).tolist()) <= {0, 255}


def test_blank_page_returns_zero_angle_without_crashing() -> None:
    blank = np.full((300, 300, 3), 255, dtype=np.uint8)
    prepared = prepare.prepare_page(blank)
    assert prepared.deskew_angle_deg == 0.0
    assert prepared.image.shape == (300, 300)


def test_empty_image_raises_rather_than_guessing() -> None:
    with pytest.raises(ValueError, match="empty"):
        prepare.prepare_page(np.zeros((0, 0, 3), dtype=np.uint8))
