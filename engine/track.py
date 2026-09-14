"""ByteTrack wrapper (M1-T6, D9: local track ids only, never an identity
assertion). One tracker instance per camera; a track_id is stable only
within its camera -- there is no cross-camera identity here, that is D9's
lock-on + Re-ID flow, gated on a human decision.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import numpy as np
from ulid import ULID
from ultralytics.trackers.byte_tracker import BYTETracker

from engine.detect import Detection

# "Survive brief occlusion (target: 30 frames at 10fps)" (M1-T6). This
# ultralytics version's BYTETracker does not scale track_buffer by fps --
# `max_frames_lost = args.track_buffer` directly (checked against the
# installed version's source) -- so 30 here means exactly 30 frames,
# independent of the camera's fps, matching the target as stated.
TRACK_BUFFER_FRAMES = 30

_TRACKER_ARGS = SimpleNamespace(
    track_high_thresh=0.25,
    track_low_thresh=0.1,
    new_track_thresh=0.25,
    track_buffer=TRACK_BUFFER_FRAMES,
    match_thresh=0.8,
    fuse_score=True,
)


class _DetectionBoxes:
    """Adapts `list[Detection]` to the `conf`/`xywh`/`cls` attributes plus
    boolean-mask `__getitem__` that `BYTETracker.update()` expects, so the
    tracker never depends on ultralytics' own `Results`/`Boxes` types."""

    def __init__(self, detections: Sequence[Detection]) -> None:
        self.detections = list(detections)
        if self.detections:
            self.xywh = np.array(
                [(x + w / 2, y + h / 2, w, h) for x, y, w, h in (d.bbox for d in self.detections)],
                dtype=np.float32,
            )
            self.conf = np.array([d.conf for d in self.detections], dtype=np.float32)
        else:
            self.xywh = np.zeros((0, 4), dtype=np.float32)
            self.conf = np.zeros((0,), dtype=np.float32)
        self.cls = np.zeros(len(self.detections), dtype=np.float32)  # person-only (COCO id 0)

    def __len__(self) -> int:
        return len(self.detections)

    def __getitem__(self, mask: np.ndarray) -> _DetectionBoxes:
        indices = np.flatnonzero(mask)
        return _DetectionBoxes([self.detections[i] for i in indices])


@dataclass(frozen=True)
class Tracklet:
    track_id: int
    camera_id: str
    start_ts: datetime
    end_ts: datetime
    frame_count: int
    best_crop_indices: list[int]  # top 5 by confidence, into this tracklet's own frame history


class CameraTracker:
    """One ByteTrack instance for one camera. `update()` returns this
    frame's detections with `track_id` filled in; `drain_completed()`
    returns tracklets that just finished (lost past the buffer, or ended by
    `end_session()`).

    A track_id absent from one frame's output is not immediately finished:
    ByteTrack keeps it re-matchable for `TRACK_BUFFER_FRAMES` frames
    internally, so this only finalizes a tracklet once that same window has
    elapsed with no re-match -- checked here directly against `update()`'s
    documented output rather than reading BYTETracker's internal
    `lost_stracks`/`removed_stracks`, which is not part of its documented
    contract.
    """

    def __init__(self, camera_id: str) -> None:
        self.camera_id = camera_id
        self._tracker = BYTETracker(_TRACKER_ARGS)
        self._history: dict[int, list[Detection]] = {}
        self._last_seen_frame: dict[int, int] = {}
        self._completed: list[Tracklet] = []
        self._frame_index = -1

    def update(self, detections: list[Detection]) -> list[Detection]:
        self._frame_index += 1
        boxes = _DetectionBoxes(detections)
        # rows: x1, y1, x2, y2, track_id, score, cls, idx
        tracked_rows = self._tracker.update(boxes)

        out: list[Detection] = []
        seen_this_frame: set[int] = set()
        for row in tracked_rows:
            track_id = int(row[4])
            idx = int(row[7])
            det = detections[idx]
            tracked_det = Detection(
                track_id=track_id,
                bbox=det.bbox,
                conf=det.conf,
                camera_id=det.camera_id,
                case_clock_ts=det.case_clock_ts,
            )
            out.append(tracked_det)
            self._history.setdefault(track_id, []).append(tracked_det)
            self._last_seen_frame[track_id] = self._frame_index
            seen_this_frame.add(track_id)

        for track_id in list(self._last_seen_frame):
            if track_id in seen_this_frame:
                continue
            gap = self._frame_index - self._last_seen_frame[track_id]
            if gap > TRACK_BUFFER_FRAMES:
                self._finish_tracklet(track_id)

        return out

    def end_session(self) -> None:
        """Call at shutdown/detach: whatever is still open is now over,
        buffer window or not."""
        for track_id in list(self._last_seen_frame):
            self._finish_tracklet(track_id)

    def drain_completed(self) -> list[Tracklet]:
        completed, self._completed = self._completed, []
        return completed

    def _finish_tracklet(self, track_id: int) -> None:
        history = self._history.pop(track_id, None)
        self._last_seen_frame.pop(track_id, None)
        if not history:
            return
        ranked = sorted(range(len(history)), key=lambda i: history[i].conf, reverse=True)
        self._completed.append(
            Tracklet(
                track_id=track_id,
                camera_id=self.camera_id,
                start_ts=history[0].case_clock_ts,
                end_ts=history[-1].case_clock_ts,
                frame_count=len(history),
                best_crop_indices=ranked[:5],
            )
        )


def build_cv_tracklet_event(tracklet: Tracklet) -> dict[str, Any]:
    """API_CONTRACTS.md §1.2 event envelope, `type: "cv.tracklet"`."""
    return {
        "v": 1,
        "type": "cv.tracklet",
        "ts": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "case_clock_ts": tracklet.end_ts.isoformat().replace("+00:00", "Z"),
        "trace_id": str(ULID()),
        "payload": {
            "track_id": tracklet.track_id,
            "camera_id": tracklet.camera_id,
            "start_ts": tracklet.start_ts.isoformat().replace("+00:00", "Z"),
            "end_ts": tracklet.end_ts.isoformat().replace("+00:00", "Z"),
            "frame_count": tracklet.frame_count,
            "best_crop_indices": tracklet.best_crop_indices,
        },
    }
