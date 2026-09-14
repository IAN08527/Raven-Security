"""M1-T5. Detector tests.

The first group needs no TensorRT engine. The rest (`PersonDetector`
against a real engine) need `models/yolov8n.engine` built first:
`python -c "from ultralytics import YOLO; YOLO('models/yolov8n.pt').export(
format='engine', half=True, imgsz=640, device=0, dynamic=True, batch=8)"`.
"""

from __future__ import annotations

import gc
import statistics
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest
import torch

from engine.decode import DecodedFrame
from engine.detect import Detection, PersonDetector, QualityFloorNotRecorded, build_cv_boxes_event

BASE_TS = datetime(2025, 1, 1, tzinfo=UTC)
ENGINE_PATH = Path("models/yolov8n.engine")
VRAM_CEILING_BYTES = 4_591_714_304  # measured, M0-T2/M1-T3

requires_engine = pytest.mark.skipif(
    not ENGINE_PATH.exists(), reason=f"{ENGINE_PATH} not built; see module docstring"
)


def _synthetic_frames(n: int, camera_id: str = "cam-1") -> list[DecodedFrame]:
    return [
        DecodedFrame(
            source_id="s1",
            camera_id=camera_id,
            frame_seq=i,
            pts_s=i / 25,
            case_clock_ts=BASE_TS,
            data=np.random.randint(0, 255, (640, 640, 3), dtype=np.uint8),
        )
        for i in range(n)
    ]


def test_quality_floor_not_recorded_raises_pointing_at_m1_t8() -> None:
    """D14 currently states only 'roughly 5 FPS' -- an explicitly
    unmeasured placeholder ('the exact figure comes from S1'), not a
    recorded value. This must raise rather than silently use that number
    (CLAUDE.md rule 10)."""
    with pytest.raises(QualityFloorNotRecorded, match="M1-T8"):
        build_cv_boxes_event(
            camera_code="cam_01",
            frame_seq=1,
            case_clock_ts=BASE_TS,
            detections=[],
            effective_fps=8.4,
        )


def test_build_cv_boxes_event_matches_api_contracts_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    """Once D14 has a real recorded floor, the event must match
    API_CONTRACTS.md §3.2 exactly. Patches quality_floor_fps() directly
    (rather than editing D14) so this test does not depend on M1-T8 having
    landed."""
    monkeypatch.setattr("engine.detect.quality_floor_fps", lambda: 5.0)

    detections = [
        Detection(
            track_id=7,
            bbox=(412.0, 233.0, 86.0, 194.0),
            conf=0.91,
            camera_id="cam_01",
            case_clock_ts=BASE_TS,
        ),
        Detection(
            track_id=None,
            bbox=(10.0, 20.0, 30.0, 40.0),
            conf=0.5,
            camera_id="cam_01",
            case_clock_ts=BASE_TS,
        ),
    ]

    event = build_cv_boxes_event(
        camera_code="cam_01",
        frame_seq=40912,
        case_clock_ts=BASE_TS,
        detections=detections,
        effective_fps=8.4,
    )

    assert event["v"] == 1
    assert event["type"] == "cv.boxes"
    assert "ts" in event
    assert event["case_clock_ts"] == BASE_TS.isoformat().replace("+00:00", "Z")
    assert isinstance(event["trace_id"], str) and event["trace_id"]

    payload = event["payload"]
    assert payload["camera_code"] == "cam_01"
    assert payload["frame_seq"] == 40912
    assert payload["effective_fps"] == 8.4
    assert payload["below_quality_floor"] is False  # 8.4 >= the patched 5.0 floor

    assert payload["boxes"] == [
        {"track_id": 7, "bbox": [412, 233, 86, 194], "conf": 0.91, "is_target": False},
        {"track_id": None, "bbox": [10, 20, 30, 40], "conf": 0.5, "is_target": False},
    ]


def test_below_quality_floor_is_true_when_effective_fps_is_lower(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("engine.detect.quality_floor_fps", lambda: 5.0)

    event = build_cv_boxes_event(
        camera_code="cam_01", frame_seq=1, case_clock_ts=BASE_TS, detections=[], effective_fps=3.0
    )

    assert event["payload"]["below_quality_floor"] is True


@requires_engine
def test_detect_batch_returns_one_list_per_input_frame_in_order() -> None:
    detector = PersonDetector(ENGINE_PATH, vram_ceiling_bytes=VRAM_CEILING_BYTES)
    frames = _synthetic_frames(4)

    results = detector.detect_batch(frames)

    assert len(results) == 4
    for frame, dets in zip(frames, results, strict=True):
        for det in dets:
            assert det.track_id is None  # not the detector's job (M1-T6)
            assert det.camera_id == frame.camera_id
            assert det.case_clock_ts == frame.case_clock_ts
            assert 0.0 <= det.conf <= 1.0
            assert len(det.bbox) == 4


@requires_engine
def test_detect_batch_empty_input_returns_empty_output() -> None:
    detector = PersonDetector(ENGINE_PATH, vram_ceiling_bytes=VRAM_CEILING_BYTES)
    assert detector.detect_batch([]) == []


def test_engine_larger_than_vram_ceiling_is_rejected(tmp_path: Path) -> None:
    fake_engine = tmp_path / "fake.engine"
    fake_engine.write_bytes(b"0" * 1000)
    with pytest.raises(RuntimeError, match="vram_ceiling"):
        PersonDetector(fake_engine, vram_ceiling_bytes=100)


@requires_engine
@pytest.mark.slow
def test_one_hour_sustained_detection_no_vram_growth() -> None:
    """M1-T5 acceptance: one hour of batched detection with no sustained
    VRAM growth. Samples torch.cuda.memory_allocated() periodically and
    compares an early steady-state median to a late one -- see
    test_decode.py's M1-T2 soak test for why a two-point before/after
    measurement proved too fragile (noise, one-time warmup cost) to trust
    for a workload like this."""
    detector = PersonDetector(ENGINE_PATH, vram_ceiling_bytes=VRAM_CEILING_BYTES)
    frames = _synthetic_frames(8)

    duration_s = 60 * 60
    sample_interval_s = 30.0
    warmup_s = 60.0

    start = time.monotonic()
    deadline = start + duration_s
    next_sample = start
    samples: list[tuple[float, float]] = []

    while time.monotonic() < deadline:
        detector.detect_batch(frames)
        torch.cuda.synchronize()

        now = time.monotonic()
        if now >= next_sample:
            gc.collect()
            samples.append((now - start, torch.cuda.memory_allocated() / 1e6))
            next_sample = now + sample_interval_s

    assert len(samples) >= 10, f"only {len(samples)} VRAM samples collected"

    steady = [mb for elapsed, mb in samples if elapsed >= warmup_s]
    assert len(steady) >= 6, "not enough post-warmup samples to judge a trend"

    third = max(len(steady) // 3, 1)
    early_median = statistics.median(steady[:third])
    late_median = statistics.median(steady[-third:])
    drift_mb = late_median - early_median

    assert drift_mb < 50, (
        f"VRAM trended up by {drift_mb:.1f}MB from early steady-state "
        f"(median {early_median:.1f}MB) to late steady-state (median {late_median:.1f}MB) "
        f"over {len(steady)} post-warmup samples across {samples[-1][0] / 60:.1f} minutes"
    )
