"""Layout detection and line splitting. Script-agnostic (pipeline step 2,
ARCHITECTURE.md §4.1, FR-2.2).

Classical morphology + contours, no learned weights: the public
word-level corpora ship crops rather than annotated pages, so no public
checkpoint trains this layer anyway -- it is validated on collected
forms (Corpus B). Kernels scale with page size (200 vs 300 DPI scans
must not need different constants). Anything below the noise floor is
dropped as non-text; a page with no text yields empty lists, never a
crash (rule 9).
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class TextRegion:
    x: int
    y: int
    w: int
    h: int


@dataclass(frozen=True)
class TextLine:
    x: int
    y: int
    w: int
    h: int
    region_index: int


@dataclass(frozen=True)
class PageSegmentation:
    regions: list[TextRegion]
    lines: list[TextLine]  # reading order: top to bottom, left to right


def _relative_kernel(page_width: int, page_height: int) -> tuple[int, int]:
    """Horizontal join kernel sized from the page, not the DPI: wide
    enough to fuse words into lines, short enough to never fuse lines."""
    kx = max(page_width // 40, 5)
    ky = max(page_height // 200, 3)
    return (kx | 1, ky | 1)  # odd sizes keep the anchor centred


def split_lines(binary: np.ndarray) -> list[TextLine]:
    """Word blobs fused horizontally, then each contour is one line.
    `binary` is a `prepare_page` output (text 0 on 255). Components
    smaller than the noise floor are non-text and dropped."""
    if binary.size == 0:
        raise ValueError("segment: refusing an empty image (fail loud, never silent)")
    height, width = binary.shape[:2]
    inverted = 255 - binary
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, _relative_kernel(width, height))
    fused = cv2.dilate(inverted, kernel, iterations=1)
    contours, _ = cv2.findContours(fused, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    min_area = (height * width) / 5000.0
    min_height = max(height // 200, 4)
    boxes: list[tuple[int, int, int, int]] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if w * h < min_area or h < min_height:
            continue  # speckle, rule lines, punch holes: non-text
        boxes.append((x, y, min(w, width - x), min(h, height - y)))
    boxes.sort(key=lambda b: (b[1], b[0]))
    return [TextLine(x=x, y=y, w=w, h=h, region_index=0) for x, y, w, h in boxes]


def detect_regions(lines: list[TextLine], page_height: int) -> list[TextRegion]:
    """Group lines into regions at anomalously large vertical gaps: a gap
    wider than the page's own median line pitch plus twice the median line
    height starts a new region (form sections, header blocks). Uniformly
    spaced lines stay one region; one region per contiguous block, bounding
    boxes in page coordinates."""
    if not lines:
        return []
    heights = sorted(line.h for line in lines)
    median_h = heights[len(heights) // 2]

    ordered = sorted(lines, key=lambda line: (line.y, line.x))
    pitches = [
        second.y - (first.y + first.h)
        for first, second in zip(ordered, ordered[1:], strict=False)
    ]
    median_pitch = sorted(pitches)[len(pitches) // 2] if pitches else 0
    gap_limit = median_pitch + 2 * median_h

    groups: list[list[TextLine]] = [[ordered[0]]]
    for previous, line in zip(ordered, ordered[1:], strict=False):
        if line.y - (previous.y + previous.h) > gap_limit:
            groups.append([line])
        else:
            groups[-1].append(line)

    regions: list[TextRegion] = []
    for group in groups:
        x0 = min(line.x for line in group)
        y0 = min(line.y for line in group)
        x1 = max(line.x + line.w for line in group)
        y1 = max(line.y + line.h for line in group)
        regions.append(TextRegion(x=x0, y=y0, w=x1 - x0, h=min(y1 - y0, page_height - y0)))
    return regions


def segment_page(binary: np.ndarray) -> PageSegmentation:
    """Full step 2: lines first, then regions, lines re-tagged with their
    region index. Output order is reading order."""
    height = binary.shape[0]
    lines = split_lines(binary)
    regions = detect_regions(lines, height)
    retagged: list[TextLine] = []
    for line in lines:
        region_index = 0
        for index, region in enumerate(regions):
            if region.y <= line.y < region.y + region.h:
                region_index = index
                break
        retagged.append(
            TextLine(x=line.x, y=line.y, w=line.w, h=line.h, region_index=region_index)
        )
    return PageSegmentation(regions=regions, lines=retagged)
