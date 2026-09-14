"""M1-T6. Tracker tests."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from engine.detect import Detection
from engine.track import TRACK_BUFFER_FRAMES, CameraTracker, build_cv_tracklet_event

BASE_TS = datetime(2025, 1, 1, tzinfo=UTC)


def _detection(frame_i: int, x: float = 100.0, y: float = 100.0) -> Detection:
    return Detection(
        track_id=None,
        bbox=(x, y, 50.0, 100.0),
        conf=0.9,
        camera_id="cam-1",
        case_clock_ts=BASE_TS + timedelta(seconds=frame_i / 10),
    )


def test_track_id_survives_a_20_frame_gap() -> None:
    tracker = CameraTracker("cam-1")

    ids_before = [
        out[0].track_id for i in range(10) if (out := tracker.update([_detection(i)]))
    ]
    assert len(ids_before) == 10
    assert len(set(ids_before)) == 1  # same id throughout

    gap_frames = 20
    assert gap_frames < TRACK_BUFFER_FRAMES, "test assumes the gap is inside the buffer window"
    for _i in range(10, 10 + gap_frames):
        assert tracker.update([]) == []

    ids_after = [
        out[0].track_id
        for i in range(10 + gap_frames, 20 + gap_frames)
        if (out := tracker.update([_detection(i)]))
    ]
    assert len(ids_after) == 10
    assert set(ids_after) == set(ids_before), (
        f"track_id changed across the gap: before={ids_before[0]}, after={ids_after[0]}"
    )

    # Still ongoing (well inside the buffer window since the last sighting):
    # nothing should have finalized yet.
    assert tracker.drain_completed() == []


def test_tracklet_finalizes_only_past_the_buffer_window() -> None:
    tracker = CameraTracker("cam-1")
    tracker.update([_detection(0)])

    for _i in range(1, TRACK_BUFFER_FRAMES + 1):
        active = tracker.update([])
        assert active == []
    assert tracker.drain_completed() == [], "still within the buffer window"

    tracker.update([])  # one frame past the buffer window
    completed = tracker.drain_completed()
    assert len(completed) == 1
    assert completed[0].frame_count == 1


def test_end_session_finalizes_open_tracklets() -> None:
    tracker = CameraTracker("cam-1")
    for i in range(5):
        tracker.update([_detection(i)])

    assert tracker.drain_completed() == []
    tracker.end_session()
    completed = tracker.drain_completed()

    assert len(completed) == 1
    tracklet = completed[0]
    assert tracklet.camera_id == "cam-1"
    assert tracklet.frame_count == 5
    assert tracklet.start_ts == BASE_TS
    assert tracklet.end_ts == BASE_TS + timedelta(seconds=0.4)
    assert tracklet.best_crop_indices == [0, 1, 2, 3, 4]  # all 5 frames, equal confidence


def test_build_cv_tracklet_event_matches_api_contracts_shape() -> None:
    tracker = CameraTracker("cam-1")
    for i in range(3):
        tracker.update([_detection(i)])
    tracker.end_session()
    tracklet = tracker.drain_completed()[0]

    event = build_cv_tracklet_event(tracklet)

    assert event["v"] == 1
    assert event["type"] == "cv.tracklet"
    assert "ts" in event
    assert event["case_clock_ts"] == tracklet.end_ts.isoformat().replace("+00:00", "Z")
    assert isinstance(event["trace_id"], str) and event["trace_id"]

    payload = event["payload"]
    assert payload["track_id"] == tracklet.track_id
    assert payload["camera_id"] == "cam-1"
    assert payload["start_ts"] == tracklet.start_ts.isoformat().replace("+00:00", "Z")
    assert payload["end_ts"] == tracklet.end_ts.isoformat().replace("+00:00", "Z")
    assert payload["frame_count"] == 3
    assert payload["best_crop_indices"] == [0, 1, 2]
