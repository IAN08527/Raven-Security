"""M3-1. Segment-stage tests on synthetic fixtures."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

import segment  # noqa: E402


def _binary_page(
    height: int = 600, width: int = 400, rows: tuple[int, ...] = (60, 150, 240)
) -> np.ndarray:
    page = np.full((height, width), 255, dtype=np.uint8)
    for y in rows:
        cv2.rectangle(page, (50, y), (350, y + 14), 0, thickness=-1)
    return page


def test_three_bars_yield_three_lines_in_reading_order() -> None:
    lines = segment.split_lines(_binary_page())
    assert len(lines) == 3
    tops = [line.y for line in lines]
    assert tops == sorted(tops)


def test_boxes_stay_inside_page_bounds() -> None:
    page = _binary_page()
    height, width = page.shape[:2]
    for line in segment.split_lines(page):
        assert 0 <= line.x < width
        assert 0 <= line.y < height
        assert line.x + line.w <= width
        assert line.y + line.h <= height


def test_blank_page_yields_no_lines_without_crashing() -> None:
    blank = np.full((300, 300), 255, dtype=np.uint8)
    assert segment.split_lines(blank) == []
    assert segment.segment_page(blank).regions == []


def test_distant_blocks_become_separate_regions() -> None:
    page = _binary_page(rows=(60, 150, 450, 520))
    result = segment.segment_page(page)
    assert len(result.lines) == 4
    assert len(result.regions) == 2
    region_ids = {line.region_index for line in result.lines}
    assert region_ids == {0, 1}


def test_empty_image_raises_rather_than_guessing() -> None:
    with pytest.raises(ValueError, match="empty"):
        segment.split_lines(np.zeros((0, 0), dtype=np.uint8))
