"""Compute-budget scheduler (M1-T3/M1-T4, D14 "build first"). A ten-second
batched detector forward pass at startup derives `budget_dps`, `vram_ceiling`
and `max_batch`, measured per install rather than configured
(ARCHITECTURE.md §3.1). `budget_dps` counts frames processed through the
detector per second -- the throughput unit `ARCHITECTURE.md` and D14 both
use, not a literal bounding-box count -- since that is what `FrameScheduler`
allocates camera slices against (§3.2).
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast

import torch
from ulid import ULID
from ultralytics import YOLO

VRAM_HEADROOM_BYTES = 512 * 1024 * 1024  # reserved for decoders + display (§3.1)
DEGRADED_BUDGET_DPS_FLOOR = 10.0
DEFAULT_CALIBRATION_BATCH = 4


@dataclass(frozen=True)
class CalibrationResult:
    budget_dps: float
    vram_ceiling_bytes: int
    max_batch: int
    gpu_name: str

    @property
    def degraded(self) -> bool:
        """A node whose calibration lands below the floor registers as
        degraded and is assigned no cameras (D14)."""
        return self.budget_dps < DEGRADED_BUDGET_DPS_FLOOR


def calibrate(
    detector_path: str,
    input_resolution: tuple[int, int],
    duration_s: float = 10.0,
    calibration_batch: int = DEFAULT_CALIBRATION_BATCH,
) -> CalibrationResult:
    """Runs batched detector forward passes at `input_resolution` for
    `duration_s` seconds, measuring sustained throughput and VRAM cost."""
    if not torch.cuda.is_available():
        raise RuntimeError("calibrate() requires a CUDA device; none is available")

    device = torch.device("cuda:0")
    gpu_name = torch.cuda.get_device_name(0)
    height, width = input_resolution

    model = YOLO(detector_path)
    model.to(device)
    # YOLO.model is typed as `str | nn.Module | None` (it starts as a path
    # before loading); by this point it is always the loaded module.
    net = cast(torch.nn.Module, model.model)

    warmup = torch.rand(calibration_batch, 3, height, width, device=device)
    with torch.no_grad():
        net(warmup)
    torch.cuda.synchronize()

    per_frame_bytes = _measure_per_frame_vram(net, height, width, calibration_batch, device)

    free_bytes, _total_bytes = torch.cuda.mem_get_info(device)
    vram_ceiling_bytes = max(int(free_bytes) - VRAM_HEADROOM_BYTES, 0)
    max_batch = max(int(vram_ceiling_bytes // per_frame_bytes), 1)

    budget_dps = _measure_sustained_throughput(
        net, height, width, calibration_batch, device, duration_s
    )

    return CalibrationResult(
        budget_dps=budget_dps,
        vram_ceiling_bytes=vram_ceiling_bytes,
        max_batch=max_batch,
        gpu_name=gpu_name,
    )


def _measure_per_frame_vram(
    net: torch.nn.Module, height: int, width: int, calibration_batch: int, device: torch.device
) -> float:
    """Marginal VRAM cost per image: the delta between a batch of 1 and a
    batch of `calibration_batch`, isolating the per-image cost from the
    fixed model/CUDA-context overhead already paid during warmup."""
    torch.cuda.reset_peak_memory_stats(device)
    single = torch.rand(1, 3, height, width, device=device)
    with torch.no_grad():
        net(single)
    torch.cuda.synchronize()
    single_peak = torch.cuda.max_memory_allocated(device)

    torch.cuda.reset_peak_memory_stats(device)
    multi = torch.rand(calibration_batch, 3, height, width, device=device)
    with torch.no_grad():
        net(multi)
    torch.cuda.synchronize()
    multi_peak = torch.cuda.max_memory_allocated(device)

    return max((multi_peak - single_peak) / (calibration_batch - 1), 1.0)


def _measure_sustained_throughput(
    net: torch.nn.Module,
    height: int,
    width: int,
    calibration_batch: int,
    device: torch.device,
    duration_s: float,
) -> float:
    batch = torch.rand(calibration_batch, 3, height, width, device=device)
    frames_processed = 0
    start = time.monotonic()
    deadline = start + duration_s
    while time.monotonic() < deadline:
        with torch.no_grad():
            net(batch)
        torch.cuda.synchronize()
        frames_processed += calibration_batch
    elapsed_s = time.monotonic() - start
    return frames_processed / elapsed_s


class FrameScheduler:
    """Allocates `budget_dps` across attached cameras (M1-T4, ARCHITECTURE.md
    §3.2): each camera's effective fps is its requested fps, scaled down
    uniformly when total demand exceeds the budget. Demand exceeding supply
    degrades every camera's fps rather than dropping any camera -- there is
    no code path that removes a camera for being over budget.
    """

    def __init__(
        self,
        calibration: CalibrationResult,
        on_event: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self._budget_dps = calibration.budget_dps
        self._requested: dict[str, float] = {}
        self._effective: dict[str, float] = {}
        self._on_event = on_event

    def add_camera(self, camera_id: str, requested_fps: float) -> None:
        self._requested[camera_id] = requested_fps
        self._reallocate()

    def remove_camera(self, camera_id: str) -> None:
        self._requested.pop(camera_id, None)
        self._effective.pop(camera_id, None)
        self._reallocate()

    def effective_fps(self, camera_id: str) -> float:
        return self._effective.get(camera_id, 0.0)

    def _reallocate(self) -> None:
        total_demand = sum(self._requested.values())
        # Each camera's effective fps is its requested fps, capped at that
        # same requested fps (never over-allocated) and uniformly scaled
        # down by budget/demand once demand exceeds the budget. At
        # total_demand <= budget every camera already gets exactly its
        # requested fps, which is that cap.
        scale = 1.0 if total_demand <= self._budget_dps or total_demand == 0 else (
            self._budget_dps / total_demand
        )
        new_effective = {
            camera_id: requested_fps * scale for camera_id, requested_fps in self._requested.items()
        }
        if new_effective != self._effective:
            self._effective = new_effective
            self._emit_budget_changed()

    def _emit_budget_changed(self) -> None:
        if self._on_event is None:
            return
        # Not about one frame/detection/sighting (API_CONTRACTS.md §1.2's
        # case_clock_ts requirement is scoped to those), so this reallocation
        # event has no single case clock to report; case_clock_ts is
        # explicitly null rather than a guessed value.
        event = {
            "v": 1,
            "type": "budget.changed",
            "ts": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "case_clock_ts": None,
            "trace_id": str(ULID()),
            "payload": dict(self._effective),
        }
        self._on_event(event)
