"""Batched person detector, TensorRT FP16 (M1-T5, ARCHITECTURE.md §3.3:
resident, not evicted). Person class only -- every other COCO class is
filtered before detections are returned. `track_id` is not assigned here
(that is the tracker's job, M1-T6); `Detection.track_id` starts as `None`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from ulid import ULID
from ultralytics import YOLO
from ultralytics.engine.results import Results

from engine.decode import DecodedFrame

COCO_PERSON_CLASS_ID = 0


@dataclass(frozen=True)
class Detection:
    track_id: int | None
    bbox: tuple[float, float, float, float]  # x, y, w, h
    conf: float
    camera_id: str
    case_clock_ts: datetime


class QualityFloorNotRecorded(RuntimeError):
    """Raised when D14's quality floor has not been measured yet (M1-T8,
    S1). Guessing a number here is exactly the mistake CLAUDE.md rule 10
    exists to prevent."""


def quality_floor_fps() -> float:
    """Reads the measured quality floor from D14 (ARCHITECTURE.md §3.2).
    As of this writing D14 states only "roughly 5 FPS" -- an explicitly
    illustrative, unmeasured placeholder ("the exact figure comes from
    S1"), not a recorded value -- so this raises rather than treat it as
    one. Once S1 (M1-T8) records a real number in D14, replace this
    function's body with that constant."""
    raise QualityFloorNotRecorded(
        "docs/DECISIONS.md D14 has no measured quality floor yet: it states "
        "'roughly 5 FPS' as an explicitly unmeasured placeholder pending the S1 "
        "experiment. Complete M1-T8 (S1 measurement) and record the real value in "
        "D14 before below_quality_floor can be computed."
    )


class PersonDetector:
    """Batched person detector, TensorRT FP16.

    `vram_ceiling_bytes` is validated against the loaded engine's size, not
    used to choose between YOLOv8n and YOLO11n: STACK.md §5 states that
    choice is "chosen by S1, not assumed", and S1 (M1-T8) has not run. Both
    nano-tier variants comfortably fit a 6GB reference card either way.
    """

    def __init__(
        self,
        engine_path: str | Path,
        vram_ceiling_bytes: int,
        conf_threshold: float = 0.25,
    ) -> None:
        engine_path = Path(engine_path)
        engine_bytes = engine_path.stat().st_size
        if engine_bytes > vram_ceiling_bytes:
            raise RuntimeError(
                f"detector engine ({engine_bytes} bytes) exceeds the calibrated "
                f"vram_ceiling ({vram_ceiling_bytes} bytes); re-run calibration or "
                "use a smaller model"
            )
        self._model = YOLO(str(engine_path), task="detect")
        self._conf_threshold = conf_threshold

    def detect_batch(self, frames: list[DecodedFrame]) -> list[list[Detection]]:
        """Runs one batched forward pass and returns person-only detections
        per input frame, in the same order."""
        if not frames:
            return []
        images = [frame.data for frame in frames]
        raw_results = self._model.predict(
            images, conf=self._conf_threshold, classes=[COCO_PERSON_CLASS_ID], verbose=False
        )
        # Non-streaming predict() over a list of images always returns
        # list[Results], never raw tensors; the stub's broader return type
        # covers other call modes this codebase does not use.
        results = cast(list[Results], raw_results)

        batched: list[list[Detection]] = []
        for frame, result in zip(frames, results, strict=True):
            per_frame: list[Detection] = []
            boxes = result.boxes
            if boxes is not None:
                for i in range(len(boxes)):
                    x1, y1, x2, y2 = (float(v) for v in boxes.xyxy[i].tolist())
                    per_frame.append(
                        Detection(
                            track_id=None,
                            bbox=(x1, y1, x2 - x1, y2 - y1),
                            conf=float(boxes.conf[i].item()),
                            camera_id=frame.camera_id,
                            case_clock_ts=frame.case_clock_ts,
                        )
                    )
            batched.append(per_frame)
        return batched


def build_cv_boxes_event(
    camera_code: str,
    frame_seq: int,
    case_clock_ts: datetime,
    detections: list[Detection],
    effective_fps: float,
) -> dict[str, Any]:
    """API_CONTRACTS.md §3.2 `cv.boxes` event. Raises
    `QualityFloorNotRecorded` if D14's quality floor has not been measured
    (M1-T8) rather than guessing whether `effective_fps` is below it."""
    floor = quality_floor_fps()
    return {
        "v": 1,
        "type": "cv.boxes",
        "ts": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "case_clock_ts": case_clock_ts.isoformat().replace("+00:00", "Z"),
        "trace_id": str(ULID()),
        "payload": {
            "camera_code": camera_code,
            "frame_seq": frame_seq,
            "effective_fps": effective_fps,
            "below_quality_floor": effective_fps < floor,
            "boxes": [
                {
                    "track_id": d.track_id,
                    "bbox": [round(v) for v in d.bbox],
                    "conf": d.conf,
                    "is_target": False,
                }
                for d in detections
            ],
        },
    }
