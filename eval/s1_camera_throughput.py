"""S1 camera throughput measurement (M1-T8, EVALUATION.md §2 S1, D14).

Measures, against real RTSP decode (not local-file decode -- BUILD_PLAN.md
M1-T8 is explicit that a local MP4 would flatter the number) on the
reference machine (STACK.md §6, RTX 4050 Laptop 6GB):

  * maximum cameras sustained at 10 FPS each through the real decode ->
    batched-detector path (`engine/decode.py`, `engine/detect.py`)
  * peak VRAM during that sustained operation

This does NOT measure IDF1 vs detection FPS or the D14 quality floor. Both
need ground-truth multi-camera identity tracks, and neither of
EVALUATION.md's named S1 datasets is currently usable: WILDTRACK is
`DROPPED` (its page is back online as of this run, but still states no
licence anywhere -- rechecked directly, see the RESULTS.md note this run
appends) and MMPTrack is `STUB (registration required)`, with no signed T&C
response received. Guessing those numbers is exactly what CLAUDE.md rule 10
exists to prevent, so `docs/DECISIONS.md` D14's quality floor and
`docs/PRD.md` NFR-2 stay as unmeasured placeholders until a licensed
multi-camera tracking dataset is in hand.

Setup this run actually used (reusable for a future run):
  1. `models/yolov8n.engine` built per `engine/test_detect.py`'s docstring.
  2. mediamtx (https://github.com/bluenviron/mediamtx) as the RTSP server,
     default config (anonymous publish/read).
  3. One real, CC0-licensed video looped through N independent RTSP mount
     points via ffmpeg, one `ffmpeg -re -stream_loop -1 -i SOURCE -c:v
     libx264 ... -f rtsp rtsp://HOST:8554/cam_NN` process per camera.
     Source: "DiagonalCrosswalkYongeDundas.webm", Wikimedia Commons,
     CC0 1.0 Universal (licence verified directly against the file's current
     page at https://commons.wikimedia.org/wiki/File:DiagonalCrosswalkYongeDundas.webm
     on 2026-09-11, same rigor as the M0-T7 audit). Used only as decode/
     compute load -- a real video exercising real hardware decode and a
     real detector forward pass, not a benchmark accuracy measurement, so
     D19's provenance gate for metrics does not apply to it (no case-content
     row is derived from it, no DB row, no `eval/` metric filters over it).
  4. This script.

Camera count escalates through `--camera-count-plan` (ascending). Each level
starts its own fresh `DecoderPool` sized to exactly that many sources and
tears it down before the next level, rather than pre-starting every source
up front: an early version of this script did that and measured a false
230-second stall at N=1, caused entirely by 16 concurrent NVDEC hardware
decode sessions contending for the GPU even though only one was feeding the
detector. Isolated (one decode session, `eval/_diag_detect_timing.py`,
since deleted): the same detector call was 5.6s cold / 0.03s warm. That
contention is a real property of this reference GPU worth keeping in mind
(consumer NVDEC session limits are a known constraint), but it is a decode-
side effect, not a detector-compute one, and conflating the two would have
under-reported the camera count this pipeline can actually sustain.
"""

from __future__ import annotations

import argparse
import queue
import time
from dataclasses import dataclass
from datetime import UTC, datetime

import torch

from engine.decode import (
    CameraSource,
    DecodedFrame,
    DecoderPool,
    HardwareDecodeUnavailable,
)
from engine.detect import PersonDetector
from eval.run_all import append_result_row

DATASET_NAME = "wikimedia-commons-DiagonalCrosswalkYongeDundas-cc0-looped-rtsp"

# Matches engine/test_detect.py: measured M0-T2/M1-T3, RTX 4050 Laptop 6GB.
VRAM_CEILING_BYTES = 4_591_714_304

# models/yolov8n.engine was exported with `dynamic=True, batch=8`
# (engine/test_detect.py's module docstring) -- this is the largest single
# forward-pass batch the loaded engine accepts; more cameras than this per
# tick are served through multiple forward passes, not a bigger one.
ENGINE_MAX_BATCH = 8

# Not today's wall-clock (D16): this is what every DecodedFrame's
# case_clock_ts derives from, matching CLAUDE.md's rule that a case-clock
# test uses a declared start that is not today.
DECLARED_START_TS = datetime(2025, 11, 2, 14, 0, 0, tzinfo=UTC)

TARGET_FPS_PER_CAMERA = 10.0
SUSTAINED_TOLERANCE = 0.95  # achieved_dps must reach >=95% of N * target fps


@dataclass
class LevelResult:
    camera_count: int
    required_dps: float
    achieved_dps: float
    sustained: bool
    peak_vram_bytes: int
    elapsed_s: float
    frames_processed: int


def _drain_to_latest(q: queue.Queue[DecodedFrame]) -> DecodedFrame | None:
    """Empties the queue, returning only the newest frame (or None if
    nothing new has arrived since the last drain). Mirrors how a live
    scheduler samples a camera: it wants the current frame, not a backlog."""
    latest: DecodedFrame | None = None
    while True:
        try:
            latest = q.get_nowait()
        except queue.Empty:
            return latest


def _chunk(items: list[DecodedFrame], size: int) -> list[list[DecodedFrame]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def run_level(
    pool: DecoderPool,
    detector: PersonDetector,
    source_ids: list[str],
    window_s: float,
) -> LevelResult:
    # DecoderPool.queues is keyed by source_id, not camera_id (engine/decode.py) --
    # source_id is what we look frames up by here. The detector is assumed
    # already warmed up (main() does one throwaway call before any level
    # runs): TensorRT's first-ever inference call pays a one-time ~5s
    # binding cost that would otherwise contaminate N=1's window.
    device = torch.device("cuda:0")
    torch.cuda.reset_peak_memory_stats(device)

    last_seq: dict[str, int] = {}
    frames_processed = 0
    start = time.monotonic()
    deadline = start + window_s

    while time.monotonic() < deadline:
        fresh: list[DecodedFrame] = []
        for source_id in source_ids:
            frame = _drain_to_latest(pool.queues[source_id])
            if frame is None:
                continue
            if last_seq.get(source_id) == frame.frame_seq:
                continue
            last_seq[source_id] = frame.frame_seq
            fresh.append(frame)

        if not fresh:
            time.sleep(0.005)
            continue

        for chunk in _chunk(fresh, ENGINE_MAX_BATCH):
            detector.detect_batch(chunk)
            frames_processed += len(chunk)

    elapsed_s = time.monotonic() - start
    achieved_dps = frames_processed / elapsed_s
    required_dps = len(source_ids) * TARGET_FPS_PER_CAMERA
    peak_vram_bytes = torch.cuda.max_memory_allocated(device)

    return LevelResult(
        camera_count=len(source_ids),
        required_dps=required_dps,
        achieved_dps=achieved_dps,
        sustained=achieved_dps >= SUSTAINED_TOLERANCE * required_dps,
        peak_vram_bytes=peak_vram_bytes,
        elapsed_s=elapsed_s,
        frames_processed=frames_processed,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rtsp-base", default="rtsp://127.0.0.1:8554")
    parser.add_argument("--camera-prefix", default="cam_")
    parser.add_argument(
        "--camera-count-plan",
        default="1,2,4,6,8,10,12,16",
        help="ascending comma-separated camera counts to try",
    )
    parser.add_argument("--window-s", type=float, default=30.0)
    parser.add_argument("--engine-path", default="models/yolov8n.engine")
    parser.add_argument("--connect-settle-s", type=float, default=8.0)
    args = parser.parse_args()

    plan = [int(n) for n in args.camera_count_plan.split(",")]
    max_n = max(plan)

    # Neither the decoder pool (PyAV/NVDEC) nor the TensorRT engine touches
    # torch's CUDA context, so without this, torch.cuda's memory-stats calls
    # in run_level() are the first CUDA touch in the process and fail with
    # "Invalid device argument" -- lazy-init explicitly instead.
    torch.cuda.init()
    torch.cuda.set_device(0)

    all_sources = {
        i: CameraSource(
            source_id=f"s{i}",
            camera_id=f"{args.camera_prefix}{i:02d}",
            mode="live",
            declared_start_ts=DECLARED_START_TS,
            fps=TARGET_FPS_PER_CAMERA,
            feed_uri=f"{args.rtsp_base}/{args.camera_prefix}{i:02d}",
        )
        for i in range(1, max_n + 1)
    }

    print(f"loading detector from {args.engine_path} ...")
    detector = PersonDetector(args.engine_path, vram_ceiling_bytes=VRAM_CEILING_BYTES)

    print("warming up the detector (one throwaway call, one source) ...")
    warmup_pool = DecoderPool([all_sources[1]])
    warmup_pool.start()
    time.sleep(args.connect_settle_s)
    if not warmup_pool.is_alive():
        raise HardwareDecodeUnavailable(
            "no decoder worker is alive after settle time; check mediamtx and the "
            "ffmpeg publishers are actually running"
        )
    warmup_frame = warmup_pool.queues["s1"].get(timeout=10.0)
    detector.detect_batch([warmup_frame])  # pays TensorRT's one-time first-call binding cost
    warmup_pool.stop()

    results: list[LevelResult] = []
    max_sustained_n = 0
    for n in plan:
        if n > max_n:
            raise ValueError(f"plan includes {n} but only {max_n} sources were configured")
        level_sources = [all_sources[i] for i in range(1, n + 1)]
        source_ids = [s.source_id for s in level_sources]

        print(f"--- level N={n}: starting {n} RTSP source(s) ---")
        pool = DecoderPool(level_sources)
        pool.start()
        time.sleep(args.connect_settle_s)
        if not pool.is_alive():
            raise HardwareDecodeUnavailable(
                f"N={n}: no decoder worker is alive after settle time; check mediamtx and "
                "the ffmpeg publishers are actually running"
            )

        print(f"    running {args.window_s:.0f}s steady window ...")
        result = run_level(pool, detector, source_ids, args.window_s)
        pool.stop()

        results.append(result)
        status = "SUSTAINED" if result.sustained else "NOT sustained"
        print(
            f"    N={n}: achieved {result.achieved_dps:.2f} dps "
            f"(required {result.required_dps:.2f}), peak VRAM "
            f"{result.peak_vram_bytes / 1e6:.1f}MB -- {status}"
        )
        if result.sustained:
            max_sustained_n = n
        else:
            print(f"    stopping escalation: N={n} did not sustain {TARGET_FPS_PER_CAMERA} FPS/camera")
            break

    print()
    print("=== S1 partial result (throughput and VRAM only; IDF1/quality floor NOT measured) ===")
    print(f"max cameras sustained at {TARGET_FPS_PER_CAMERA:.0f} FPS: {max_sustained_n}")
    sustained_results = [r for r in results if r.sustained]
    for r in results:
        print(
            f"  N={r.camera_count}: achieved_dps={r.achieved_dps:.2f} "
            f"required_dps={r.required_dps:.2f} sustained={r.sustained} "
            f"peak_vram_mb={r.peak_vram_bytes / 1e6:.1f} elapsed_s={r.elapsed_s:.1f} "
            f"frames={r.frames_processed}"
        )
        append_result_row(
            experiment="S1-throughput",
            dataset=DATASET_NAME,
            split=f"live_rtsp_N{r.camera_count}",
            metric="achieved_detection_dps",
            value=r.achieved_dps,
            note=(
                f"required {r.required_dps:.1f} dps ({r.camera_count} cameras x "
                f"{TARGET_FPS_PER_CAMERA:.0f} FPS target), sustained={r.sustained}, "
                f"peak VRAM {r.peak_vram_bytes / 1e6:.1f}MB over a {r.elapsed_s:.0f}s window. "
                "Partial S1 (M1-T8): real RTSP decode + real TensorRT FP16 detector forward "
                "passes over a real, CC0-licensed looped video (Wikimedia Commons, "
                "DiagonalCrosswalkYongeDundas.webm) used only as decode/compute load, not a "
                "benchmark accuracy source. IDF1 and the D14 quality floor are NOT measured "
                "here: EVALUATION.md's named S1 datasets (WILDTRACK, MMPTrack) are both "
                "currently unusable (no licence found / registration pending) -- see D14."
            ),
        )
    if sustained_results:
        peak_at_max = max(r.peak_vram_bytes for r in sustained_results if r.camera_count == max_sustained_n)
        print(f"peak VRAM at N={max_sustained_n}: {peak_at_max / 1e6:.1f}MB")
        append_result_row(
            experiment="S1-throughput",
            dataset=DATASET_NAME,
            split=f"live_rtsp_N{max_sustained_n}",
            metric="peak_vram_mb",
            value=peak_at_max / 1e6,
            note=(
                f"peak VRAM during sustained operation at the maximum cameras that held "
                f"{TARGET_FPS_PER_CAMERA:.0f} FPS each (N={max_sustained_n}) on the reference "
                "machine (STACK.md §6, RTX 4050 Laptop 6GB). Real RTSP decode, real TensorRT "
                "FP16 detector."
            ),
        )
        append_result_row(
            experiment="S1-throughput",
            dataset=DATASET_NAME,
            split=f"live_rtsp_N{max_sustained_n}",
            metric="max_cameras_at_10fps",
            value=float(max_sustained_n),
            note=(
                "Maximum cameras sustained at 10 FPS each, real RTSP decode, reference "
                "machine (RTX 4050 Laptop 6GB, STACK.md §6). Replaces NFR-1's placeholder. "
                "NFR-2 (quality floor) is unaffected: not measured this run (see above)."
            ),
        )


if __name__ == "__main__":
    main()
