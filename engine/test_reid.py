"""M2-T1. Re-ID embedder tests (D9, D15, CLAUDE.md rule 10).

No test here invents an accuracy number and none touches the quality
floor: the floor is unmeasured (S1b blocked) and ``engine.reid`` raises
``QualityFloorNotRecorded`` rather than guessing it.
"""

from __future__ import annotations

import gc
import statistics
import time

import numpy as np
import pytest
import torch

from engine.reid import (
    EMBEDDING_DIM,
    QualityFloorNotRecorded,
    ReIDEmbedder,
    current_vram_mb,
    quality_floor_fps,
)


def _crop(seed: int, height: int = 64, width: int = 32) -> np.ndarray:
    rng = np.random.RandomState(seed)
    return rng.randint(0, 255, (height, width, 3), dtype=np.uint8)


def _embedder() -> ReIDEmbedder:
    # No engine files: deterministic fallback path (see engine/reid.py).
    # 1GB ceiling with nothing resident always fits the fallback.
    return ReIDEmbedder(vram_ceiling_bytes=1_000_000_000)


def test_quality_floor_raises_with_exact_message() -> None:
    with pytest.raises(
        QualityFloorNotRecorded, match="quality floor unmeasured, complete S1b first"
    ):
        quality_floor_fps()


def test_same_crop_embedded_twice_returns_identical_vector() -> None:
    embedder = _embedder()
    crop = _crop(7)
    first = embedder.embed_single(crop)
    second = embedder.embed_single(crop)
    np.testing.assert_array_equal(first, second)


def test_returned_vectors_are_unit_norm() -> None:
    embedder = _embedder()
    for seed in range(5):
        vector = embedder.embed_single(_crop(seed))
        assert vector.shape == (EMBEDDING_DIM,)
        assert vector.dtype == np.float32
        np.testing.assert_allclose(float(np.linalg.norm(vector)), 1.0, atol=1e-5)

    tracklet = embedder.embed_tracklet([_crop(s) for s in range(3)], confidences=[0.9, 0.5, 0.7])
    assert tracklet.shape == (EMBEDDING_DIM,)
    assert tracklet.dtype == np.float32
    np.testing.assert_allclose(float(np.linalg.norm(tracklet)), 1.0, atol=1e-5)


def test_embed_tracklet_with_more_than_five_crops_uses_only_top_five_by_confidence() -> None:
    embedder = _embedder()
    crops = [_crop(seed) for seed in range(7)]
    # Deliberately unordered: the top-5 by confidence are seeds {5, 3, 1, 6, 0}.
    confidences = [0.50, 0.80, 0.10, 0.90, 0.20, 0.95, 0.60]
    assert len(crops) == len(confidences) == 7

    result = embedder.embed_tracklet(crops, confidences=confidences)

    top5_idx = [5, 3, 1, 6, 0]
    expected_parts = [embedder.embed_single(crops[i]) for i in top5_idx]
    mean = np.stack(expected_parts, axis=0).mean(axis=0).astype(np.float32)
    expected = (mean / float(np.linalg.norm(mean))).astype(np.float32)
    np.testing.assert_allclose(result, expected, atol=1e-6)

    # And it must NOT equal the mean over all 7 (i.e. selection happened).
    all_mean = np.stack([embedder.embed_single(c) for c in crops], axis=0).mean(axis=0)
    all_mean = (all_mean / float(np.linalg.norm(all_mean))).astype(np.float32)
    assert not np.allclose(result, all_mean, atol=1e-4)


def test_embed_tracklet_k_is_min_five_len() -> None:
    embedder = _embedder()
    crops = [_crop(seed) for seed in range(2)]
    result = embedder.embed_tracklet(crops, confidences=[0.4, 0.9])
    expected_parts = [embedder.embed_single(crops[1]), embedder.embed_single(crops[0])]
    mean = np.stack(expected_parts, axis=0).mean(axis=0).astype(np.float32)
    expected = (mean / float(np.linalg.norm(mean))).astype(np.float32)
    np.testing.assert_allclose(result, expected, atol=1e-6)


def test_embed_tracklet_empty_raises() -> None:
    with pytest.raises(ValueError, match="at least one crop"):
        _embedder().embed_tracklet([])


def test_engine_variant_selection_is_measured_not_guessed(tmp_path) -> None:  # type: ignore[no-untyped-def]
    x10 = tmp_path / "osnet_x1_0.engine"
    x025 = tmp_path / "osnet_x0_25.engine"
    x10.write_bytes(b"0" * 600)
    x025.write_bytes(b"0" * 200)

    # Both fit: x1.0 wins.
    embedder = ReIDEmbedder(
        vram_ceiling_bytes=1000, x10_engine_path=x10, x025_engine_path=x025
    )
    assert embedder.variant == "osnet_x1_0"

    # Only x0.25 fits after the detector is resident.
    embedder = ReIDEmbedder(
        vram_ceiling_bytes=1000,
        detector_resident_bytes=500,
        x10_engine_path=x10,
        x025_engine_path=x025,
    )
    assert embedder.variant == "osnet_x0_25"

    # Neither fits: raise, never silently fall back to a guess.
    with pytest.raises(RuntimeError, match="neither OSNet engine fits"):
        ReIDEmbedder(
            vram_ceiling_bytes=1000,
            detector_resident_bytes=900,
            x10_engine_path=x10,
            x025_engine_path=x025,
        )


def test_vram_after_100_embed_calls_within_50mb_of_before() -> None:
    """M2-T1 acceptance: 100 embeds must not grow VRAM by more than 50MB."""
    embedder = _embedder()
    crop = _crop(42)
    torch.cuda.synchronize() if torch.cuda.is_available() else None
    gc.collect()
    before_mb = current_vram_mb()
    for _ in range(100):
        embedder.embed_single(crop)
        if torch.cuda.is_available():
            torch.cuda.synchronize()
    gc.collect()
    after_mb = current_vram_mb()
    assert after_mb - before_mb < 50.0, (
        f"VRAM grew by {after_mb - before_mb:.1f}MB over 100 embeds "
        f"(before {before_mb:.1f}MB, after {after_mb:.1f}MB)"
    )


@pytest.mark.slow
def test_one_hour_sustained_embedding_no_vram_growth() -> None:
    """M2-T1 acceptance: one hour, sample every 60s, trend flat.

    Same two-median design as the M1-T5 soak test: a two-point
    before/after measurement proved too fragile (noise, one-time warmup),
    so early steady-state median vs late steady-state median decides.
    Excluded from the default run (``-m 'not slow'``); CI uses the
    100-call test above.
    """
    embedder = _embedder()
    crop = _crop(1)

    duration_s = 60 * 60
    sample_interval_s = 60.0
    warmup_s = 120.0

    start = time.monotonic()
    deadline = start + duration_s
    next_sample = start
    samples: list[tuple[float, float]] = []

    while time.monotonic() < deadline:
        embedder.embed_single(crop)
        if torch.cuda.is_available():
            torch.cuda.synchronize()
        now = time.monotonic()
        if now >= next_sample:
            gc.collect()
            samples.append((now - start, current_vram_mb()))
            next_sample = now + sample_interval_s

    assert len(samples) >= 10, f"only {len(samples)} VRAM samples collected"
    steady = [mb for elapsed, mb in samples if elapsed >= warmup_s]
    assert len(steady) >= 6, "not enough post-warmup samples to judge a trend"
    third = max(len(steady) // 3, 1)
    early_median = statistics.median(steady[:third])
    late_median = statistics.median(steady[-third:])
    drift_mb = late_median - early_median
    assert drift_mb < 50.0, (
        f"VRAM trended up by {drift_mb:.1f}MB from early steady-state "
        f"(median {early_median:.1f}MB) to late steady-state (median {late_median:.1f}MB)"
    )
