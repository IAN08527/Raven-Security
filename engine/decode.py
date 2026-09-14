"""Decoder pool (M1-T2, D14 "build first", D16, D20). Hardware-accelerated
decode via PyAV for both RTSP and file sources. Live drops frames to stay
current; recorded seeks and can run off wall-clock. Every frame's timestamp
derives from `declared_start_ts + pts_s` (D16) -- never from `datetime.now()`
or any other system-time read.

There is no software-decode fallback path. A source whose codec has no
working `*_cuvid` decoder raises `HardwareDecodeUnavailable` at startup
rather than silently decoding on the CPU: a silent fallback would blow the
compute budget three layers up (D14) without anyone knowing why.
"""

from __future__ import annotations

import contextlib
import logging
import queue
import threading
from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Literal

import av
import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)

HW_DECODE_MARKERS = ("cuvid", "nvdec")
RECONNECT_INITIAL_S = 1.0
RECONNECT_MAX_S = 30.0
DEFAULT_QUEUE_SIZE = 8


class CameraSource(BaseModel):
    source_id: str
    camera_id: str
    mode: Literal["live", "recorded"]
    declared_start_ts: datetime
    fps: float
    feed_uri: str


class DecodedFrame(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    source_id: str
    camera_id: str
    frame_seq: int
    pts_s: float
    case_clock_ts: datetime
    data: NDArray[np.uint8]


class HardwareDecodeUnavailable(RuntimeError):
    """Raised when a source's codec has no working hardware decoder."""


def _open_hw_decoder(
    container: av.container.InputContainer,
) -> tuple[av.video.stream.VideoStream, av.video.codeccontext.VideoCodecContext]:
    """Opens the input's first video stream through its hardware decoder.
    Raises HardwareDecodeUnavailable rather than falling back to software."""
    stream = container.streams.video[0]
    base_name = stream.codec_context.name
    hw_name = f"{base_name}_cuvid"
    try:
        hw_ctx = av.CodecContext.create(hw_name, "r")
        hw_ctx.extradata = stream.codec_context.extradata
        hw_ctx.open()
    except Exception as exc:
        raise HardwareDecodeUnavailable(
            f"{hw_name} unavailable for source codec {base_name!r}: {exc}. "
            "No software-decode fallback: a source without hardware decode is not started."
        ) from exc

    if not any(marker in hw_ctx.name for marker in HW_DECODE_MARKERS):
        raise HardwareDecodeUnavailable(
            f"decoder {hw_ctx.name!r} does not look like hardware decode "
            f"(expected one of {HW_DECODE_MARKERS} in the name)"
        )
    if not isinstance(hw_ctx, av.video.codeccontext.VideoCodecContext):
        raise HardwareDecodeUnavailable(
            f"decoder {hw_ctx.name!r} did not produce a video codec context"
        )
    logger.info("hardware decode active: %s -> %s", base_name, hw_ctx.name)
    return stream, hw_ctx


class _SourceWorker(threading.Thread):
    """Decodes one source into its own bounded queue. Live sources drop the
    oldest queued frame rather than block the decoder on a slow consumer;
    recorded sources block (backpressure) so a slow consumer cannot be
    silently shown an incomplete file.

    `pts_s` accumulates across reconnects rather than resetting to 0 each
    time: a network blip on a live source does not roll the case clock
    backward, since real time kept passing during the outage. Each
    connection segment's local pts (which itself resets per RTSP session) is
    added on top of the cumulative total from all prior segments.
    """

    def __init__(self, source: CameraSource, frame_queue: queue.Queue[DecodedFrame]) -> None:
        super().__init__(name=f"decoder-{source.source_id}", daemon=True)
        self._source = source
        self._queue = frame_queue
        self._stop_event = threading.Event()
        self._frame_seq = 0
        self._cumulative_pts_s = 0.0
        self._segment_origin_s: float | None = None
        self._last_pts_s = 0.0

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        try:
            if self._source.mode == "live":
                self._run_live()
            else:
                self._run_recorded()
        except HardwareDecodeUnavailable:
            logger.error("source %s: no hardware decoder, worker exiting", self._source.source_id)
            raise

    def _run_recorded(self) -> None:
        container = av.open(self._source.feed_uri)
        try:
            stream, hw_ctx = _open_hw_decoder(container)
            for packet in container.demux(stream):
                if self._stop_event.is_set():
                    return
                for frame in hw_ctx.decode(packet):
                    self._emit_blocking(frame)
        finally:
            container.close()

    def _run_live(self) -> None:
        backoff = RECONNECT_INITIAL_S
        while not self._stop_event.is_set():
            try:
                container = av.open(self._source.feed_uri, options={"rtsp_transport": "tcp"})
            except Exception as exc:
                logger.warning(
                    "source %s: connect failed (%s), retrying in %.1fs",
                    self._source.source_id,
                    exc,
                    backoff,
                )
                if self._stop_event.wait(backoff):
                    return
                backoff = min(backoff * 2, RECONNECT_MAX_S)
                continue

            backoff = RECONNECT_INITIAL_S  # reset after a successful connect
            self._segment_origin_s = None  # new segment: next frame sets the local origin
            try:
                stream, hw_ctx = _open_hw_decoder(container)
                for packet in container.demux(stream):
                    if self._stop_event.is_set():
                        return
                    for frame in hw_ctx.decode(packet):
                        self._emit_dropping(frame)
            except HardwareDecodeUnavailable:
                raise  # never silently fall back, even after a reconnect
            except Exception as exc:
                logger.warning(
                    "source %s: stream error (%s), reconnecting in %.1fs",
                    self._source.source_id,
                    exc,
                    backoff,
                )
            finally:
                self._cumulative_pts_s = self._last_pts_s
                container.close()

            if self._stop_event.wait(backoff):
                return
            backoff = min(backoff * 2, RECONNECT_MAX_S)

    def _pts_s_for(self, frame: av.VideoFrame) -> float:
        if frame.time is not None:
            local_s = float(frame.time)
        else:
            local_s = self._frame_seq / self._source.fps
        if self._segment_origin_s is None:
            self._segment_origin_s = local_s
        pts_s = self._cumulative_pts_s + (local_s - self._segment_origin_s)
        self._last_pts_s = pts_s
        return pts_s

    def _to_decoded_frame(self, frame: av.VideoFrame) -> DecodedFrame:
        pts_s = self._pts_s_for(frame)
        decoded = DecodedFrame(
            source_id=self._source.source_id,
            camera_id=self._source.camera_id,
            frame_seq=self._frame_seq,
            pts_s=pts_s,
            case_clock_ts=self._source.declared_start_ts + timedelta(seconds=pts_s),
            data=frame.to_ndarray(format="bgr24").astype(np.uint8, copy=False),
        )
        self._frame_seq += 1
        return decoded

    def _emit_blocking(self, frame: av.VideoFrame) -> None:
        self._queue.put(self._to_decoded_frame(frame))

    def _emit_dropping(self, frame: av.VideoFrame) -> None:
        decoded = self._to_decoded_frame(frame)
        try:
            self._queue.put_nowait(decoded)
        except queue.Full:
            with contextlib.suppress(queue.Empty):
                self._queue.get_nowait()  # drop the oldest queued frame
            with contextlib.suppress(queue.Full):
                self._queue.put_nowait(decoded)  # another producer may still race us


class DecoderPool:
    """Owns one decode thread per `CameraSource`. Each source's decoded
    frames land in `queues[source_id]`; callers drain those directly."""

    def __init__(
        self, sources: Sequence[CameraSource], queue_size: int = DEFAULT_QUEUE_SIZE
    ) -> None:
        self.queues: dict[str, queue.Queue[DecodedFrame]] = {
            source.source_id: queue.Queue(maxsize=queue_size) for source in sources
        }
        self._workers = [_SourceWorker(source, self.queues[source.source_id]) for source in sources]

    def start(self) -> None:
        for worker in self._workers:
            worker.start()

    def stop(self, timeout_s: float = 5.0) -> None:
        for worker in self._workers:
            worker.stop()
        for worker in self._workers:
            worker.join(timeout=timeout_s)

    def is_alive(self) -> bool:
        return any(worker.is_alive() for worker in self._workers)
