import asyncio
import gc
import logging
from enum import Enum
from typing import Optional

import httpx

try:
    import torch
except ImportError:
    torch = None

logger = logging.getLogger("raven.vram")

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"


class Lane(str, Enum):
    NLP = "nlp"
    CV = "cv"


class VramManager:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self.holder: Optional[Lane] = None
        self.queue_depth: int = 0
        self._nlp_loaded = False
        self._cv_loaded = False

    async def acquire(self, lane: Lane) -> None:
        await self._lock.acquire()
        self.queue_depth += 1
        try:
            if lane == Lane.CV and self._nlp_loaded:
                await self._evict_nlp()
            if lane == Lane.NLP and self._cv_loaded:
                self._evict_cv()
            self.holder = lane
        finally:
            self.queue_depth -= 1

    def release(self) -> None:
        self.holder = None
        if self._lock.locked():
            self._lock.release()

    async def _evict_nlp(self) -> None:
        try:
            async with httpx.AsyncClient(timeout=30) as c:
                await c.post(
                    OLLAMA_URL,
                    json={"model": "phi3:mini", "prompt": "", "keep_alive": 0},
                )
            self._nlp_loaded = False
        except Exception as e:
            logger.warning("ollama evict failed: %s", e)

    def _evict_cv(self) -> None:
        global _yolo_model, _reid_model
        _yolo_model = None
        _reid_model = None
        gc.collect()
        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
        self._cv_loaded = False

    def mark_nlp(self) -> None:
        self._nlp_loaded = True

    def mark_cv(self) -> None:
        self._cv_loaded = True

    def free_mb(self) -> float:
        if torch is not None and torch.cuda.is_available():
            return torch.cuda.mem_get_info()[0] / (1024 * 1024)
        return 0.0

    def status(self) -> dict:
        return {
            "holder": self.holder.value if self.holder else None,
            "free_mb": self.free_mb(),
            "queue_depth": self.queue_depth,
        }


vram = VramManager()
_yolo_model = None
_reid_model = None
