"""M1-T3/M1-T4. Calibration and frame scheduler tests."""

from __future__ import annotations

import pytest

from engine.scheduler import (
    DEGRADED_BUDGET_DPS_FLOOR,
    CalibrationResult,
    FrameScheduler,
    calibrate,
)

DETECTOR_PATH = "yolov8n.pt"
RESOLUTION = (640, 640)


def test_two_calibration_runs_agree_within_10_percent() -> None:
    first = calibrate(DETECTOR_PATH, RESOLUTION, duration_s=2.0)
    second = calibrate(DETECTOR_PATH, RESOLUTION, duration_s=2.0)

    assert first.budget_dps > 0
    assert second.budget_dps > 0

    relative_diff = abs(first.budget_dps - second.budget_dps) / first.budget_dps
    assert relative_diff <= 0.10, (
        f"budget_dps disagreed by {relative_diff:.1%}: {first.budget_dps:.1f} vs "
        f"{second.budget_dps:.1f}"
    )


def test_calibration_result_below_floor_is_degraded() -> None:
    result = CalibrationResult(
        budget_dps=DEGRADED_BUDGET_DPS_FLOOR - 1,
        vram_ceiling_bytes=1_000_000_000,
        max_batch=8,
        gpu_name="mock-gpu",
    )
    assert result.degraded


def test_calibration_result_at_or_above_floor_is_not_degraded() -> None:
    result = CalibrationResult(
        budget_dps=DEGRADED_BUDGET_DPS_FLOOR,
        vram_ceiling_bytes=1_000_000_000,
        max_batch=8,
        gpu_name="mock-gpu",
    )
    assert not result.degraded


def _mock_calibration(budget_dps: float = 100.0) -> CalibrationResult:
    return CalibrationResult(
        budget_dps=budget_dps, vram_ceiling_bytes=1_000_000_000, max_batch=8, gpu_name="mock-gpu"
    )


def test_overload_degrades_every_camera_uniformly_none_dropped() -> None:
    budget_dps = 100.0
    scheduler = FrameScheduler(_mock_calibration(budget_dps))

    n = 12  # requested demand: 12 * 25 = 300 dps = 3x the 100 dps budget
    requested_fps = 25.0
    for i in range(n):
        scheduler.add_camera(f"cam-{i}", requested_fps)

    expected_each = budget_dps / n
    for i in range(n):
        effective = scheduler.effective_fps(f"cam-{i}")
        assert effective > 0, f"cam-{i} was dropped (effective_fps == 0)"
        assert effective == pytest.approx(expected_each), (
            f"cam-{i}: expected {expected_each:.4f} fps, got {effective:.4f}"
        )

    total_effective = sum(scheduler.effective_fps(f"cam-{i}") for i in range(n))
    assert total_effective == pytest.approx(budget_dps)


def test_underload_gives_each_camera_its_full_requested_fps() -> None:
    scheduler = FrameScheduler(_mock_calibration(budget_dps=100.0))
    scheduler.add_camera("cam-a", 10.0)
    scheduler.add_camera("cam-b", 15.0)

    assert scheduler.effective_fps("cam-a") == pytest.approx(10.0)
    assert scheduler.effective_fps("cam-b") == pytest.approx(15.0)


def test_add_and_remove_camera_updates_allocation_immediately() -> None:
    scheduler = FrameScheduler(_mock_calibration(budget_dps=100.0))
    scheduler.add_camera("cam-a", 80.0)
    scheduler.add_camera("cam-b", 80.0)  # demand 160 > 100: both scaled to 50

    assert scheduler.effective_fps("cam-a") == pytest.approx(50.0)
    assert scheduler.effective_fps("cam-b") == pytest.approx(50.0)

    scheduler.remove_camera("cam-b")  # demand back to 80 <= 100: cam-a gets its full request

    assert scheduler.effective_fps("cam-a") == pytest.approx(80.0)
    assert scheduler.effective_fps("cam-b") == 0.0  # removed, not tracked


def test_budget_changed_event_emitted_on_allocation_change() -> None:
    events: list[dict[str, object]] = []
    scheduler = FrameScheduler(_mock_calibration(budget_dps=100.0), on_event=events.append)

    scheduler.add_camera("cam-a", 10.0)
    assert len(events) == 1
    event = events[0]
    assert event["type"] == "budget.changed"
    assert event["v"] == 1
    assert event["case_clock_ts"] is None
    assert isinstance(event["trace_id"], str) and event["trace_id"]
    assert event["payload"] == {"cam-a": 10.0}

    # Re-adding the same camera at the same fps doesn't change the
    # allocation, so no redundant event fires.
    scheduler.add_camera("cam-a", 10.0)
    assert len(events) == 1

    scheduler.add_camera("cam-b", 10.0)
    assert len(events) == 2


if __name__ == "__main__":
    pytest.main([__file__])
